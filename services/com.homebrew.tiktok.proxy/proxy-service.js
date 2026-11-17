'use strict';
/* Local reverse proxy: serves the tiktok.com desktop site to the TV.
   - spoofs desktop Chrome UA on upstream requests
   - strips frame/CSP restrictions
   - rewrites tiktok hostnames in text responses so everything stays same-origin
   - injects remote-control script into HTML */
var http = require('http'), https = require('https'), zlib = require('zlib'), fs = require('fs'), path = require('path');

var PORT = 8765, ORIGIN = 'http://127.0.0.1:' + PORT, MAIN = 'www.tiktok.com';
var UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
var SUFFIXES = ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com', 'tiktokv.us', 'tiktokw.us', 'ttwstatic.com',
  'byteoversea.com', 'ibytedtos.com', 'ibyteimg.com', 'bytedance.com', 'muscdn.com', 'musical.ly', 'ttlivecdn.com', 'tiktokrow-cdn.com', 'byteimg.com', 'bytescm.com'];
function hostOk(h) { return SUFFIXES.some(function (s) { return h === s || h.slice(-(s.length + 1)) === '.' + s; }); }

var SL = '(?:\\\\?\\/|\\\\u002[Ff])';
var HOST_RE = new RegExp('(https?:)?(' + SL + ')' + SL + '((?:[a-z0-9-]+\\.)*(?:' +
  SUFFIXES.map(function (s) { return s.replace(/\./g, '\\.'); }).join('|') + '))(?![a-z0-9.-])', 'gi');

function rewriteText(s) {
  return s.replace(HOST_RE, function (m, proto, sl, host, off, str) {
    if (!proto) { var c = str.charAt(off - 1); if ('"\'(='.indexOf(c) < 0) return m; }
    host = host.toLowerCase();
    var out = 'http:' + sl + sl + '127.0.0.1:' + PORT;
    if (host !== MAIN) out += sl + '__p' + sl + host;
    return out;
  });
}

var INJECT = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
var SHELL = fs.readFileSync(path.join(__dirname, 'shell.html'), 'utf8');
var HEAD_HTML =   '<script>' + INJECT.replace(/<\/script/gi, '<\\/script') + '</script>';

function pickHost(req) {
  var m = /^\/__p\/([^\/?#]+)(\/[^]*)?$/.exec(req.url);
  if (m) return { host: m[1].toLowerCase(), path: m[2] || '/' };
  var ref = req.headers.referer, rm = ref && /^https?:\/\/[^\/]+\/__p\/([^\/?#]+)/.exec(ref);
  return { host: rm ? rm[1].toLowerCase() : MAIN, path: req.url };
}
function unproxyUrl(u, fallbackHost) {
  if (!u) return u;
  u = u.replace(ORIGIN + '/__p/', 'https://');
  if (u.indexOf(ORIGIN) === 0) u = 'https://' + MAIN + u.slice(ORIGIN.length);
  return u;
}
function fixCookie(c) {
  return c.replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*Secure/ig, '').replace(/;\s*Partitioned/ig, '')
    .replace(/SameSite=None/ig, 'SameSite=Lax');
}

function handle(req, res) {
  if (req.url === '/__ping') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (req.url === '/__shell') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(SHELL); }

  var t = pickHost(req);
  if (!hostOk(t.host)) { res.writeHead(403); return res.end('blocked host'); }

  var h = {};
  Object.keys(req.headers).forEach(function (k) { h[k] = req.headers[k]; });
  h.host = t.host; h['user-agent'] = UA; h['accept-encoding'] = 'identity';
  if (h.referer) h.referer = unproxyUrl(h.referer);
  if (h.origin) h.origin = 'https://' + MAIN;
  delete h['upgrade-insecure-requests'];
  h['sec-ch-ua-mobile'] = '?0'; h['sec-ch-ua-platform'] = '"Linux"';

  var up = https.request({ host: t.host, port: 443, method: req.method, path: t.path, headers: h }, function (ur) {
    var rh = {};
    Object.keys(ur.headers).forEach(function (k) { rh[k] = ur.headers[k]; });
    ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'strict-transport-security',
      'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'report-to', 'nel'].forEach(function (k) { delete rh[k]; });
    if (rh['set-cookie']) rh['set-cookie'] = [].concat(rh['set-cookie']).map(fixCookie);
    if (rh.location) {
      var loc = rh.location;
      if (loc.charAt(0) === '/' && loc.charAt(1) !== '/' && t.host !== MAIN) loc = '/__p/' + t.host + loc;
      rh.location = rewriteText(loc);
    }
    var ct = String(rh['content-type'] || ''), enc = String(rh['content-encoding'] || '').toLowerCase();
    var isText = /text\/html|javascript|json|css|xml|text\/plain/i.test(ct) && (!enc || enc === 'gzip' || enc === 'deflate');
    if (!isText) { res.writeHead(ur.statusCode, rh); return ur.pipe(res); }

    var stream = ur;
    if (enc === 'gzip') stream = ur.pipe(zlib.createGunzip()); else if (enc === 'deflate') stream = ur.pipe(zlib.createInflate());
    var chunks = [];
    stream.on('data', function (c) { chunks.push(c); });
    stream.on('error', function () { res.end(); });
    stream.on('end', function () {
      var body = rewriteText(Buffer.concat(chunks).toString('utf8'));
      if (/text\/html/i.test(ct)) {
        if (/<head[^>]*>/i.test(body)) body = body.replace(/<head[^>]*>/i, function (m) { return m + HEAD_HTML; });
        else body = HEAD_HTML + body;
      }
      delete rh['content-encoding']; delete rh['content-length']; delete rh.etag;
      rh['content-length'] = Buffer.byteLength(body);
      res.writeHead(ur.statusCode, rh); res.end(body);
    });
  });
  up.on('error', function (e) { if (!res.headersSent) res.writeHead(502); res.end('proxy error: ' + e.message); });
  req.pipe(up);
}

var server = null;
function start() {
  if (server) return;
  server = http.createServer(handle);
  server.on('error', function (e) { console.error('proxy', e.message); server = null; });
  server.listen(PORT, '127.0.0.1');
}

var Service; try { Service = require('webos-service'); } catch (e) { Service = null; }
if (Service) {
  var svc = new Service('com.homebrew.tiktok.proxy'), keep = null;
  svc.activityManager.create('keepAlive', function (a) { keep = a; });
  start();
  svc.register('start', function (m) { start(); m.respond({ returnValue: true, port: PORT }); });
  svc.register('stop', function (m) { if (server) { server.close(); server = null; } m.respond({ returnValue: true }); });
} else {
  start(); console.log('standalone proxy on ' + ORIGIN + '/__shell');
}
