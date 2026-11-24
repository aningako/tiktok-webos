/* Injected by webOS WebAppManager into every page this app loads (including https://www.tiktok.com).
   TV remote-control mappings, zoom and exit handling for the TikTok desktop site.
   Plain ES5 so it runs on older webOS versions too.
   Created by aning and Cipher Amir with the help of Claude (Anthropic). MIT license.
   Made for Pie Amolong, to watch AI dramas on an LG TV with TikTok. */
(function () {
  if (window.top !== window) return;               // not inside captcha/login iframes
  if (window.__tvInjected) return; window.__tvInjected = true;
  // Leaving a page (full site <-> TV mode, reloads): unload every video so its hardware decoder is freed. On the TV
  // a player stuck "loading" kept the decoders after the page changed, and then no video played anywhere until the
  // app was closed (seen 2026-11-21: For You/Following/Explore and the full site all stuck on loading).
  addEventListener('pagehide', function () {
    var vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) { try { vs[i].pause(); vs[i].removeAttribute('src'); vs[i].load(); } catch (e) {} }
  });
  // TV mode: the app's own light player (see tvMode at the end), on a bare tiktok.com document.
  var TV_URL = 'https://www.tiktok.com/robots.txt?tv=1';
  if (location.pathname === '/robots.txt' && /[?&]tv=1/.test(location.search)) return tvMode();
  /* ---------- playback fixes ----------
     TikTok plays most videos through MediaSource running inside a Web Worker (its multiple.worker).
     On webOS TV (tested: webOS 10.3 "TV Lite", 50UR7550) worker-MSE videos stall at 0:00 with metadata
     only, while main-thread MSE and progressive MP4 play fine. Reporting that MediaSource can't be built
     in a worker makes TikTok use main-thread playback. HEVC is hidden too so it picks H.264 renditions. */
  var HEVC = /hvc1|hev1|hevc|h265|bytevc1/i;
  function isLive() { return /^\/live(\/|$)|^\/@[^/]+\/live/.test(location.pathname); }
  try {
    // Steer TikTok away from MediaSource outside LIVE pages: it then uses progressive MP4 URLs, whose
    // decoders the watchdog below can free and restore safely (a detached MediaSource can't be re-attached).
    // Off LIVE pages window.MediaSource reads as undefined, so TikTok's feature check
    // (`window.MediaSource = window.MediaSource || window.WebKitMediaSource; return e && typeof
    // e.isTypeSupported == "function"`) picks progressive MP4. Exception: TikTok's drama player calls
    // `new MediaSource` without any check (in its _createMse/_reallocMse methods); hidden, that crashed the
    // whole page ("MediaSource is not a constructor", seen in 2.1.0-2.2.1 on a drama episode switch), so
    // those callers get the real one. (A stand-in without isTypeSupported doesn't work: another component
    // calls MediaSource.isTypeSupported directly.) The setter accepts TikTok's assignment. LIVE streams
    // (FLV/HLS) need MediaSource, so LIVE pages get the real one. A getter, so it follows SPA navigation.
    var MediaSourceReal = window.MediaSource;
    var MSE_CALLERS = /_createMse|_reallocMse/;
    ['MediaSource', 'WebKitMediaSource'].forEach(function (n) {
      var orig = window[n];
      if (!orig) return;
      try {
        Object.defineProperty(window, n, {
          get: function () { return isLive() || MSE_CALLERS.test(new Error().stack || '') ? orig : undefined; },
          set: function (v) { if (v) orig = v; },
          configurable: true
        });
      } catch (e) {}
    });
    (function (RealMS) {
      if (!RealMS) return;
      try { Object.defineProperty(RealMS, 'canConstructInDedicatedWorker', { get: function () { return false; }, configurable: true }); } catch (e) {}
      if (RealMS.isTypeSupported) {
        var origSupported = RealMS.isTypeSupported.bind(RealMS);
        RealMS.isTypeSupported = function (t) { return HEVC.test(String(t)) ? false : origSupported(t); };
      }
    })(MediaSourceReal);
    var origCanPlay = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (t) { return HEVC.test(String(t)) ? '' : origCanPlay.call(this, t); };
    if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
      var origDecoding = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
      navigator.mediaCapabilities.decodingInfo = function (cfg) {
        var ct = cfg && cfg.video && cfg.video.contentType;
        if ((ct && HEVC.test(ct)) || (cfg && cfg.type === 'media-source' && !isLive()))
          return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
        return origDecoding(cfg);
      };
    }
  } catch (e) {}

  /* ---------- skip video URLs the TV can't open ----------
     Each video comes with a UrlList: two v*-webapp-prime.tiktok.com URLs, then a www.tiktok.com/aweme/v1/play/
     URL. The prime URLs need the HttpOnly tt_chain_token cookie (403 without it, 206 with it), but webOS hands
     <video> URLs to its own media pipeline, which doesn't send the browser's cookies. So on the TV every video
     first failed twice (MEDIA_ERR_SRC_NOT_SUPPORTED / decode error) before TikTok fell back to the aweme URL,
     about 5-10s per video. Remember each UrlList as TikTok receives it (page data via JSON.parse, feed
     updates via Response.json) and hand the <video> the aweme URL straight away. */
  try {
    var PRIME = /^https?:\/\/[^/]*-webapp-prime[^/]*\.tiktok\.com(\/[^?]*)/, primeAlt = {}, primeCount = 0;
    var rememberUrls = function (list) {
      var alt = null, i, m;
      for (i = 0; i < list.length; i++) if (/\/aweme\/v1\/play\//.test(list[i])) { alt = list[i]; break; }
      if (!alt) return;
      if (++primeCount > 3000) { primeAlt = {}; primeCount = 0; }   // (bounded: one entry per video seen)
      for (i = 0; i < list.length; i++) if ((m = PRIME.exec(list[i]))) primeAlt[m[1]] = alt;
    };
    var scanUrls = function (o, depth) {
      if (!o || typeof o !== 'object' || depth > 14) return;
      if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) scanUrls(o[i], depth + 1); return; }
      for (var k in o) {
        var v = o[k];
        if (k === 'UrlList' && Array.isArray(v)) rememberUrls(v);
        else if (v && typeof v === 'object') scanUrls(v, depth + 1);
      }
    };
    var jsonParse = JSON.parse;
    JSON.parse = function (s) {
      var r = jsonParse.apply(this, arguments);
      if (typeof s === 'string' && s.length > 500 && s.indexOf('"UrlList"') >= 0) { try { scanUrls(r, 0); } catch (e) {} }
      return r;
    };
    if (window.Response && Response.prototype.json) {
      var respJson = Response.prototype.json;
      Response.prototype.json = function () {
        return respJson.apply(this, arguments).then(function (d) { try { scanUrls(d, 0); } catch (e) {} return d; });
      };
    }
    var playableUrl = function (u) {
      var m = typeof u === 'string' && PRIME.exec(u);
      return (m && primeAlt[m[1]]) || u;
    };
    var srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src'), setAttr = Element.prototype.setAttribute;
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get: srcDesc.get,
      set: function (u) { this.__tvSrc = null; srcDesc.set.call(this, playableUrl(u)); } });
    HTMLMediaElement.prototype.setAttribute = function (k, u) {
      var isSrc = String(k).toLowerCase() === 'src';
      if (isSrc) this.__tvSrc = null;
      return setAttr.call(this, k, isSrc ? playableUrl(u) : u);
    };
  } catch (e) {}

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 463, CH_UP: 427, CH_DOWN: 428,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };

  /* ---------- helpers ---------- */
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }
  function bestVideo() {
    var vs = document.querySelectorAll('video'), best = null, d = 1e9;
    for (var i = 0; i < vs.length; i++) {
      if (!visible(vs[i])) continue;
      var r = vs[i].getBoundingClientRect(), dd = Math.abs(r.top + r.height / 2 - innerHeight / 2);
      if (dd < d) { d = dd; best = vs[i]; }
    }
    return best;
  }
  function scrollable(el) {
    while (el && el !== document.documentElement) {
      var cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(cs.overflowY)) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function sendKey(key, code, kc, target) {
    var t = target || document.activeElement || document.body;
    ['keydown', 'keyup'].forEach(function (type) {
      var ev = new KeyboardEvent(type, { key: key, code: code, keyCode: kc, which: kc, bubbles: true, cancelable: true });
      try {
        Object.defineProperty(ev, 'keyCode', { get: function () { return kc; } });
        Object.defineProperty(ev, 'which', { get: function () { return kc; } });
      } catch (e) {}
      t.dispatchEvent(ev);
    });
  }

  /* ---------- toast ---------- */
  var toastEl = null, toastTm = null;
  function toast(msg, ms) {                         // ms: how long it stays (default 1.2s, -1 = until hideToast)
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;right:30px;top:24px;z-index:2147483647;background:rgba(0,0,0,.8);color:#fff;' +
        'font:24px sans-serif;padding:10px 20px;border-radius:10px;pointer-events:none;transition:opacity .3s;opacity:0';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg; toastEl.style.opacity = '1';
    clearTimeout(toastTm);
    if (ms !== -1) toastTm = setTimeout(hideToast, ms || 1200);
  }
  function hideToast() { if (toastEl) toastEl.style.opacity = '0'; }

  /* ---------- "Loading…" while TikTok switches pages ----------
     Opening Explore, Following, Friends, Short dramas etc. takes TikTok 5-55s on the TV (its scripts keep the
     CPU at 100%), and meanwhile the old page stays on screen, frozen, which looks like the app hung or restarted.
     Show "Loading <page>…" from the click until the new page is drawn: TikTok removes the old page's
     #main-content-* container and then adds the new one (pages without one, like Short dramas, count as drawn
     once new pictures have loaded). LIVE is a real full-page load, so its message goes away with the page. */
  var nav = null;
  function mainContent() { return document.querySelector('[id^="main-content"]'); }
  function newPicturesShown(seen) {
    var imgs = document.querySelectorAll('img'), n = 0;
    for (var i = 0; i < imgs.length && n < 3; i++) {
      var im = imgs[i], r;
      if (seen.indexOf(im) >= 0 || !im.complete || !im.naturalWidth) continue;
      r = im.getBoundingClientRect();
      if (r.width > 100 && r.left > 240 && r.top < innerHeight && r.bottom > 0) n++;
    }
    return n >= 3;
  }
  addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || e.defaultPrevented) return;
    var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (u.origin !== location.origin || u.pathname === location.pathname) return;
    var name = (a.innerText || '').trim().split('\n')[0].slice(0, 30);
    toast(name ? 'Loading ' + name + '…' : 'Loading…', -1);
    nav = { from: location.pathname, old: mainContent(), seen: [].slice.call(document.images), since: Date.now() };
  }, true);
  setInterval(function () {
    if (!nav) return;
    var mc = mainContent(), oldGone = !nav.old || !nav.old.isConnected;
    var moved = location.pathname !== nav.from, fv = moved && feedVideo();
    var drawn = (moved && oldGone && ((mc && mc !== nav.old) || newPicturesShown(nav.seen))) ||
      (moved && fv && fv.readyState >= 2) || (Date.now() - nav.since > 1500 && openDialog());
    if (drawn || Date.now() - nav.since > 60000) { nav = null; hideToast(); }
  }, 500);

  /* ---------- zoom (CSS zoom on the root, persisted) ---------- */
  var zoom = 100;
  try { zoom = parseInt(localStorage.getItem('tvzoom'), 10) || 100; } catch (e) {}
  function applyZoom(show) {
    zoom = Math.max(50, Math.min(200, zoom));
    document.documentElement.style.zoom = zoom === 100 ? '' : String(zoom / 100);
    try { localStorage.setItem('tvzoom', String(zoom)); } catch (e) {}
    if (show) toast('Zoom ' + zoom + '%');
  }
  function changeZoom(d) { zoom = d === 0 ? 100 : zoom + d * 10; applyZoom(true); }

  /* ---------- dialogs (login, comments, share…) ---------- */
  var DIALOG_SEL = '[role="dialog"],[aria-modal="true"],#loginContainer,[class*="LoginModal"],[class*="DivModalContainer"]';
  function openDialog() {
    var ds = document.querySelectorAll(DIALOG_SEL);
    for (var i = ds.length - 1; i >= 0; i--) {
      var r = ds[i].getBoundingClientRect();
      if (visible(ds[i]) && r.width > 250 && r.height > 150) return ds[i];
    }
    return null;
  }
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select,textarea,' +
    '[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="tab"],[role="option"]';
  function moveFocus(root, dir) {
    var all = root.querySelectorAll(FOCUSABLE), list = [];
    for (var i = 0; i < all.length; i++) if (visible(all[i])) list.push(all[i]);
    if (!list.length) return;
    var idx = list.indexOf(document.activeElement);
    var next = list[idx < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, idx + dir))];
    if (!next.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(next.tagName)) next.setAttribute('tabindex', '0');
    var prev = document.querySelector('.tv-focus'); if (prev) prev.classList.remove('tv-focus');
    next.classList.add('tv-focus');                  // outlined while focused, see style below
    next.focus();
    if (next.scrollIntoView) next.scrollIntoView({ block: 'nearest' });
  }
  function isCaptcha(d) {
    return /captcha|secsdk/i.test(d.className + ' ' + d.id) || !!d.querySelector('[class*="captcha"], [id*="captcha"]') ||
      /Drag the slider|fit the puzzle|Verify to continue/i.test(d.textContent || '');
  }
  function closeDialog(d) {
    var btn = d.querySelector('[data-e2e="modal-close-inner-button"],[data-e2e*="close"],[aria-label="Close"],[aria-label="close"]');
    if (btn) btn.click(); else sendKey('Escape', 'Escape', 27, d);
  }
  var style = document.createElement('style');
  // Focus ring only on real controls and on what the remote's arrows selected in dialogs (.tv-focus).
  // A bare :focus-visible also outlined TikTok's big focusable page areas (e.g. a red line along the drama player).
  // CSS animations finish at once. TikTok runs endless decorative ones (sound-bar equalizers, pulsing LIVE
  // avatar rings) that repaint every frame: measured on the 50UR7550, the whole TV went from 66% to 38% CPU
  // busy with them off, leaving room for TikTok's own scripts, so videos switch sooner. Durations of 1ms
  // rather than `animation:none` so animationend/transitionend events still fire for TikTok's UI logic.
  style.textContent = '*,*::before,*::after{animation-duration:1ms!important;animation-iteration-count:1!important;' +
    'animation-delay:0s!important;transition-duration:1ms!important;transition-delay:0s!important}' +
    '::-webkit-scrollbar{display:none}' +
    'a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,' +
    '[role="button"]:focus-visible,[role="link"]:focus-visible,[role="tab"]:focus-visible,[role="option"]:focus-visible,' +
    '.tv-focus:focus{outline:4px solid #fe2c55 !important;outline-offset:2px}' +
    '.tv-nofocus:focus{outline:none !important}';
  /* Phone-app look on feed pages (For You, Following…): video edge to edge, menu hidden. TikTok frames each
     feed item with a 16px border plus `clip-path: inset(16px 0 round 16px)` and sizes the list 32px taller to
     make room; all of that goes, so items are exactly one screen tall. The menu (sidebar) slides in when the
     pointer reaches the left edge, or with Back on For You (see tvMenu below). */
  style.textContent +=
    // (the sidebar sits inside its placeholder, so the placeholder is collapsed rather than hidden)
    'html.tv-feed [class*="DivSideNavPlaceholderContainer"]{width:0!important;min-width:0!important;flex:0 0 0!important;overflow:visible!important}' +
    'html.tv-feed [class*="DivSideNavContainer"]{transform:translateX(-100%);z-index:1000;background:rgba(0,0,0,.92)!important}' +
    'html.tv-feed.tv-menu [class*="DivSideNavContainer"]{transform:none}' +
    'html.tv-menu [class*="DivSideNavContainer"] a.tv-focus{outline:none!important;background:rgba(254,44,85,.3)!important;border-radius:8px!important}' +
    'html.tv-feed main[class*="DivMainContainer"]{margin-left:0!important;left:0!important;width:100%!important;max-width:none!important;padding:0!important}' +
    'html.tv-feed [class*="DivPlayerColumn"]{padding:0!important}' +
    'html.tv-feed [class*="DivColumnListContainer"]{margin:0!important;height:100%!important}' +
    'html.tv-feed article[data-e2e="recommend-list-item-container"]{border:0!important;clip-path:none!important;padding:0!important;margin:0!important;width:100%!important;max-width:none!important}' +
    'html.tv-feed [class*="DivContentFlexLayout"]{height:100%!important;max-height:none!important;margin:0!important;padding:0!important}' +
    'html.tv-feed [class*="SectionMediaCardContainer"]{height:100%!important;max-height:none!important;width:100%!important;border-radius:0!important}' +
    'html.tv-feed [class*="SectionMediaCardContainer"] *{border-radius:0!important}' +
    'html.tv-feed [class*="DivBasicPlayerWrapper"]{border-radius:0!important;top:0!important;left:0!important;width:100%!important;height:100%!important;margin:0!important}' +
    'html.tv-feed [class*="DivFeedNavigationContainer"]{display:none!important}';
  // ...and never on large page areas, whatever their role.
  addEventListener('focusin', function (e) {
    var t = e.target; if (!t || !t.getBoundingClientRect) return;
    var r = t.getBoundingClientRect();
    if (r.width > 600 && r.height > 400) t.classList.add('tv-nofocus');
  }, true);

  /* ---------- feed actions ---------- */
  /* ---------- LIVE page ----------
     The Discover LIVE hero carousel uses plain clickable <div>s (no button role/label) for its up/down
     arrows and for the "Go LIVE and own the moment" promo, which covers the player and blocks the remote. */
  function liveArrows() {
    var cs = document.querySelectorAll('div.pointer-events-none.absolute');
    for (var i = 0; i < cs.length; i++) {
      var l = cs[i].querySelectorAll('div.pointer-events-auto');
      if (l.length === 2 && visible(l[0])) return l;
    }
    return null;
  }
  setInterval(function () {
    if (!isLive() || document.hidden) return;
    var ds = document.querySelectorAll('div.cursor-pointer');
    for (var i = 0; i < ds.length; i++) {
      if ((ds[i].innerText || '').trim() !== 'Next time' || !visible(ds[i])) continue;
      var box = ds[i].parentElement && ds[i].parentElement.parentElement;
      if (box && /Go LIVE/.test(box.innerText)) { ds[i].click(); break; }
    }
  }, 1000);

  // A video taking most of the screen: a feed or player page, where Up/Down mean previous/next video.
  // Small videos are hover previews on grid pages (Explore, Short dramas list), which just scroll.
  function feedVideo() {
    var v = bestVideo();
    return v && v.getBoundingClientRect().height > innerHeight * 0.5 ? v : null;
  }
  function mainScroller() {
    var se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > se.clientHeight + 4) return se;
    var el = document.elementFromPoint(innerWidth * 0.6, innerHeight / 2);
    return scrollable(el || document.body);
  }
  function page(dir) {
    if (isLive()) { var la = liveArrows(); if (la) { la[dir > 0 ? 1 : 0].click(); return; } }
    if (!feedVideo()) { var ms = mainScroller(); ms.scrollBy({ top: dir * ms.clientHeight * 0.6, behavior: 'smooth' }); return; }
    // Let TikTok's own (trusted) arrow handling run first; scroll only if nothing moved.
    var v = bestVideo(), src = v && v.currentSrc, sc = scrollable(v || document.body), before = sc.scrollTop;
    setTimeout(function () {
      var nv = bestVideo();
      if (sc.scrollTop !== before || (nv && nv.currentSrc !== src)) return;
      var btn = document.querySelector(dir > 0 ? '[data-e2e="arrow-right"],button[aria-label*="next" i]'
                                               : '[data-e2e="arrow-left"],button[aria-label*="previous" i]');
      if (btn && visible(btn)) return btn.click();
      sc.scrollBy({ top: dir * sc.clientHeight, behavior: 'smooth' });
    }, 500);
  }
  function safePlay(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  // A pause by the user belongs to that video, not to the <video> element (TikTok reuses elements for the
  // next video/episode), so it is remembered by source.
  function srcOf(v) { return v.currentSrc || v.getAttribute('src') || '#'; }
  function userPaused(v) { return !!v.__tvUserPaused && v.__tvUserPaused === srcOf(v); }
  function togglePlay() {
    var v = bestVideo(); if (!v) return;
    if (v.paused) { v.__tvUserPaused = false; safePlay(v); toast('▶'); }
    else { v.__tvUserPaused = srcOf(v); v.pause(); toast('❚❚'); }
  }

  /* ---------- autoplay keeper + stall watchdog ----------
     On webOS TikTok often leaves the on-screen video paused at 0:00, and its MSE videos get stuck
     "seeking" at ~0.07s (the start of the buffered range) even though the whole clip is buffered:
     no frames render. Cause (verified on a 50UR7550): the TV has very few hardware video decoders and
     TikTok's off-screen <video> elements (previous video, preloaded next one) keep holding them even
     while paused. Every 700ms:
     - pause off-screen videos,
     - play the centred video unless the user paused it (OK button, or a pointer click just before the pause),
     - if it is meant to play and has data buffered ahead but no new frames have rendered for 1.5s,
       release the decoders held by the other <video> elements (unload them, see releaseOthers);
       if it is still stuck 2s later, nudge currentTime once just past the start of the buffered range.
     Switching videos/episodes is handled immediately by the play/error listeners below: the 700ms tick is
     too slow, and the new video fails with a decode error (MEDIA_ERR_DECODE, shown by TikTok as
     "Something went wrong") while the previous one still holds the decoder. */
  var lastClick = 0;
  addEventListener('mousedown', function () { lastClick = Date.now(); }, true);
  document.addEventListener('pause', function (e) {
    if (Date.now() - lastClick < 1500 && e.target === bestVideo()) e.target.__tvUserPaused = srcOf(e.target);
  }, true);
  document.addEventListener('play', function (e) {
    var v = e.target, vs = document.querySelectorAll('video');
    v.__tvUserPaused = false;
    for (var i = 0; i < vs.length; i++) if (vs[i] !== v && !vs[i].paused) vs[i].pause();
  }, true);
  // Decode error on the video being watched: free every other decoder so TikTok's own retry can get one.
  document.addEventListener('error', function (e) {
    var v = e.target;
    if (v && v.tagName === 'VIDEO' && v.error && v.error.code === 3 && v === bestVideo()) releaseOthers(v);
  }, true);
  var wd = { v: null, src: '', mark: -1, since: 0, step: 0 };
  function progress(v) {             // rendered frames when available (audio can advance currentTime alone)
    var q = v.getVideoPlaybackQuality && v.getVideoPlaybackQuality();
    return q ? q.totalVideoFrames + v.currentTime / 1000 : v.currentTime;
  }
  function hasDataAhead(v) {
    var b = v.buffered;
    return v.readyState >= 1 && b.length > 0 && b.end(b.length - 1) > v.currentTime + 0.5;
  }
  // Unload other videos to free their decoders, remembering plain-URL sources so restore() can put them
  // back when the element comes on screen (TikTok reuses <video> elements and won't re-attach a source
  // itself). blob: (MediaSource) sources can't be re-attached, so those are only released once they are
  // fully above the screen (already watched).
  function releaseOthers(cur) {
    var vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i], s = v.getAttribute('src');
      if (v === cur || !s) continue;
      var blob = s.indexOf('blob:') === 0;
      if (blob && v.getBoundingClientRect().bottom > 0) continue;
      try { if (!blob) { v.__tvSrc = s; v.__tvTime = v.currentTime; } v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    }
  }
  function restore(v) {
    if (!v.__tvSrc || v.getAttribute('src')) return;
    var t = v.__tvTime || 0; v.src = v.__tvSrc; v.__tvSrc = null;
    if (t > 0) v.addEventListener('loadedmetadata', function () { try { v.currentTime = t; } catch (e) {} }, { once: true });
  }
  setInterval(function () {
    if (document.hidden) return;
    var bv = bestVideo(), now = Date.now(), vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) if (vs[i] !== bv && !vs[i].paused) vs[i].pause();
    var v = bv && bv.getBoundingClientRect().height > innerHeight * 0.5 ? bv : null;   // (= feedVideo())
    if (v) restore(v);
    if (!v || v.ended || userPaused(v) || openDialog()) { wd.v = null; return; }
    if (v.paused) safePlay(v);
    var p = progress(v);
    if (v !== wd.v || v.currentSrc !== wd.src) { wd = { v: v, src: v.currentSrc, mark: p, since: now, step: 0 }; return; }
    if (p !== wd.mark || !hasDataAhead(v)) { wd.mark = p; wd.since = now; return; }   // progressing, or still loading
    if (wd.step === 0 && now - wd.since >= 1500) {
      wd.step = 1; wd.since = now; releaseOthers(v); safePlay(v);
    } else if (wd.step === 1 && now - wd.since >= 2000 && v.buffered.length) {
      wd.step = 2;
      var s = v.buffered.start(0), e = v.buffered.end(v.buffered.length - 1);
      if (e > v.currentTime + 0.5 && v.currentTime < s + 0.3) { try { v.currentTime = s + 0.2; } catch (x) {} safePlay(v); }
    }
  }, 700);

  /* Mute through TikTok's own sound button so its icon and state stay in sync (toggling video.muted
     directly left TikTok showing "muted" while sound played). Its button reacts to pointer events,
     not a bare click(). Falls back to toggling the video if no button is found or nothing changed. */
  var SOUND_BTN = '[data-e2e="cinema-playback-control-volume"] button, button[aria-label="Volume"], ' +
    '[data-e2e="video-sound"], [data-e2e*="mute"], [class*="DivMuteIconContainer"], [class*="DivVolumeIcon"]';
  function soundButton(v) {
    var bs = document.querySelectorAll(SOUND_BTN), best = null, d = 1e9, vr = v.getBoundingClientRect();
    for (var i = 0; i < bs.length; i++) {
      if (!visible(bs[i])) continue;
      var r = bs[i].getBoundingClientRect(), dd = Math.abs(r.top - vr.bottom) + Math.abs(r.left - vr.left) / 4;
      if (dd < d) { d = dd; best = bs[i]; }
    }
    return best;
  }
  function pointerPress(el) {
    var r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
    ['pointerover', 'pointerenter', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
      el.dispatchEvent(t.indexOf('pointer') === 0 ? new PointerEvent(t, o) : new MouseEvent(t, o));
    });
    setTimeout(function () {                         // close the volume slider TikTok opens on hover
      ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'].forEach(function (t) {
        el.dispatchEvent(t.indexOf('pointer') === 0 ? new PointerEvent(t, o) : new MouseEvent(t, o));
      });
    }, 300);
  }
  function toggleMute() {
    var v = bestVideo(); if (!v) return;
    var before = v.muted, b = soundButton(v);
    function done() { if (!v.muted && v.volume === 0) v.volume = 1; toast(v.muted ? 'Muted' : 'Sound on'); }
    if (!b) { v.muted = !before; return done(); }
    pointerPress(b);
    setTimeout(function () {
      if (v.muted !== before) return done();
      // Unchanged: TikTok's icon was out of sync with the video, so that press only fixed its icon.
      pointerPress(b);
      setTimeout(function () { if (v.muted === before) v.muted = !before; done(); }, 500);
    }, 500);
  }
  function like() {
    var icons = document.querySelectorAll('[data-e2e="like-icon"],[data-e2e="browse-like-icon"]'), best = null, d = 1e9;
    for (var i = 0; i < icons.length; i++) {
      if (!visible(icons[i])) continue;
      var r = icons[i].getBoundingClientRect(), dd = Math.abs(r.top + r.height / 2 - innerHeight / 2);
      if (dd < d) { d = dd; best = icons[i]; }
    }
    if (best) { (best.closest('button') || best).click(); toast('♥'); }
    else sendKey('l', 'KeyL', 76, document.body);
  }
  // window.close() first: it closes the app for real (memory and video decoders freed). platformBack() exists on
  // tiktok.com pages but did nothing on webOS 10.3 (QA 2026-11-21), so it is only the fallback.
  function exitApp() {
    try { window.close(); } catch (e) {}
    setTimeout(function () {
      try { if (window.webOSSystem && webOSSystem.platformBack) return webOSSystem.platformBack(); } catch (e) {}
      try { if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack(); } catch (e) {}
    }, 300);
  }
  /* ---------- phone-app look: feed pages full screen, menu on demand (styles above) ---------- */
  var ROOT = document.documentElement;
  function sideNav() { return document.querySelector('[class*="DivSideNavContainer"]'); }
  function isHome() { return /^\/(foryou)?\/?$/.test(location.pathname); }
  function menuOpen() { return ROOT.classList.contains('tv-feed') && ROOT.classList.contains('tv-menu'); }
  // Remote focus in the menu moves over its page links only (For You, Explore, … Profile, More), starting
  // at the current page's link; TikTok's other sidebar controls (collapse button, search) are skipped.
  function menuMove(dir) {
    var n = sideNav(); if (!n) return;
    var all = n.querySelectorAll('a[href]'), list = [];
    for (var i = 0; i < all.length; i++) if (visible(all[i]) && all[i].getBoundingClientRect().top > 100) list.push(all[i]);
    if (!list.length) return;
    var idx = list.indexOf(document.activeElement), next;
    if (idx < 0) {
      for (i = 0; i < list.length; i++) if (list[i].pathname === location.pathname) next = list[i];
      next = next || list[0];
    } else next = list[Math.max(0, Math.min(list.length - 1, idx + (dir || 0)))];
    var prev = document.querySelector('.tv-focus'); if (prev) prev.classList.remove('tv-focus');
    next.classList.add('tv-focus'); next.focus();
  }
  function showMenu(on, focus) {
    ROOT.classList.toggle('tv-menu', !!on);
    var n = sideNav();
    if (on && focus) menuMove(0);
    if (!on && n && n.contains(document.activeElement)) document.activeElement.blur();
  }
  setInterval(function () {                          // feed pages are the ones with TikTok's video list
    // (the Short dramas player uses the same list but keeps TikTok's own layout, with its episode panel)
    var feed = !isLive() && !isDrama() && !!document.querySelector('article[data-e2e="recommend-list-item-container"]');
    if (feed !== ROOT.classList.contains('tv-feed')) { ROOT.classList.toggle('tv-feed', feed); if (!feed) showMenu(false); }
  }, 500);
  addEventListener('mousemove', function (e) {       // Magic Remote pointer at the left edge opens the menu
    if (!ROOT.classList.contains('tv-feed')) return;
    if (e.clientX < 30) { if (!menuOpen()) showMenu(true); }
    else if (e.clientX > 280 && menuOpen()) showMenu(false);
  }, true);
  addEventListener('click', function (e) {          // picking a menu item closes the menu
    var n = sideNav();
    if (menuOpen() && n && n.contains(e.target) && e.target.closest('a[href]')) showMenu(false);
  }, true);

  function goBack() {
    var d = openDialog();
    if (d) return closeDialog(d);
    // Phone-style Back on the feed: the first Back on For You opens the menu, the next one returns to TV mode.
    if (menuOpen()) { if (isHome()) return backToTvMode(); return showMenu(false); }
    if (ROOT.classList.contains('tv-feed') && isHome()) { showMenu(true, true); return toast('Press Back again for TV mode', 2500); }
    if (history.length > 1 && !/^\/(foryou)?\/?$/.test(location.pathname)) history.back();
    else backToTvMode();
  }
  function backToTvMode() { location.href = TV_URL; }

  /* Remember what TV mode needs from the full site: region/language/login (TikTok's page data) and the
     address of TikTok's request-signing script (it carries a version number that changes over time). */
  function saveTvContext() {
    try {
      var el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__'); if (!el) return;
      var a = (JSON.parse(el.textContent).__DEFAULT_SCOPE__ || {})['webapp.app-context'] || {};
      var ctx = { region: a.region, language: a.language, login: !!(a.user && a.user.uid), wid: a.wid };
      var sdk = [].filter.call(document.scripts, function (s) { return /\/webmssdk\/[\d.]+\/webmssdk\.js/.test(s.src); })[0];
      if (sdk) ctx.sdk = sdk.src;
      if (ctx.region) localStorage.setItem('tvCtx', JSON.stringify(ctx));
    } catch (e) {}
  }

  /* ---------- key handling ---------- */
  addEventListener('keydown', function (e) {
    if (!e.isTrusted) return;                        // keys we send to TikTok ourselves (sendKey)
    var k = e.keyCode, t = e.target || document.activeElement;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    var onControl = !!(t && t !== document.body && t.matches && t.matches(FOCUSABLE) && !t.classList.contains('tv-nofocus'));
    var dialog = openDialog(), used = true;
    // TikTok's security check ("Drag the slider to fit the puzzle"): leave every key to the TV. The puzzle is
    // solved by holding OK on the Magic Remote and moving the pointer; taking over OK here (as for other
    // dialogs) cancelled that press, so the slider never moved.
    if (dialog && isCaptcha(dialog)) return;

    if (k === KEY.BACK || k === KEY.ESC) {
      if (typing) t.blur(); else goBack();
    } else if (k === KEY.CH_UP || k === 187 || k === 107) {
      if (typing) return; changeZoom(1);
    } else if (k === KEY.CH_DOWN || k === 189 || k === 109) {
      if (typing) return; changeZoom(-1);
    } else if (typing) {
      // Up/Down leave a text field so the user can reach buttons below it.
      if (dialog && (k === KEY.UP || k === KEY.DOWN)) moveFocus(dialog, k === KEY.DOWN ? 1 : -1); else return;
    } else if (menuOpen() && !dialog) {
      // Menu open: Up/Down move through it, OK opens the item, Right/Left close it.
      if (k === KEY.DOWN || k === KEY.UP) menuMove(k === KEY.DOWN ? 1 : -1);
      else if (k === KEY.OK) { if (onControl) t.click(); else menuMove(0); }
      else if (k === KEY.RIGHT || k === KEY.LEFT) showMenu(false);
      else used = false;
    } else if (dialog) {
      // Inside login / comment dialogs: arrows move focus, OK clicks.
      if (k === KEY.DOWN || k === KEY.RIGHT) moveFocus(dialog, 1);
      else if (k === KEY.UP || k === KEY.LEFT) moveFocus(dialog, -1);
      else if (k === KEY.OK) { if (onControl) t.click(); else moveFocus(dialog, 1); }
      else used = false;
    } else {
      switch (k) {
        // On video pages let TikTok see the real key too; on grid pages page() does all the scrolling.
        case KEY.UP: used = (isLive() && !!liveArrows()) || !feedVideo(); page(-1); break;
        case KEY.DOWN: used = (isLive() && !!liveArrows()) || !feedVideo(); page(1); break;
        case KEY.OK: if (onControl) used = false; else togglePlay(); break;
        case KEY.RIGHT: like(); break;
        case KEY.LEFT: toggleMute(); break;
        case KEY.PLAY: case KEY.PAUSE: case KEY.PLAYPAUSE: togglePlay(); break;
        case KEY.RED: location.reload(); break;
        case KEY.GREEN: location.href = '/foryou'; break;
        case KEY.YELLOW: location.href = '/following'; break;
        case KEY.BLUE: location.href = '/explore'; break;
        default: used = false;
      }
    }
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ---------- videos that failed to play ----------
     When a video fails, TikTok replaces it with "We're having trouble playing this video. Please refresh
     and try again." and removes its player. The video then never ends, so Auto scroll stops there for
     good. If the item in the middle of the screen shows that error for 4s:
     - on Short dramas: reload the page, which retries the same episode (the URL names the episode), up to
       2 times per episode; after that, ask for the red button instead of skipping the episode;
     - elsewhere (For You etc.): go to the next video. */
  var DRAMA_RETRIES = 2;
  function isDrama() { return /^\/shortdrama\//.test(location.pathname); }
  function dramaKey() { return 'tvDramaRetry:' + location.pathname; }
  function dramaRetries() { try { return parseInt(sessionStorage.getItem(dramaKey()), 10) || 0; } catch (e) { return 0; } }
  setInterval(function () {                          // episode is playing: forget its retries
    if (!isDrama()) return;
    var v = bestVideo();
    if (v && v.duration && v.currentTime > v.duration - 5) { try { sessionStorage.removeItem(dramaKey()); } catch (e) {} }
  }, 2000);
  var failed = { item: null, since: 0, skipped: null };
  setInterval(function () {
    if (document.hidden || isLive() || openDialog()) return;
    var ps = document.querySelectorAll('p[class*="ErrorText"]'), item = null;
    for (var i = 0; i < ps.length; i++) {
      var r = ps[i].getBoundingClientRect();
      if (r.width && r.top > innerHeight * 0.2 && r.bottom < innerHeight * 0.8 && /trouble playing/i.test(ps[i].textContent)) {
        item = ps[i].closest('[data-e2e="recommend-list-item-container"], article') || ps[i]; break;
      }
    }
    if (!item) { failed.item = null; return; }
    if (item !== failed.item) { failed.item = item; failed.since = Date.now(); return; }
    if (item === failed.skipped || Date.now() - failed.since < 4000) return;
    failed.skipped = item;
    if (isDrama()) {
      var n = dramaRetries();
      if (n >= DRAMA_RETRIES) { toast('This episode couldn’t play. Press the red button to try again.'); return; }
      try { sessionStorage.setItem(dramaKey(), String(n + 1)); } catch (e) {}
      toast('Episode couldn’t play, retrying (' + (n + 1) + '/' + DRAMA_RETRIES + ')…');
      setTimeout(function () { location.reload(); }, 1500);
      return;
    }
    toast('Skipped a video that couldn’t play');
    var next = document.querySelector('button[data-e2e="feed-navigation-next"]');
    if (next && !next.disabled) next.click(); else page(1);
  }, 1000);

  /* ---------- LIVE previews in the feed ----------
     For You mixes in "LIVE now" preview cards. Their stream never ends, so Auto scroll never moves on, and on
     the TV the preview often freezes as well: the feed looked hung. If one is in the middle of the screen for
     8s and no remote key or pointer click came in meanwhile, go to the next video. (OK on it still opens LIVE.) */
  var lastInput = 0;
  addEventListener('keydown', function () { lastInput = Date.now(); }, true);
  addEventListener('mousedown', function () { lastInput = Date.now(); }, true);
  var livePrev = { item: null, since: 0 };
  setInterval(function () {
    if (document.hidden || isLive() || isDrama() || openDialog() || menuOpen()) return;
    var arts = document.querySelectorAll('article[data-e2e="recommend-list-item-container"]'), item = null;
    for (var i = 0; i < arts.length; i++) {
      var r = arts[i].getBoundingClientRect();
      if (r.top < innerHeight / 2 && r.bottom > innerHeight / 2) { item = arts[i]; break; }
    }
    if (!item || !item.querySelector('[class*="DivRecommendLivePlayer"], [class*="LivePlayer"]')) { livePrev.item = null; return; }
    if (item !== livePrev.item) { livePrev = { item: item, since: Date.now() }; return; }
    if (Date.now() - livePrev.since < 8000 || Date.now() - lastInput < 8000) return;
    livePrev.since = Date.now() + 1e9;                 // once per card
    toast('Skipped a LIVE preview');
    var next = document.querySelector('button[data-e2e="feed-navigation-next"]');
    if (next && !next.disabled) next.click(); else page(1);
  }, 1000);

  /* ---------- recover from CDN error pages ----------
     Sometimes tiktok.com's CDN (Akamai) answers the page load with a bare "An error occurred while
     processing your request. Reference #102..." page; plain reloads can get the same page again, while a
     load with a cache-busting parameter works. Retry like that, up to 5 times with growing delays. */
  function recoverFromCdnError() {
    var t = document.body ? document.body.innerText : '';
    if (!/errors\.edgesuite\.net|An error occurred while processing your request/.test(t) || document.querySelector('#app, [id^="main-content"]')) return;
    var n = 0;
    try { n = parseInt(sessionStorage.getItem('tvCdnRetry'), 10) || 0; sessionStorage.setItem('tvCdnRetry', String(n + 1)); } catch (e) {}
    if (n >= 5) { toast('TikTok is not responding. Press the red button to try again.'); try { sessionStorage.removeItem('tvCdnRetry'); } catch (e) {} return; }
    var delay = 3000 * (n + 1);
    toast('TikTok did not load, retrying in ' + delay / 1000 + 's…');
    setTimeout(function () {
      var u = location.pathname + (location.search ? location.search.replace(/([?&])_tvr=\d+&?/, '$1').replace(/[?&]$/, '') : '');
      location.replace(u + (u.indexOf('?') < 0 ? '?' : '&') + '_tvr=' + Date.now());
    }, delay);
  }

  function init() {
    (document.head || document.documentElement).appendChild(style);
    applyZoom(false);
    recoverFromCdnError();
    if (document.querySelector('#app, [id^="main-content"]')) { try { sessionStorage.removeItem('tvCdnRetry'); } catch (e) {} }
    saveTvContext(); setTimeout(saveTvContext, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  /* ================= TV mode =================
     The app's own light player. TikTok's desktop site keeps this TV's CPU near 100% (next video 7-13s,
     page switches up to a minute). TV mode instead runs on a bare tiktok.com document (robots.txt, so
     TikTok's cookies and login apply), loads only TikTok's request-signing script (webmssdk, which
     signs fetch() calls to the listed API paths exactly as on TikTok's own pages), asks TikTok's web API for
     the drama/feed lists and plays them in one plain <video>: about 1s per video, ~2% CPU.
     Anything TV mode doesn't do (LIVE, search, comments, logging in) is one button away on the full site. */
  function tvMode() {
    var SDK_DEFAULT = 'https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/webmssdk/1.0.0.422/webmssdk.js';
    var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, PLAY: 415, PAUSE: 19, PLAYPAUSE: 463,
      FF: 417, RW: 412, RED: 403 };
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    var ctx = lsGet('tvCtx', {}) || {};
    var REGION = ctx.region || 'PH', LANG = ctx.language || 'en';
    var BASE, baseFor = function () { BASE = 'aid=1988&app_name=tiktok_web&device_platform=web_pc&browser_platform=Linux&app_language=' + LANG +
      '&language=' + LANG + '&region=' + REGION + '&storeRegion=' + REGION + '&priority_region=' + REGION +
      '&user_is_login=' + (ctx.login === false ? 'false' : 'true') + (ctx.wid ? '&device_id=' + ctx.wid : ''); };
    baseFor();
    // No saved context yet (fresh install, full site never opened): read it once from TikTok's For You page as
    // plain text (its page data), without running any of the page's scripts.
    var ctxReady = ctx.wid ? Promise.resolve() : fetch('/foryou', { credentials: 'include' }).then(function (r) { return r.text(); }).then(function (t) {
      var m = t.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
      var a = ((JSON.parse(m[1]).__DEFAULT_SCOPE__ || {})['webapp.app-context']) || {};
      ctx.region = a.region || ctx.region; ctx.language = a.language || ctx.language; ctx.login = !!(a.user && a.user.uid); ctx.wid = a.wid;
      lsSet('tvCtx', ctx); REGION = ctx.region || REGION; LANG = ctx.language || LANG; baseFor();
    }).catch(function () {});
    var E = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    // window.close() first: it closes the app for real (memory and video decoders freed). platformBack() exists on
    // tiktok.com pages but did nothing on webOS 10.3 (QA 2026-11-21), so it is only the fallback.
    function exit() {
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        try { if (window.webOSSystem && webOSSystem.platformBack) return webOSSystem.platformBack(); } catch (e) {}
        try { if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack(); } catch (e) {}
      }, 300);
    }
    function fullSite(path) { location.href = 'https://www.tiktok.com' + (path || '/foryou'); }

    /* ---------- page ---------- */
    function build() {
      document.title = 'TikTok';
      var css = E('style'); css.textContent =
        'html,body{margin:0;height:100%;background:#000;color:#fff;font-family:"TikTok Sans",Roboto,Arial,sans-serif;overflow:hidden}' +
        'pre{display:none}*{box-sizing:border-box}' +
        '#tv-home{position:fixed;inset:0;padding:28px 0 0 48px;overflow:hidden;background:radial-gradient(ellipse at top left,#1b1b24,#000 60%)}' +
        '#tv-home h1{margin:0 0 6px;font-size:30px;font-weight:700}#tv-home h1 b{color:#fe2c55}#tv-home h1 i{color:#25f4ee;font-style:normal}' +
        '#tv-rows{position:relative;transition:transform .2s}' +
        '.tv-row{margin:18px 0 0}.tv-row h2{margin:0 0 10px;font-size:20px;font-weight:600;color:#ddd}' +
        '.tv-track{display:flex;gap:16px;transition:transform .2s;padding:6px 4px}' +
        '.tv-card{flex:0 0 auto;width:150px;border-radius:10px;background:#1c1c22;overflow:hidden;position:relative;outline:3px solid transparent;transition:transform .12s}' +
        '.tv-card img{display:block;width:150px;height:200px;object-fit:cover;background:#222}' +
        '.tv-card .t{padding:6px 8px 2px;font-size:14px;line-height:1.25;height:42px;overflow:hidden}' +
        '.tv-card .s{padding:0 8px 8px;font-size:12px;color:#aaa}' +
        '.tv-card .bar{position:absolute;left:0;top:196px;height:4px;background:#fe2c55}' +
        '.tv-row.cont{margin-top:10px}.tv-card.wide{width:220px;height:120px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:12px}' +
        '.tv-card.wide .ico{font-size:34px;margin-bottom:6px;height:34px}.tv-card.wide .t{height:auto;font-size:18px;font-weight:600}.tv-card.wide .s{padding:4px 0 0}' +
        '.tv-card.focus{outline-color:#fe2c55;transform:scale(1.06);z-index:2}' +
        '.tv-msg{color:#aaa;font-size:16px;padding:20px 4px}' +
        '#tv-drama{position:fixed;inset:0;display:none;padding:40px 48px;background:#000;overflow:hidden}' +
        '#tv-dwrap{transition:transform .2s}#tv-drama .recs h2{font-size:20px;font-weight:600;color:#ddd;margin:0 0 10px}#tv-drama .recs{margin-top:26px}#tv-drama .recs .tv-track{padding-left:4px}' +
        '#tv-search{position:fixed;inset:0;display:none;padding:34px 0 0 48px;background:#000;overflow:hidden}' +
        '#tv-search h1{margin:0 0 14px;font-size:28px}#tv-sin{width:640px;height:54px;border-radius:27px;border:3px solid #444;background:#1c1c22;color:#fff;font-size:22px;padding:0 24px;outline:none}' +
        '#tv-sin.focus,#tv-sin:focus{border-color:#fe2c55}#tv-sres{transition:transform .2s}' +
        '#tv-genre{position:fixed;inset:0;display:none;padding:34px 0 0 48px;background:#000;overflow:hidden}#tv-genre h1{margin:0 0 6px;font-size:28px}#tv-gres{transition:transform .2s}' +
        '#tv-drama .tags span.focus{outline:3px solid #fff;background:#fe2c55;color:#fff}' +
        '#tv-drama .top{display:flex;gap:28px}#tv-drama .top img{width:180px;height:240px;object-fit:cover;border-radius:10px;background:#222}' +
        '#tv-drama .tags{margin:0 0 12px}#tv-drama .tags span{display:inline-block;margin:0 8px 6px 0;padding:3px 12px;border-radius:14px;background:#2a2a33;color:#ccc;font-size:14px}' +
        '#tv-drama h2{margin:0 0 10px;font-size:30px}#tv-drama p{margin:0 0 16px;color:#bbb;font-size:15px;line-height:1.4;max-width:820px;max-height:126px;overflow:hidden}' +
        '#tv-drama .eps{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px;max-height:290px;overflow:hidden}' +
        '#tv-drama .ep,#tv-drama .btn{min-width:62px;height:46px;border-radius:8px;background:#26262e;display:flex;align-items:center;justify-content:center;font-size:18px;outline:3px solid transparent}' +
        '#tv-drama .btn{display:inline-flex;padding:0 22px;background:#fe2c55;font-weight:600}' +
        '#tv-drama .ep.seen{color:#888}#tv-drama .ep.cur{background:#4a1a26}#tv-drama .focus{outline-color:#fff}' +
        '#tv-player{position:fixed;inset:0;display:none;background:#000}' +
        '#tv-player video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}' +
        '#tv-ov{position:absolute;left:0;right:0;bottom:0;padding:60px 40px 26px;background:linear-gradient(transparent,rgba(0,0,0,.75));transition:opacity .4s}' +
        '#tv-ov .a{font-size:22px;font-weight:700}#tv-ov .d{font-size:16px;color:#ddd;margin-top:6px;max-width:900px;max-height:44px;overflow:hidden}' +
        '#tv-ov .bar{height:4px;background:rgba(255,255,255,.25);margin-top:14px;border-radius:2px}#tv-ov .bar i{display:block;height:100%;width:0;background:#fe2c55;border-radius:2px}' +
        '#tv-ov.hide{opacity:0}' +
        '#tv-spin{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:20px;color:#ccc;display:none}' +
        '#tv-toast{position:fixed;right:30px;top:24px;z-index:9;background:rgba(0,0,0,.8);color:#fff;font-size:22px;padding:10px 20px;border-radius:10px;opacity:0;transition:opacity .3s;pointer-events:none}';
      document.head.appendChild(css);
      document.body.innerHTML =
        '<div id="tv-home"><div id="tv-rows"><h1><b>Tik</b><i>Tok</i> TV</h1></div></div>' +
        '<div id="tv-drama"></div>' +
        '<div id="tv-genre"><h1></h1><div id="tv-gres"></div></div>' +
        '<div id="tv-search"><h1>Search short dramas</h1><input id="tv-sin" type="text" placeholder="Drama name, e.g. sci-fi, fantasy, CEO…" autocomplete="off">' +
        '<div id="tv-sres"></div></div>' +
        '<div id="tv-player"><video id="tv-video" playsinline></video><div id="tv-spin">Loading…</div>' +
        '<div id="tv-ov"><div class="a"></div><div class="d"></div><div class="bar"><i></i></div></div></div>' +
        '<div id="tv-toast"></div>';
    }
    var toastTm;
    function toast(m, ms) {
      var t = document.getElementById('tv-toast'); t.textContent = m; t.style.opacity = '1';
      clearTimeout(toastTm); toastTm = setTimeout(function () { t.style.opacity = '0'; }, ms || 1500);
    }

    /* ---------- TikTok API (signed by TikTok's own webmssdk) ---------- */
    var sdkReady = null;
    function loadSdk() {
      if (sdkReady) return sdkReady;
      sdkReady = new Promise(function (ok, ko) {
        function load(src, fallback) {
          var s = document.createElement('script'); s.src = src;
          s.onload = function () {
            try {
              window.byted_acrawler.init({ aid: 1988, dfp: false, boe: false, intercept: true,
                enablePathList: ['/api/recommend/item_list/', '/api/following/item_list/', '/api/explore/item_list/', '/api/drama/', '/api/search/'], region: 'sg-tiktok', apiHost: '',
                mode: ctx.login === false ? 516 : 513, isSDK: false, custom: {} });
              ok();
            } catch (e) { ko(e); }
          };
          s.onerror = function () { if (fallback) load(fallback); else ko(new Error('sdk')); };
          document.head.appendChild(s);
        }
        load(ctx.sdk || SDK_DEFAULT, ctx.sdk && ctx.sdk !== SDK_DEFAULT ? SDK_DEFAULT : null);
      });
      return sdkReady;
    }
    function api(path, params) {
      return Promise.all([loadSdk(), ctxReady]).then(function () {
        return fetch(path + '?' + params + '&' + BASE, { credentials: 'include' });
      }).then(function (r) { return r.text(); }).then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { throw new Error('empty'); }
        if (j.statusCode !== 0 && j.status_code !== 0) throw new Error('status ' + (j.statusCode || j.status_code));
        return j;
      });
    }
    function playUrl(item) {
      var v = item && item.video || {}, list = (v.PlayAddrStruct || {}).UrlList || [];
      for (var i = 0; i < list.length; i++) if (/\/aweme\/v1\/play\//.test(list[i])) return list[i];
      return list[0] || v.playAddr || null;   // (v*-webapp-prime URLs need a cookie the TV's player doesn't send)
    }
    function coverOf(d) {
      var z = d.zoomCover || {}, c = d.cover && d.cover.urlList;
      return z['480'] || z['240'] || (c && c[0]) || '';
    }

    /* ---------- genres and recommendations ----------
       Each drama carries genre tags (themes: [{tagID, tagKey 'tag_Fantasy_GeneralSettings', tagVal 'Fantasy'}]).
       Recommendations are TikTok's own "more like this" list for a drama (needs its creator's ID); it mixes
       genres, so the ones sharing the most tags with the drama come first. */
    function tagsOf(d) { return (d && d.themes || []).filter(function (t) { return t && t.tagVal; }); }
    function genreOf(d) {
      var t = tagsOf(d), g = t.filter(function (x) { return /GeneralSettings/i.test(x.tagKey || ''); })[0] || t[0];
      return g ? g.tagVal : '';
    }
    function shared(a, b) {
      var ids = {}, n = 0; tagsOf(a).forEach(function (t) { ids[t.tagID] = 1; });
      tagsOf(b).forEach(function (t) { if (ids[t.tagID]) n += /GeneralSettings/i.test(t.tagKey || '') ? 3 : 1; });
      return n;
    }
    var seenDramas = {};   // every drama any list showed, for search
    function remember(list) {
      list = (list || []).filter(function (d) { return d && d.dramaID; });
      list.forEach(function (d) { if (!seenDramas[d.dramaID] || d.themes) seenDramas[d.dramaID] = d; });
      return list;
    }
    var detailP = {}, recP = {};
    function detail(d) {
      return detailP[d.dramaID] || (detailP[d.dramaID] = api('/api/drama/detail/', 'dramaID=' + d.dramaID).then(function (j) { return j.dramaInfo || {}; })
        .catch(function (e) { delete detailP[d.dramaID]; throw e; }));
    }
    function authorOf(d) {
      if (d.authorUID) return Promise.resolve(d.authorUID);
      return detail(d).then(function (i) {
        if (!d.themes && i.themes) d.themes = i.themes;
        d.authorUID = i.authorUID || (i.author && i.author.user && i.author.user.id);
        if (!d.authorUID) throw new Error('no creator');
        return d.authorUID;
      });
    }
    function mainTagId(d) {
      var t = tagsOf(d), g = t.filter(function (x) { return /GeneralSettings/i.test(x.tagKey || ''); })[0] || t[0];
      return g ? g.tagID : null;
    }
    // Fallback when TikTok's per-creator "more like this" is empty or unavailable: other dramas in this
    // drama's main genre. Needs its themes, so fetch the detail first if the list didn't carry them.
    function genreRecsFor(d) {
      return (d.themes ? Promise.resolve() : detail(d).then(function (i) { if (i.themes && !d.themes) d.themes = i.themes; }).catch(function () {}))
        .then(function () {
          var id = mainTagId(d);
          if (!id) return [];
          return api('/api/drama/theme/drama_list/', 'themeType=10&count=21&coverFormat=2&oneColumnMode=true&tagIDList=' + encodeURIComponent(id) + '&cursor=0')
            .then(function (j) { return remember(j.dramaList).filter(function (x) { return x.dramaID !== d.dramaID; }); });
        }).catch(function () { return []; });
    }
    function recsFor(d) {
      return recP[d.dramaID] || (recP[d.dramaID] = authorOf(d).then(function (uid) {
        return api('/api/drama/recommend/drama_list/', 'dramaID=' + d.dramaID + '&authorUID=' + uid + '&coverFormat=2')
          .then(function (j) { return remember(j.dramaList).filter(function (x) { return x.dramaID !== d.dramaID; }); });
      }).catch(function () { return []; })        // no creator / call failed -> fall through to genre
      .then(function (list) {
        if (list && list.length) return list;
        return genreRecsFor(d);                   // same-genre dramas so there's always something related
      }).then(function (list) {
        if (!list.length) { delete recP[d.dramaID]; return list; }   // nothing yet: allow a retry next open
        list.forEach(function (x, i) { x._o = i; });
        return list.sort(function (a, b) { return shared(d, b) - shared(d, a) || a._o - b._o; });
      }).catch(function (e) { delete recP[d.dramaID]; throw e; }));
    }

    /* ---------- progress (TV mode keeps its own: TikTok's history isn't told about our playback) ---------- */
    function progAll() { return lsGet('tvProgress', {}) || {}; }
    function progGet(id) { return progAll()[id] || null; }
    function progSet(d, ep, t) {
      var all = progAll();
      all[d.dramaID] = { ep: ep, t: Math.floor(t || 0), at: Date.now(), name: d.dramaName, cover: coverOf(d), num: d.numVideos, desc: d.description, au: d.authorUID, th: d.themes };
      var ids = Object.keys(all).sort(function (a, b) { return all[b].at - all[a].at; });
      for (var i = 40; i < ids.length; i++) delete all[ids[i]];
      lsSet('tvProgress', all);
    }

    /* ---------- home ----------
       A page of rows you scroll down through: Continue watching, the TikTok row (For You, Following, Full TikTok,
       Reload), then Popular short dramas as a grid of 7 per line that keeps loading as you go down. */
    var rows = [], pos = { r: 0, c: [] }, screen = 'home', GRID = 7, REC = 1, TT = 2, GEN = 3, POP0 = 4;   // POP0: first grid row
    var ICON = function (d) { return '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
    function card(it) {
      var c = E('div', 'tv-card' + (it.wide ? ' wide' : ''));
      if (it.wide) c.innerHTML = '<div class="ico">' + it.icon + '</div><div class="t">' + esc(it.title) + '</div><div class="s">' + esc(it.sub || '') + '</div>';
      else {
        c.innerHTML = '<img loading="lazy" src="' + esc(it.img) + '"><div class="t">' + esc(it.title) + '</div><div class="s">' + esc(it.sub || '') + '</div>' +
          (it.pct ? '<div class="bar" style="width:' + Math.min(100, it.pct) + '%"></div>' : '');
      }
      c.addEventListener('click', function () { it.go(); });
      // only real pointer movement selects (a resting pointer gets mouseenter when the layout moves under it)
      c.addEventListener('mousemove', function () { if (!it.el.classList.contains('focus')) { if (it.hover) it.hover(); else focusCard(it.row, it.col, true); } });
      return c;
    }
    function setRow(i, title, items, msg) {
      var rowsEl = document.getElementById('tv-rows'), el = rows[i] && rows[i].el;
      if (!el) { el = E('div', 'tv-row'); rowsEl.appendChild(el); }
      el.innerHTML = title ? '<h2>' + esc(title) + '</h2>' : '';
      el.className = 'tv-row' + (title ? '' : ' cont');
      var track = E('div', 'tv-track'); el.appendChild(track);
      items.forEach(function (it, j) { it.row = i; it.col = j; it.el = card(it); track.appendChild(it.el); });
      if (!items.length) track.appendChild(E('div', 'tv-msg', esc(msg || 'Nothing here yet')));
      rows[i] = { el: el, track: track, items: items, title: title };
      if (pos.c[i] == null) pos.c[i] = 0;
      if (screen === 'home' && rows[pos.r] && rows[pos.r].items.length) focusCard(pos.r, pos.c[pos.r], true);
    }
    function focusCard(r, c, keepScroll) {
      if (!rows[r]) return;
      var items = rows[r].items; if (!items.length) { pos.r = r; return; }
      c = Math.max(0, Math.min(items.length - 1, c));
      var old = document.querySelector('.tv-card.focus'); if (old) old.classList.remove('focus');
      pos.r = r; pos.c[r] = c; items[c].el.classList.add('focus');
      var x = items[c].el.offsetLeft, w = 1280 - 48 - 60;
      rows[r].track.style.transform = 'translateX(' + (x > w - 240 ? -(x - (w - 240)) : 0) + 'px)';
      // vertical: keep the focused row in view, a bit below the top (the page title scrolls away with it)
      var box = document.getElementById('tv-rows'), top = rows[r].el.offsetTop, h = rows[r].el.offsetHeight;
      var cur = -(parseFloat((box.style.transform || '').replace(/[^-\d.]/g, '')) || 0), want = cur;
      if (!keepScroll || top - cur < 0 || top + h - cur > 690) want = r === 0 ? 0 : Math.max(0, top - 150);
      box.style.transform = 'translateY(' + (-want) + 'px)';
      if (items[c].onFocus) items[c].onFocus();
    }
    function homeMove(k) {
      var r = pos.r, c = pos.c[r] || 0;
      if (k === K.LEFT) return focusCard(r, c - 1);
      if (k === K.RIGHT) return focusCard(r, c + 1);
      var dir = k === K.DOWN ? 1 : -1, n = r + dir;
      while (rows[n] && !rows[n].items.length) n += dir;
      if (!rows[n]) return;
      // in the drama grid keep the same column; entering/leaving it keep each row's own position
      var col = (r >= POP0 && n >= POP0) ? c : (pos.c[n] || 0);
      focusCard(n, col);
    }
    function homeKey(k) {
      var r = pos.r, c = pos.c[r] || 0;
      if (k === K.LEFT || k === K.RIGHT || k === K.UP || k === K.DOWN) homeMove(k);
      else if (k === K.OK) { var it = rows[r] && rows[r].items[c]; if (it) it.go(); }
      else if (k === K.BACK || k === K.ESC) {
        if (Date.now() - (homeKey.back || 0) < 2500) return exit();
        homeKey.back = Date.now(); toast('Press Back again to exit', 2500);
      } else return false;
      return true;
    }
    function dramaCard(d, extra) {
      var p = progGet(d.dramaID), ep = p ? p.ep : (d.shortDramaWatchHistory && d.shortDramaWatchHistory.lastWatchedEpisodeNumber);
      var g = genreOf(d);
      return { img: coverOf(d), title: d.dramaName, sub: ep ? 'Episode ' + ep + (d.numVideos ? ' of ' + d.numVideos : '') : (d.numVideos ? d.numVideos + ' episodes' : '') + (g ? (d.numVideos ? ' · ' : '') + g : ''),
        pct: ep && d.numVideos ? ep / d.numVideos * 100 : 0, go: function () { (extra && extra.resume) ? resumeDrama(d) : openDrama(d); } };
    }
    function loadHome() {
      setRow(0, 'Continue watching', [], 'Loading…');
      setRow(REC, 'Recommended for you', [], 'Loading…');
      setRow(TT, 'TikTok', [
        { wide: true, icon: ICON('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>'), title: 'Search dramas', sub: 'By name or genre', go: openSearch },
        { wide: true, icon: ICON('<path d="M7 4l13 8-13 8z" fill="#fff"/>'), title: 'For You', sub: 'Videos picked for you', go: function () { openFeed('fyp'); } },
        { wide: true, icon: ICON('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 11l2 2 4-4"/>'), title: 'Following', sub: 'From people you follow', go: function () { openFeed('following'); } },
        { wide: true, icon: ICON('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'), title: 'Explore', sub: 'Trending videos', go: function () { openFeed('explore'); } },
        { wide: true, icon: ICON('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'), title: 'Full TikTok', sub: 'LIVE, search, comments', go: function () { fullSite('/foryou'); } },
        { wide: true, icon: ICON('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'), title: 'Reload', sub: 'Refresh these lists', go: function () { location.reload(); } }
      ]);
      setRow(GEN, 'Genres', [], 'Loading…');
      setRow(POP0, 'Popular short dramas', [], 'Loading…');
      focusCard(0, 0);
      loadGenres();
      api('/api/drama/watch_history/', 'count=20&coverFormat=2&cursor=0').then(function (j) {
        tikHistory = remember(j.dramaList);
      }).catch(function () {}).then(renderContinue);
      loadPopular(true);
    }
    // Continue watching: this TV's own progress first (newest first), then TikTok's watch history.
    var tikHistory = [];
    function renderContinue() {
      var local = progAll(), ids = Object.keys(local).sort(function (a, b) { return local[b].at - local[a].at; });
      var cont = ids.map(function (id) { var p = local[id]; return { dramaID: id, dramaName: p.name, numVideos: p.num, description: p.desc, zoomCover: { 480: p.cover }, authorUID: p.au, themes: p.th }; });
      tikHistory.forEach(function (d) { if (!local[d.dramaID]) cont.push(d); });
      if (pos.r === 0) pos.c[0] = 0;          // the drama just watched is now first
      setRow(0, 'Continue watching', cont.map(function (d) { return dramaCard(d, { resume: true }); }), 'Dramas you watch will show up here');
      renderHomeRecs(cont);
    }
    // "Because you watched …": TikTok's recommendations for the drama watched last, same genre first,
    // leaving out dramas already in Continue watching.
    var homeRecSeed = null, recFailed = {};
    function renderHomeRecs(cont) {
      var seed = cont[0];
      if (!seed) return setRow(REC, 'Recommended for you', [], 'Watch a drama and similar ones will show up here');
      if (homeRecSeed === seed.dramaID || recFailed[seed.dramaID]) return; homeRecSeed = seed.dramaID;
      recsFor(seed).then(function (list) {
        if (homeRecSeed !== seed.dramaID) return;
        var have = {}; cont.forEach(function (d) { have[d.dramaID] = 1; });
        setRow(REC, 'Because you watched ' + seed.dramaName, list.filter(function (d) { return !have[d.dramaID]; }).slice(0, 20).map(function (d) { return dramaCard(d); }),
          'No recommendations right now');
      }).catch(function () { homeRecSeed = null; recFailed[seed.dramaID] = 1; setRow(REC, 'Recommended for you', [], 'Couldn’t load recommendations'); });
    }
    var popular = { list: [], cursor: '0', more: true, busy: false, retryAt: 0, at: 0 };
    function loadPopular(first) {
      if (popular.busy || !popular.more || Date.now() < popular.retryAt) return; popular.busy = true;
      if (first) popular.at = Date.now();
      api('/api/drama/theme/drama_list/', 'count=21&coverFormat=2&oneColumnMode=true&themeType=7&from_page=&cursor=' + encodeURIComponent(popular.cursor)).then(function (j) {
        var have = {}; popular.list.forEach(function (d) { have[d.dramaID] = 1; });
        var add = remember(j.dramaList).filter(function (d) { return !have[d.dramaID]; });
        popular.list = popular.list.concat(add); popular.cursor = j.cursor; popular.more = !!j.hasMore && add.length > 0;
        if (!popular.list.length) setRow(POP0, 'Popular short dramas', [], 'No dramas right now. Choose Reload above to try again.');
        else renderPopular();
      }).catch(function (e) {
        popular.retryAt = Date.now() + 30000;   // (no request on every keypress after a failure: captcha risk)
        if (first) setRow(POP0, 'Popular short dramas', [], 'Could not load dramas (' + e.message + '). Choose Reload above to try again.');
      }).then(function () { popular.busy = false; });
    }
    // Reload the drama grid from the newest, dropping the cached list and any extra grid rows it grew.
    function refreshPopular() {
      for (var r = rows.length - 1; r >= POP0; r--) { if (rows[r] && rows[r].el) rows[r].el.remove(); }
      rows.length = POP0;
      popular.list = []; popular.cursor = '0'; popular.more = true; popular.busy = false; popular.retryAt = 0;
      setRow(POP0, 'Popular short dramas', [], 'Loading…');
      loadPopular(true);
    }
    function renderPopular() {
      var all = popular.list.map(function (d) { return dramaCard(d); });
      for (var g = 0; g * GRID < all.length; g++) {
        var chunk = all.slice(g * GRID, (g + 1) * GRID), r = POP0 + g;
        if (rows[r] && rows[r].items.length === chunk.length) continue;   // unchanged line
        setRow(r, g === 0 ? 'Popular short dramas' : '', chunk);
      }
      // load more when a card in the last two lines gets focus
      var last = POP0 + g - 1;
      for (var r2 = Math.max(POP0, last - 1); r2 <= last; r2++) rows[r2].items.forEach(function (it) { it.onFocus = function () { loadPopular(); }; });
    }
    // Magic Remote wheel: one row (or video / episode) per notch, at most every WHEEL_MS. The wheel spins
    // off many notches at once, so keep this gap generous or browsing flies past - the D-pad is 1:1 anyway.
    var WHEEL_MS = 450, wheelAt = 0;
    function onWheel(e) {
      e.preventDefault();
      if (Date.now() - wheelAt < WHEEL_MS || !e.deltaY) return; wheelAt = Date.now();
      var k = e.deltaY > 0 ? K.DOWN : K.UP;
      if (screen === 'home') homeMove(k);
      else if (screen === 'drama') dramaKey(k);
      else if (screen === 'search') { if (srch.line >= 0) searchKey(k); }
      else if (screen === 'genre') genreKey(k);
      else if (cur) step(k === K.DOWN ? 1 : -1);
    }

    /* ---------- drama page ---------- */
    var drama = null;   // { d, eps: [items by episode-1], total, cursor, more, focus: index into buttons }
    function show(name) {
      screen = name;
      document.getElementById('tv-home').style.display = name === 'home' ? '' : 'none';
      document.getElementById('tv-drama').style.display = name === 'drama' ? 'block' : 'none';
      document.getElementById('tv-player').style.display = name === 'player' ? 'block' : 'none';
      document.getElementById('tv-search').style.display = name === 'search' ? 'block' : 'none';
      document.getElementById('tv-genre').style.display = name === 'genre' ? 'block' : 'none';
      if (name !== 'search') { var si = document.getElementById('tv-sin'); if (si) si.blur(); }
      if (name !== 'player') stopVideo();
      if (name === 'home') {
        renderContinue();
        // Coming back to home: refresh the drama grid to the newest, but only when you're not mid-scroll
        // in it (focus is in the top rows) and not too often (captcha risk from frequent API calls).
        if (pos.r < POP0 && Date.now() - (popular.at || 0) > 120000) refreshPopular();
        focusCard(pos.r, pos.c[pos.r] || 0);
      }
    }
    function loadEpisodes(dr, upTo) {
      if (dr.loading) return dr.loading.then(function () { return loadEpisodes(dr, upTo); });
      if (dr.eps.length >= upTo || !dr.more) return Promise.resolve();
      dr.loading = api('/api/drama/episode/item_list/', 'dramaID=' + dr.d.dramaID + '&cursor=' + dr.cursor + '&count=30').then(function (j) {
        var items = (j.itemList || []).filter(Boolean);
        dr.eps = dr.eps.concat(items); dr.cursor = j.cursor; dr.more = !!j.hasMore && items.length > 0;
        if (j.totalEpisodeCount) dr.total = j.totalEpisodeCount;
        dr.loading = null;
      }, function (e) { dr.loading = null; throw e; });
      return dr.loading.then(function () { return loadEpisodes(dr, upTo); });
    }
    function newDrama(d) { return { d: d, eps: [], total: d.numVideos || 0, cursor: '0', more: true }; }
    function openDrama(d, opts) {
      var prev = drama;
      drama = newDrama(d); show('drama');
      drama.fromSearch = !!(prev && prev.d === d && prev.fromSearch); drama.fromGenre = !!(prev && prev.d === d && prev.fromGenre);   // back from the player keeps where Back leads
      var dr = drama, p = progGet(d.dramaID), ep = p ? p.ep : 0, el = document.getElementById('tv-drama');
      el.innerHTML = '<div id="tv-dwrap"><div class="top"><img src="' + esc(coverOf(d)) + '"><div><h2>' + esc(d.dramaName) + '</h2>' +
        '<div class="tags"></div><p>' + esc(d.description || '') + '</p>' +
        '<div class="btn" data-i="play">' + (ep ? '▶ Continue episode ' + ep : '▶ Play episode 1') + '</div></div></div><div class="eps"></div>' +
        '<div class="tv-row recs"><h2>More like this</h2><div class="tv-track"><div class="tv-msg">Loading…</div></div></div></div>';
      dr.focus = 0; dr.zone = 'eps'; dr.rc = 0; dr.recs = []; dr.wantRecs = !!(opts && opts.recs);
      renderTags(d);
      if (!d.description || !d.themes || !d.numVideos) detail(d).then(function (i) {
        if (drama !== dr) return;
        if (!d.description) { d.description = i.description; el.querySelector('p').textContent = i.description || ''; }
        if (!d.themes && i.themes) { d.themes = i.themes; renderTags(d); }
        if (!dr.total && i.numVideos) { d.numVideos = dr.total = i.numVideos; renderEps(); dramaFocus(dr.focus); }
      }).catch(function () {});
      if (!dr.total) loadEpisodes(dr, 1).then(function () { if (drama === dr && dr.total) { renderEps(); dramaFocus(dr.focus); } }).catch(function () {});
      renderEps(); dramaFocus(0);
      recsFor(d).then(function (list) { if (drama === dr) renderRecs(dr, list.slice(0, 24)); })
        .catch(function () { if (drama === dr) renderRecs(dr, []); });
    }
    function renderTags(d) {
      var box = document.querySelector('#tv-drama .tags'); if (!box) return;
      var tags = tagsOf(d);
      box.innerHTML = tags.map(function (t) { return '<span>' + esc(t.tagVal) + '</span>'; }).join('');
      [].forEach.call(box.children, function (el, i) {
        el.onclick = function () { openGenre({ id: tags[i].tagID, name: tags[i].tagVal }); };
        el.onmousemove = function () { if (drama.zone !== 'tags' || drama.tc !== i) tagFocus(i); };
      });
    }
    function renderRecs(dr, list) {
      var track = document.querySelector('#tv-drama .recs .tv-track'); if (!track) return;
      track.innerHTML = '';
      dr.recs = list.map(function (rd, i) {
        var it = dramaCard(rd); it.hover = function () { recFocus(i); };
        it.el = card(it); track.appendChild(it.el); return it;
      });
      if (!list.length) track.appendChild(E('div', 'tv-msg', 'No recommendations right now'));
      if (dr.wantRecs && list.length) { dr.wantRecs = false; recFocus(0); }
    }
    function tagFocus(i) {
      var els = document.querySelectorAll('#tv-drama .tags span'); if (!els.length) return false;
      i = Math.max(0, Math.min(els.length - 1, i));
      var old = document.querySelector('#tv-drama .focus'); if (old) old.classList.remove('focus');
      drama.zone = 'tags'; drama.tc = i; els[i].classList.add('focus');
      document.getElementById('tv-dwrap').style.transform = '';
      return true;
    }
    function recFocus(c) {
      var dr = drama, items = dr.recs; if (!items.length) return;
      c = Math.max(0, Math.min(items.length - 1, c));
      var old = document.querySelector('#tv-drama .focus'); if (old) old.classList.remove('focus');
      dr.zone = 'recs'; dr.rc = c; items[c].el.classList.add('focus');
      var x = items[c].el.offsetLeft, w = 1280 - 96 - 40, track = items[c].el.parentNode;
      track.style.transform = 'translateX(' + (x > w - 240 ? -(x - (w - 240)) : 0) + 'px)';
      var row = document.querySelector('#tv-drama .recs');
      document.getElementById('tv-dwrap').style.transform = 'translateY(' + (-Math.max(0, row.offsetTop + row.offsetHeight - 660)) + 'px)';
    }
    function renderEps() {
      var p = progGet(drama.d.dramaID), box = document.querySelector('#tv-drama .eps'); if (!box) return;
      var html = '';
      for (var n = 1; n <= drama.total; n++) html += '<div class="ep' + (p && n < p.ep ? ' seen' : '') + (p && n === p.ep ? ' cur' : '') + '" data-i="' + n + '">' + n + '</div>';
      box.innerHTML = html;
      [].forEach.call(document.querySelectorAll('#tv-drama [data-i]'), function (b, i) {
        b.onclick = function () { dramaFocus(i); dramaKey(K.OK); };
        b.onmousemove = function () { if (drama.zone !== 'eps' || drama.focus !== i) dramaFocus(i); };
      });
    }
    function dramaButtons() { return document.querySelectorAll('#tv-drama [data-i]'); }
    function dramaFocus(i) {
      var bs = dramaButtons(); if (!bs.length) return;
      i = Math.max(0, Math.min(bs.length - 1, i));
      var old = document.querySelector('#tv-drama .focus'); if (old) old.classList.remove('focus');
      drama.zone = 'eps'; drama.focus = i; bs[i].classList.add('focus');
      var wrap = document.getElementById('tv-dwrap'); if (wrap) wrap.style.transform = '';
      var box = document.querySelector('#tv-drama .eps'), b = bs[i];
      if (i > 0) box.scrollTop = Math.max(0, b.offsetTop - box.offsetTop - 112);
    }
    function dramaKey(k) {
      var i = drama.focus, per = 16, n = dramaButtons().length;   // episode buttons per row
      if (k === K.BACK || k === K.ESC) { if (drama.fromGenre) showGenre(); else if (drama.fromSearch) showSearch(false); else show('home'); return true; }
      if (drama.zone === 'tags') {   // genre chips: OK lists that genre
        if (k === K.LEFT) tagFocus(drama.tc - 1);
        else if (k === K.RIGHT) tagFocus(drama.tc + 1);
        else if (k === K.DOWN) dramaFocus(0);
        else if (k === K.OK) { var t = tagsOf(drama.d)[drama.tc]; if (t) openGenre({ id: t.tagID, name: t.tagVal }); }
        else if (k !== K.UP) return false;
        return true;
      }
      if (drama.zone === 'recs') {
        if (k === K.LEFT) recFocus(drama.rc - 1);
        else if (k === K.RIGHT) recFocus(drama.rc + 1);
        else if (k === K.UP) dramaFocus(i);
        else if (k === K.OK) { var it = drama.recs[drama.rc]; if (it) it.go(); }
        else if (k !== K.DOWN) return false;
        return true;
      }
      // Down from the last line of episodes (or from Play when there are none) goes to More like this
      var lastLine = n > 1 ? Math.floor((n - 2) / per) : -1, line = i === 0 ? -1 : Math.floor((i - 1) / per);
      if (k === K.LEFT) dramaFocus(i - 1);
      else if (k === K.RIGHT) dramaFocus(i + 1);
      else if (k === K.DOWN) { if (line >= lastLine) recFocus(drama.rc); else dramaFocus(i === 0 ? 1 : i + per); }
      else if (k === K.UP) { if (i === 0) tagFocus(drama.tc || 0); else dramaFocus(i <= per ? 0 : i - per); }
      else if (k === K.OK || k === K.PLAY || k === K.PLAYPAUSE) {
        var b = dramaButtons()[i], p = progGet(drama.d.dramaID);
        if (!b) return true;
        if (b.getAttribute('data-i') === 'play') playEpisode(drama, p ? p.ep : 1, p ? p.t : 0);
        else playEpisode(drama, +b.getAttribute('data-i'), 0);
      } else return false;
      return true;
    }
    function resumeDrama(d) {
      var p = progGet(d.dramaID), ep = p ? p.ep : (d.shortDramaWatchHistory && d.shortDramaWatchHistory.lastWatchedEpisodeNumber) || 1;
      drama = newDrama(d); playEpisode(drama, ep, p ? p.t : 0);
    }

    /* ---------- search ----------
       TikTok has no drama-only search, so this asks its general search for the words and keeps the results that
       are drama episodes (they carry dramaInfo: dramaID, dramaName, authorUID), one card per drama. Dramas the
       app has already listed (Popular, history, recommendations) whose name or genre matches come first. */
    var srch = { q: '', items: [], line: -1, col: 0, busy: 0 }, SGRID = 7;
    function openSearch() { show('search'); showSearch(true); }
    function showSearch(toInput) {
      show('search');
      if (toInput || !srch.items.length) searchInput(); else searchFocus(srch.line, srch.col);
    }
    function searchInput() {
      srch.line = -1; var old = document.querySelector('#tv-search .focus'); if (old) old.classList.remove('focus');
      var si = document.getElementById('tv-sin'); si.classList.add('focus'); si.focus();
      document.getElementById('tv-sres').style.transform = '';
    }
    function localMatches(q) {
      var words = q.toLowerCase().split(/\s+/).filter(Boolean), out = [];
      Object.keys(seenDramas).forEach(function (id) {
        var d = seenDramas[id], hay = ((d.dramaName || '') + ' ' + tagsOf(d).map(function (t) { return t.tagVal; }).join(' ')).toLowerCase();
        if (words.every(function (w) { return hay.indexOf(w) >= 0; })) out.push(d);
      });
      return out;
    }
    function fromVideos(list) {
      var out = [];
      (list || []).forEach(function (it) {
        it = it && (it.item || it);
        var di = it && it.dramaInfo; if (!di || !di.dramaID) return;
        out.push({ dramaID: di.dramaID, dramaName: di.dramaName || (it.desc || '').slice(0, 60), authorUID: di.authorUID || (it.author && it.author.id),
          numVideos: di.numVideos || di.totalEpisodeCount || 0, themes: di.themes, description: di.description,
          cover: di.cover && di.cover.urlList ? di.cover : { urlList: [(it.video && (it.video.cover || it.video.originCover)) || ''] }, zoomCover: di.zoomCover });
      });
      return out;
    }
    function runSearch() {
      var q = document.getElementById('tv-sin').value.trim(); if (!q) return;
      if (q === srch.q && srch.running) return;   // (the TV keyboard's Enter again: don't send another request)
      var token = ++srch.busy; srch.q = q; srch.running = true;
      var found = {}, list = [];
      function add(ds) { ds.forEach(function (d) { if (!found[d.dramaID]) { found[d.dramaID] = 1; list.push(seenDramas[d.dramaID] || d); } }); }
      add(localMatches(q)); renderSearch(list, 'Searching TikTok…');
      // TikTok's search, a few pages one after the other with a pause (rapid requests made TikTok ask for a
      // captcha before); about 1 in 10 results is a drama episode.
      var plan = [[q + ' drama', 0], [q + ' drama', 1], [q + ' short drama', 0], [q, 0]], cursors = {};
      (function next(n) {
        if (token !== srch.busy) return;
        if (n >= plan.length) { srch.running = false; return renderSearch(list, 'No dramas found for “' + q + '”. Try the drama’s name or a genre like fantasy or revenge.', true); }
        var kw = plan[n][0], off = plan[n][1] ? cursors[kw] : 0;
        if (off == null) return next(n + 1);
        api('/api/search/general/full/', 'keyword=' + encodeURIComponent(kw) + '&offset=' + off + '&search_source=normal_search').then(function (j) {
          cursors[kw] = j.has_more ? j.cursor : null;
          return fromVideos((j.data || []).map(function (x) { return x.item; }));
        }).catch(function () { return []; }).then(function (ds) {
          if (token !== srch.busy) return;
          add(remember(ds)); renderSearch(list, 'Searching TikTok…');
          setTimeout(function () { next(n + 1); }, 600);
        });
      })(0);
    }
    function renderSearch(list, msg, done) {
      var box = document.getElementById('tv-sres'), keep = srch.line >= 0;
      box.innerHTML = '';
      srch.items = list.map(function (d, i) {
        var it = dramaCard(d), go = it.go;
        it.go = function () { go(); if (drama) drama.fromSearch = true; };
        it.hover = function () { searchFocus(Math.floor(i / SGRID), i % SGRID); };
        return it;
      });
      for (var g = 0; g * SGRID < srch.items.length; g++) {
        var row = E('div', 'tv-row'), track = E('div', 'tv-track'); row.appendChild(track); box.appendChild(row);
        srch.items.slice(g * SGRID, (g + 1) * SGRID).forEach(function (it) { it.el = card(it); track.appendChild(it.el); });
      }
      if (!list.length || !done) box.appendChild(E('div', 'tv-msg', esc(list.length && !done ? 'Searching TikTok for more…' : msg)));
      if (keep) searchFocus(srch.line, srch.col);
    }
    function searchFocus(line, col) {
      var n = srch.items.length; if (!n) return searchInput();
      var lines = Math.ceil(n / SGRID); line = Math.max(0, Math.min(lines - 1, line));
      col = Math.max(0, Math.min(Math.min(SGRID, n - line * SGRID) - 1, col));
      var si = document.getElementById('tv-sin'); si.classList.remove('focus'); si.blur();
      var old = document.querySelector('#tv-search .tv-card.focus'); if (old) old.classList.remove('focus');
      srch.line = line; srch.col = col;
      var el = srch.items[line * SGRID + col].el; el.classList.add('focus');
      var rowEl = el.parentNode.parentNode;
      var gbox = document.getElementById('tv-sres');   // (rows are positioned inside the moved box)
      gbox.style.transform = 'translateY(' + (-Math.max(0, gbox.offsetTop + rowEl.offsetTop + rowEl.offsetHeight - 700)) + 'px)';
    }
    function searchKey(k) {
      if (srch.line < 0) {   // typing in the box (the TV's on-screen keyboard handles letters)
        if (k === K.OK) {
          // Enter starts the search and closes the TV's on-screen keyboard (it covered all results but the first
          // line); OK on the box again opens the keyboard for a new search.
          var si = document.getElementById('tv-sin');
          if (document.activeElement !== si) { si.focus(); return true; }
          runSearch(); si.blur(); return true;
        }
        if (k === K.DOWN) { if (srch.items.length) { document.getElementById('tv-sin').blur(); searchFocus(0, 0); } return true; }
        if (k === K.BACK || k === K.ESC) { show('home'); return true; }
        return false;
      }
      if (k === K.LEFT) searchFocus(srch.line, srch.col - 1);
      else if (k === K.RIGHT) searchFocus(srch.line, srch.col + 1);
      else if (k === K.DOWN) searchFocus(srch.line + 1, srch.col);
      else if (k === K.UP) { if (srch.line === 0) searchInput(); else searchFocus(srch.line - 1, srch.col); }
      else if (k === K.OK) { var it = srch.items[srch.line * SGRID + srch.col]; if (it) it.go(); }
      else if (k === K.BACK || k === K.ESC) searchInput();
      else return false;
      return true;
    }

    /* ---------- genres ----------
       TikTok's drama library filters: /api/drama/filter/category_list/ gives the genres (their IDs are the same
       tag IDs dramas carry in themes), and the library list is drama_list with themeType=10&tagIDList=<id>. */
    var genres = null;
    function loadGenres() {
      var c = lsGet('tvGenres', null);
      if (c && c.at > Date.now() - 864e5 && c.list && c.list.length) { genres = c.list; return renderGenres(); }
      api('/api/drama/filter/category_list/', 'x=1').then(function (j) {
        var list = [], seen = {};
        (j.dramaCategoryLists || []).forEach(function (l) {
          (l.dramaCategories || []).forEach(function (g) {
            if (g.categoryFilterType === 2 && g.categoryID && g.categoryID !== '0' && !seen[g.categoryID] && !seen[g.name]) { seen[g.categoryID] = seen[g.name] = 1; list.push({ id: g.categoryID, name: g.name }); }
          });
        });
        genres = list; if (list.length) lsSet('tvGenres', { at: Date.now(), list: list });
        renderGenres();
      }).catch(function () { setRow(GEN, 'Genres', [], 'Couldn’t load genres. Choose Reload above to try again.'); });
    }
    var GICON = ICON('<path d="M4 6h16M4 12h16M4 18h10"/>');
    function renderGenres() {
      setRow(GEN, 'Genres', (genres || []).map(function (g) {
        return { wide: true, icon: GICON, title: g.name, sub: 'Short dramas', go: function () { openGenre(g); } };
      }), 'No genres right now');
    }
    var gen = { g: null, items: [], list: [], line: 0, col: 0, cursor: '0', more: true, busy: false, from: null, fromDrama: null };
    function openGenre(g) {
      if (!gen.g || gen.g.id !== g.id || (!gen.list.length && !gen.busy)) {
        gen.g = g; gen.list = []; gen.items = []; gen.line = 0; gen.col = 0; gen.cursor = '0'; gen.more = true; gen.busy = false; gen.retryAt = 0; gen.token = (gen.token || 0) + 1;
        document.querySelector('#tv-genre h1').textContent = g.name;
        document.getElementById('tv-gres').innerHTML = '<div class="tv-msg">Loading…</div>';
        moreGenre();
      }
      gen.from = screen === 'drama' ? 'drama' : 'home'; gen.fromDrama = drama;
      showGenre();
    }
    function showGenre() { show('genre'); if (gen.items.length) genreFocus(gen.line, gen.col); }
    function moreGenre() {
      if (gen.busy || !gen.more || Date.now() < (gen.retryAt || 0)) return; gen.busy = true;
      var t = gen.token, g = gen.g;
      api('/api/drama/theme/drama_list/', 'themeType=10&count=21&coverFormat=2&oneColumnMode=true&tagIDList=' + encodeURIComponent(g.id) + '&cursor=' + encodeURIComponent(gen.cursor)).then(function (j) {
        if (t !== gen.token) return;
        var have = {}; gen.list.forEach(function (d) { have[d.dramaID] = 1; });
        var add = remember(j.dramaList).filter(function (d) { return !have[d.dramaID]; });
        gen.list = gen.list.concat(add); gen.cursor = j.cursor; gen.more = !!j.hasMore && add.length > 0;
        renderGenre();
      }).catch(function (e) {
        if (t === gen.token) gen.retryAt = Date.now() + 30000;
        if (t === gen.token && !gen.list.length) document.getElementById('tv-gres').innerHTML = '<div class="tv-msg">Couldn’t load ' + esc(g.name) + ' dramas (' + esc(e.message) + ')</div>';
      }).then(function () { if (t === gen.token) gen.busy = false; });
    }
    function renderGenre() {
      var box = document.getElementById('tv-gres');
      if (!gen.list.length) { box.innerHTML = '<div class="tv-msg">No dramas in this genre right now</div>'; return; }
      if (!gen.items.length) box.innerHTML = '';
      for (var i = gen.items.length; i < gen.list.length; i++) (function (i) {
        var it = dramaCard(gen.list[i]), go = it.go;
        it.go = function () { go(); if (drama) drama.fromGenre = true; };
        it.hover = function () { genreFocus(Math.floor(i / SGRID), i % SGRID); };
        it.el = card(it);
        var line = Math.floor(i / SGRID), rowEl = box.children[line];
        if (!rowEl) { rowEl = E('div', 'tv-row'); rowEl.appendChild(E('div', 'tv-track')); box.appendChild(rowEl); }
        rowEl.firstChild.appendChild(it.el);
        gen.items.push(it);
      })(i);
      if (screen === 'genre') genreFocus(gen.line, gen.col);
    }
    function genreFocus(line, col) {
      var n = gen.items.length; if (!n) return;
      var lines = Math.ceil(n / SGRID); line = Math.max(0, Math.min(lines - 1, line));
      col = Math.max(0, Math.min(Math.min(SGRID, n - line * SGRID) - 1, col));
      var old = document.querySelector('#tv-genre .tv-card.focus'); if (old) old.classList.remove('focus');
      gen.line = line; gen.col = col;
      var el = gen.items[line * SGRID + col].el; el.classList.add('focus');
      var rowEl = el.parentNode.parentNode;
      var gbox = document.getElementById('tv-gres');   // (rows are positioned inside the moved box)
      gbox.style.transform = 'translateY(' + (-Math.max(0, gbox.offsetTop + rowEl.offsetTop + rowEl.offsetHeight - 700)) + 'px)';
      if (line >= lines - 2) moreGenre();
    }
    function genreKey(k) {
      if (k === K.LEFT) genreFocus(gen.line, gen.col - 1);
      else if (k === K.RIGHT) genreFocus(gen.line, gen.col + 1);
      else if (k === K.DOWN) genreFocus(gen.line + 1, gen.col);
      else if (k === K.UP) genreFocus(gen.line - 1, gen.col);
      else if (k === K.OK) { var it = gen.items[gen.line * SGRID + gen.col]; if (it) it.go(); }
      else if (k === K.BACK || k === K.ESC) {
        if (gen.from === 'drama' && gen.fromDrama && gen.fromDrama === drama) { show('drama'); tagFocus(drama.tc || 0); }
        else show('home');
      } else return false;
      return true;
    }

    /* ---------- player ---------- */
    var video, ov, cur = null, ovTm, saveTm, seekFn = null, feedErrors = 0, loadTm = null;   // cur: { kind:'drama'|'feed', ... }
    function clearSeek() { if (seekFn) { video.removeEventListener('loadedmetadata', seekFn); seekFn = null; } }
    function stopVideo() {
      if (!video) return;
      clearSeek(); clearTimeout(loadTm);
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {}
      clearInterval(saveTm); cur = null;
    }
    function showOv(a, d) {
      if (a != null) ov.querySelector('.a').textContent = a;
      if (d != null) ov.querySelector('.d').textContent = d;
      ov.classList.remove('hide'); clearTimeout(ovTm);
      ovTm = setTimeout(function () { if (video && !video.paused) ov.classList.add('hide'); }, 4000);
    }
    function play(url, startAt) {
      var spin = document.getElementById('tv-spin');
      show('player'); spin.style.display = 'block';
      if (!url) { spin.style.display = 'none'; toast('This video can’t be played here', 2500); return false; }
      clearSeek();
      video.src = url;
      // No data after 15s: the TV's player can hang in "loading" without ever reporting an error, holding a hardware
      // decoder. Unload it (frees the decoder) and treat it as a failed video.
      clearTimeout(loadTm);
      loadTm = setTimeout(function () {
        if (video.getAttribute('src') !== url || video.readyState >= 2) return;
        try { video.removeAttribute('src'); video.load(); } catch (e) {}
        mediaFailed();
      }, 15000);
      if (startAt > 3) {
        seekFn = function () { clearSeek(); if (video.getAttribute('src') === url) { try { video.currentTime = startAt - 2; } catch (e) {} } };
        video.addEventListener('loadedmetadata', seekFn);
      }
      var p = video.play(); if (p && p.catch) p.catch(function () {});
      return true;
    }
    // A video that failed (error event, or no data after 15s): skip it in feeds (at most 5 in a row), offer OK to retry episodes.
    function mediaFailed() {
      if (!cur) return;
      clearTimeout(loadTm); cur.failed = true;
      document.getElementById('tv-spin').style.display = 'none';
      if (cur.kind === 'feed') {
        if (++feedErrors >= 5) { feedErrors = 0; toast('Videos aren’t playing right now. Try again later.', 4000); return show('home'); }
        var c = cur; toast('Skipped a video that couldn’t play', 2000); setTimeout(function () { if (cur === c) step(1); }, 800);
      }
      else toast('The episode didn’t play. Press OK to try again.', 4000);
    }
    function playEpisode(dr, ep, startAt) {
      show('player');
      var c = cur = { kind: 'drama', dr: dr, ep: ep, startAt: startAt || 0 };
      showOv(dr.d.dramaName, 'Episode ' + ep + (dr.total ? ' of ' + dr.total : ''));
      document.getElementById('tv-spin').style.display = 'block';
      loadEpisodes(dr, ep).then(function () {
        if (cur !== c) return;
        var item = dr.eps[ep - 1];
        if (!item) { toast('Episode ' + ep + ' isn’t available', 2500); return openDrama(dr.d); }
        if (play(playUrl(item), startAt)) { c.started = true; progSet(dr.d, ep, startAt || 0); }
        clearInterval(saveTm);
        saveTm = setInterval(function () { if (cur === c && video.currentTime > 0) progSet(dr.d, ep, video.currentTime); }, 5000);
      }).catch(function (e) { if (cur !== c) return; toast('Couldn’t load the episode (' + e.message + ')', 3000); openDrama(dr.d); });
    }
    // For You and Following: each keeps its own list and position. For You returns new videos on every call;
    // Following pages with a cursor.
    var feeds = {
      fyp: { path: '/api/recommend/item_list/', q: 'count=8&from_page=fyp&os=linux&screen_height=1080&screen_width=1920', items: [], i: -1 },
      explore: { path: '/api/explore/item_list/', q: 'categoryType=120&count=8&enable_cache=false&pullType=1&store_region=' + REGION, items: [], i: -1 },
      // Following pages in two steps (seen 2026-11-21): level=1 gives the newest videos and always answers cursor "0";
      // level=2 then walks back in time with real cursors (some pages empty while hasMore stays true).
      following: { path: '/api/following/item_list/', q: 'count=9&coverFormat=2&from_page=following&isNonPersonalized=false&isResetCounterUsed=true', items: [], i: -1, cursor: '0', level: 1, more: true }
    }, feed = feeds.fyp;
    function moreFeed(f) {
      if (f.busy) return f.busy;
      if (f.more === false || Date.now() < (f.retryAt || 0)) return Promise.resolve();
      var empties = 0;
      function page() {
        var q = f.q + (f.level ? '&pullType=' + (f.level > 1 ? 2 : 1) + '&level=' + f.level : '') +
          (f.cursor != null ? '&cursor=' + encodeURIComponent(f.cursor) : '');
        return api(f.path, q).then(function (j) {
          var seen = {}, added = 0;
          f.items.forEach(function (it) { seen[it.id] = 1; });
          (j.itemList || []).forEach(function (it) { if (it && playUrl(it) && !it.imagePost && !seen[it.id]) { seen[it.id] = 1; f.items.push(it); added++; } });
          if (f.level === 1) { f.level = 2; f.cursor = '0'; f.more = true; }
          else if (f.cursor != null) {
            var stuck = String(j.cursor) === String(f.cursor);
            f.cursor = j.cursor; f.more = !!j.hasMore && !stuck && j.cursor != null;
          } else if (!added) f.retryAt = Date.now() + 30000;
          // nothing new on this page but more to come: look a little further (at most 3 pages, 1s apart)
          if (!added && f.more && f.cursor != null && ++empties <= 3) return new Promise(function (ok) { setTimeout(ok, 1000); }).then(page);
        });
      }
      f.busy = page().catch(function (e) { f.retryAt = Date.now() + 30000; toast('Couldn’t load videos (' + e.message + ')', 2500); })
        .then(function () { f.busy = null; });
      return f.busy;
    }
    function feedGo(i) {
      if (i < 0) return;
      var f = feed, c = cur = { kind: 'feed', i: i };
      var need = i >= f.items.length - 2 ? moreFeed(f) : Promise.resolve();
      if (i < f.items.length) start(); else { show('player'); document.getElementById('tv-spin').style.display = 'block'; need.then(function () { if (cur === c) start(); }); }
      function start() {
        if (i >= f.items.length) { toast(f === feeds.following ? 'No more videos from people you follow' : 'No more videos right now', 2500); if (f.i < 0) show('home'); return; }
        f.i = i; var it = f.items[i], au = it.author || {};
        play(playUrl(it), 0); cur = c;
        showOv('@' + (au.uniqueId || au.nickname || ''), it.desc || '');
      }
    }
    // Start a feed over from the newest videos (drop the cached list and cursor).
    function freshFeed(f) {
      f.items = []; f.i = -1; f.more = true; f.retryAt = 0; f.busy = null;
      if (f.cursor != null) f.cursor = '0';
      if (f.level) f.level = 1;
    }
    function openFeed(kind) {
      feed = feeds[kind] || feeds.fyp;
      // For You and Explore always open on the newest feed; Following keeps your place (it pages back in time).
      if (feed === feeds.fyp || feed === feeds.explore) { freshFeed(feed); feedGo(0); }
      else feedGo(Math.max(0, feed.i));
    }
    function step(dir) {
      if (!cur) return;
      if (cur.kind === 'feed') return feedGo(feed.i + dir);
      var ep = cur.ep + dir;
      if (ep < 1) return toast('This is the first episode');
      if (cur.dr.total && ep > cur.dr.total) { toast('That was the last episode. More like this below', 3000); return openDrama(cur.dr.d, { recs: true }); }
      playEpisode(cur.dr, ep, 0);
    }
    function playerKey(k) {
      if (k === K.BACK || k === K.ESC) {
        if (cur && cur.kind === 'drama') { var d = cur.dr.d; progSet(d, cur.ep, cur.started && video.currentTime > 0 ? video.currentTime : cur.startAt); openDrama(d); }
        else show('home');
      } else if (k === K.DOWN) step(1);
      else if (k === K.UP) step(-1);
      else if (k === K.OK || k === K.PLAY || k === K.PAUSE || k === K.PLAYPAUSE) {
        if ((video.error || (cur && cur.failed)) && cur) { if (cur.kind === 'drama') playEpisode(cur.dr, cur.ep, cur.startAt); else feedGo(feed.i); return true; }
        if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); toast('▶'); } else { video.pause(); toast('❚❚'); }
        showOv();
      } else if (k === K.LEFT || k === K.RW) { video.currentTime = Math.max(0, video.currentTime - 10); toast('« 10s'); showOv(); }
      else if (k === K.RIGHT || k === K.FF) { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10); toast('10s »'); showOv(); }
      else return false;
      return true;
    }

    /* ---------- start ---------- */
    function start() {
      if (!document.body) return document.addEventListener('DOMContentLoaded', start);
      build();
      video = document.getElementById('tv-video'); ov = document.getElementById('tv-ov');
      var spin = document.getElementById('tv-spin');
      video.addEventListener('playing', function () { spin.style.display = 'none'; feedErrors = 0; showOv(); });
      video.addEventListener('waiting', function () { spin.style.display = 'block'; });
      video.addEventListener('timeupdate', function () {
        if (video.duration) ov.querySelector('.bar i').style.width = (video.currentTime / video.duration * 100) + '%';
      });
      video.addEventListener('ended', function () {
        if (cur && cur.kind === 'drama') progSet(cur.dr.d, cur.dr.total ? Math.min(cur.ep + 1, cur.dr.total) : cur.ep, 0);
        step(1);
      });
      video.addEventListener('error', function () { if (video.getAttribute('src')) mediaFailed(); });
      document.addEventListener('visibilitychange', function () { if (document.hidden && video && !video.paused) video.pause(); });
      addEventListener('keydown', function (e) {
        var k = e.keyCode, used;
        if (k === K.RED) { location.reload(); used = true; }
        else if (screen === 'home') used = homeKey(k);
        else if (screen === 'drama') used = dramaKey(k);
        else if (screen === 'search') used = searchKey(k);
        else if (screen === 'genre') used = genreKey(k);
        else used = playerKey(k);
        if (used) { e.preventDefault(); e.stopPropagation(); }
      }, true);
      addEventListener('mousemove', function () { if (screen === 'player') showOv(); });
      addEventListener('wheel', onWheel, { passive: false });
      video.addEventListener('click', function () { playerKey(K.OK); });
      document.getElementById('tv-sin').addEventListener('click', searchInput);
      loadHome();
      loadSdk().catch(function () {
        setRow(POP0, 'Popular short dramas', [], 'TikTok didn’t load. Check the internet connection, then choose Reload above.');
      });
    }
    start();
  }
})();
