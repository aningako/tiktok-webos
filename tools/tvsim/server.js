#!/usr/bin/env node
/*
 * Offline harness for TV mode: serves a stand-in for https://www.tiktok.com/robots.txt?tv=1 plus fake
 * TikTok API answers, so TV mode can be exercised in a desktop Chromium without contacting TikTok.
 *
 *   node tools/tvsim/server.js [--port 8090] [--chaos]
 *
 * --chaos: about 1 in 3 API answers is broken (empty 200 body like an unsigned request, statusCode error,
 *          missing/null fields, empty lists) to shake out unguarded code paths.
 */
'use strict';
const http = require('http');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('--port', 8090), CHAOS = process.argv.includes('--chaos'), HANG = process.argv.includes('--hang');   // --hang: videos never send data (TV player stuck on loading)
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const counts = {};

const GENRES = ['Romance', 'Revenge', 'Fantasy', 'CEO', 'Family', 'Thriller', 'Comedy', 'Historical'];
const svgCover = (t, hue) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="100%" height="100%" fill="hsl(' + hue + ',50%,30%)"/><text x="12" y="40" fill="#fff" font-size="22">' + t + '</text></svg>');
function drama(i) {
  const g = i % GENRES.length;
  return { dramaID: String(7000 + i), dramaName: 'Drama <b>' + i + '</b> & "Co"', numVideos: 20 + (i % 60), description: 'Episode story ' + i,
    authorUID: String(900 + (i % 9)), zoomCover: { 240: svgCover('D' + i, i * 37 % 360), 480: svgCover('D' + i, i * 37 % 360) },
    themes: [{ tagID: String(100 + g), tagKey: 'tag_' + GENRES[g] + '_GeneralSettings', tagVal: GENRES[g] }, { tagID: String(200 + (i % 3)), tagKey: 'tag_x', tagVal: 'Tag' + (i % 3) }],
    shortDramaWatchHistory: i % 4 === 0 ? { lastWatchedEpisodeNumber: 1 + (i % 5) } : undefined };
}
function video(id, ep) {
  return { id: String(id), desc: 'Video ' + id, author: { uniqueId: 'user' + (id % 50), nickname: 'User ' + (id % 50) },
    video: { duration: 30, cover: svgCover('V' + id, id % 360), PlayAddrStruct: { UrlList: ['http://127.0.0.1:' + PORT + '/aweme/v1/play/?video_id=' + id] } },
    dramaInfo: ep ? undefined : (id % 10 === 0 ? drama(id % 97) : undefined), episodeNumber: ep };
}

function answer(path, q) {
  counts[path] = (counts[path] || 0) + 1;
  const cursor = +(q.get('cursor') || q.get('offset') || 0);
  if (CHAOS) {
    const r = rnd();
    if (r < 0.08) return '';                                     // unsigned request: empty 200
    if (r < 0.14) return { statusCode: 10201, statusMsg: 'chaos' };
    if (r < 0.22) return { statusCode: 0 };                       // success, no fields at all
    if (r < 0.28) return { statusCode: 0, dramaList: null, itemList: null, data: null, hasMore: true, cursor: null };
    if (r < 0.33) return { statusCode: 0, dramaList: [null, { dramaID: null }], itemList: [null, {}], data: [{}, { item: null }], hasMore: true, cursor: String(cursor) };
  }
  const page = (n, f) => Array.from({ length: n }, (_, k) => f(cursor + k));
  switch (path) {
    case '/api/drama/watch_history/': return { statusCode: 0, dramaList: page(5, drama), hasMore: false, cursor: '0' };
    case '/api/drama/theme/drama_list/': return { statusCode: 0, dramaList: cursor > 60 ? [] : page(21, (i) => drama(i + (+(q.get('tagIDList') || 0) % 5) * 13)), hasMore: cursor <= 60, cursor: String(cursor + 21), rankingUpdateTsp: 1 };
    case '/api/drama/detail/': return { statusCode: 0, dramaInfo: drama(+q.get('dramaID') - 7000) };
    case '/api/drama/recommend/drama_list/': return { statusCode: 0, dramaList: page(12, (i) => drama((i * 3 + 5) % 90)) };
    case '/api/drama/episode/item_list/': {
      const total = 45;
      const items = []; for (let e = cursor; e < Math.min(cursor + +(q.get('count') || 30), total); e++) items.push(video(+q.get('dramaID') * 100 + e, e + 1));
      return { statusCode: 0, itemList: items, hasMore: cursor + items.length < total, cursor: String(cursor + items.length), totalEpisodeCount: total };
    }
    case '/api/drama/filter/category_list/': return { statusCode: 0, dramaCategoryLists: [{ dramaCategories: GENRES.map((g, i) => ({ categoryFilterType: 2, categoryID: String(100 + i), name: g })).concat([{ categoryFilterType: 1, categoryID: '0', name: 'All' }]) }] };
    case '/api/search/general/full/': return { status_code: 0, data: page(10, (i) => ({ item: video(5000 + i * 10) })), has_more: cursor < 30 ? 1 : 0, cursor: cursor + 10 };
    case '/api/recommend/item_list/':
    case '/api/explore/item_list/': return { statusCode: 0, itemList: page(8, (i) => video(10000 + Math.floor(rnd() * 1e6))), hasMore: true };
    case '/api/following/item_list/': {   // like TikTok: level=1 always cursor "0"; level=2 pages back in time (some pages empty)
      if (q.get('level') !== '2') return { statusCode: 0, itemList: Array.from({ length: 7 }, (_, k) => video(20000 + k)), hasMore: true, cursor: '0', level: 1 };
      const c = +q.get('cursor') || 0, n = c / 1000;               // page number
      if (n >= 8) return { statusCode: 0, itemList: [], hasMore: false, cursor: String(c + 1000), level: 2 };
      const items = n % 3 === 2 ? [] : Array.from({ length: 5 }, (_, k) => video(21000 + n * 10 + k));
      return { statusCode: 0, itemList: items, hasMore: true, cursor: String(c + 1000), level: 2 };
    }
  }
  return { statusCode: 404 };
}

const SDK = 'window.byted_acrawler = { init: function () { window.__sdkInit = (window.__sdkInit || 0) + 1; } };';
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n'); }
  if (u.pathname === '/dialogtest') {                          // full-site stand-in: a dialog with no close button
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<!doctype html><body style="margin:0;height:100vh;background:#111"><div id="app"><div role="dialog" style="position:fixed;left:200px;top:100px;width:600px;height:400px;background:#333;color:#fff">Dialog without a close button</div></div>' +
      '<script>window.escSeen=0;addEventListener("keydown",function(e){if(e.keyCode===27)window.escSeen++;});</script></body>');
  }
  if (u.pathname === '/mock/sdk.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(SDK); }
  if (u.pathname === '/__counts') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(counts)); }
  if (u.pathname.startsWith('/aweme/') && HANG) return;        // never answer
  if (u.pathname.startsWith('/aweme/')) {                    // test clips (tools/tvsim/make_media.sh), with Range support
    const id = +(u.searchParams.get('video_id') || 0), f = require('path').join(__dirname, 'media', 'clip' + (id % 10) + '.mp4');
    if (!require('fs').existsSync(f)) { res.writeHead(404); return res.end(); }
    const data = require('fs').readFileSync(f), m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': data.length, 'Accept-Ranges': 'bytes' }); return res.end(data); }
    const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : data.length - 1;
    res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes ' + a + '-' + b + '/' + data.length, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
    return res.end(data.slice(a, b + 1));
  }
  if (u.pathname.startsWith('/api/')) {
    const a = answer(u.pathname, u.searchParams);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return setTimeout(() => res.end(typeof a === 'string' ? a : JSON.stringify(a)), 40 + rnd() * 160);
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log('[tvsim] http://127.0.0.1:' + PORT + '/robots.txt?tv=1' + (CHAOS ? '  (chaos mode)' : '')));
