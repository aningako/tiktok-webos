/* Injected by webOS WebAppManager into every page this app loads (including https://www.tiktok.com).
   TV remote-control mappings, zoom and exit handling for the TikTok desktop site.
   Plain ES5 so it runs on older webOS versions too.
   Created by aning and Cipher Amir with the help of Claude (Anthropic). MIT license.
   Made for Pie Amolong, to watch AI dramas on an LG TV with TikTok. */
(function () {
  if (window.top !== window) return;               // not inside captcha/login iframes
  if (window.__tvInjected) return; window.__tvInjected = true;
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
    var PRIME = /^https?:\/\/[^/]*-webapp-prime[^/]*\.tiktok\.com(\/[^?]*)/, primeAlt = {};
    var rememberUrls = function (list) {
      var alt = null, i, m;
      for (i = 0; i < list.length; i++) if (/\/aweme\/v1\/play\//.test(list[i])) { alt = list[i]; break; }
      if (!alt) return;
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
      set: function (u) { srcDesc.set.call(this, playableUrl(u)); } });
    HTMLMediaElement.prototype.setAttribute = function (k, u) {
      return setAttr.call(this, k, String(k).toLowerCase() === 'src' ? playableUrl(u) : u);
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
    var drawn = location.pathname !== nav.from && oldGone && ((mc && mc !== nav.old) || newPicturesShown(nav.seen));
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
  function togglePlay() {
    var v = bestVideo(); if (!v) return;
    if (v.paused) { v.__tvUserPaused = false; safePlay(v); toast('▶'); }
    else { v.__tvUserPaused = true; v.pause(); toast('❚❚'); }
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
    if (Date.now() - lastClick < 1500 && e.target === bestVideo()) e.target.__tvUserPaused = true;
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
    var v = bestVideo(), now = Date.now(), vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) if (vs[i] !== v && !vs[i].paused) vs[i].pause();
    if (v) restore(v);
    if (!v || v.ended || v.__tvUserPaused || openDialog()) { wd.v = null; return; }
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
  function exitApp() {
    try { if (window.webOSSystem && webOSSystem.platformBack) return webOSSystem.platformBack(); } catch (e) {}
    try { if (window.PalmSystem && PalmSystem.platformBack) return PalmSystem.platformBack(); } catch (e) {}
    window.close();
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
    // Phone-style Back on the feed: the first Back on For You opens the menu, the next one exits.
    if (menuOpen()) { if (isHome()) return exitApp(); return showMenu(false); }
    if (ROOT.classList.contains('tv-feed') && isHome()) { showMenu(true, true); return toast('Press Back again to exit', 2500); }
    if (history.length > 1 && !/^\/(foryou)?\/?$/.test(location.pathname)) history.back();
    else exitApp();
  }

  /* ---------- key handling ---------- */
  addEventListener('keydown', function (e) {
    var k = e.keyCode, t = e.target || document.activeElement;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    var onControl = !!(t && t !== document.body && t.matches && t.matches(FOCUSABLE));
    var dialog = openDialog(), used = true;

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
    if (v && !v.paused && v.currentTime > 2) { try { sessionStorage.removeItem(dramaKey()); } catch (e) {} }
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
    if (next && !next.disabled && visible(next)) next.click(); else page(1);
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
