/* Injected by webOS WebAppManager into every page this app loads (including https://www.tiktok.com).
   TV remote-control mappings, zoom and exit handling for the TikTok desktop site.
   Plain ES5 so it runs on older webOS versions too. */
(function () {
  if (window.top !== window) return;               // not inside captcha/login iframes
  if (window.__tvInjected) return; window.__tvInjected = true;
  /* ---------- playback fixes ----------
     TikTok plays most videos through MediaSource running inside a Web Worker (its multiple.worker).
     On webOS TV (tested: webOS 10.3 "TV Lite", 50UR7550) worker-MSE videos stall at 0:00 with metadata
     only, while main-thread MSE and progressive MP4 play fine. Reporting that MediaSource can't be built
     in a worker makes TikTok use main-thread playback. HEVC is hidden too so it picks H.264 renditions. */
  var HEVC = /hvc1|hev1|hevc|h265|bytevc1/i;
  try {
    var MS = window.MediaSource;
    if (MS) {
      try { Object.defineProperty(MS, 'canConstructInDedicatedWorker', { get: function () { return false; }, configurable: true }); } catch (e) {}
      if (MS.isTypeSupported) {
        var origSupported = MS.isTypeSupported.bind(MS);
        MS.isTypeSupported = function (t) { return HEVC.test(String(t)) ? false : origSupported(t); };
      }
    }
    var origCanPlay = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (t) { return HEVC.test(String(t)) ? '' : origCanPlay.call(this, t); };
    if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
      var origDecoding = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
      navigator.mediaCapabilities.decodingInfo = function (cfg) {
        var ct = cfg && cfg.video && cfg.video.contentType;
        if (ct && HEVC.test(ct)) return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
        return origDecoding(cfg);
      };
    }
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
  function toast(msg) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;right:30px;top:24px;z-index:2147483647;background:rgba(0,0,0,.8);color:#fff;' +
        'font:24px sans-serif;padding:10px 20px;border-radius:10px;pointer-events:none;transition:opacity .3s;opacity:0';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg; toastEl.style.opacity = '1';
    clearTimeout(toastTm); toastTm = setTimeout(function () { toastEl.style.opacity = '0'; }, 1200);
  }

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
    next.focus();
    if (next.scrollIntoView) next.scrollIntoView({ block: 'nearest' });
  }
  function closeDialog(d) {
    var btn = d.querySelector('[data-e2e="modal-close-inner-button"],[data-e2e*="close"],[aria-label="Close"],[aria-label="close"]');
    if (btn) btn.click(); else sendKey('Escape', 'Escape', 27, d);
  }
  var style = document.createElement('style');
  style.textContent = '::-webkit-scrollbar{display:none}' +
    ':focus-visible,.tv-focus:focus{outline:4px solid #fe2c55 !important;outline-offset:2px}';

  /* ---------- feed actions ---------- */
  function page(dir) {
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

  /* ---------- autoplay keeper ----------
     On webOS TikTok often leaves the next video paused at 0:00 after scrolling, and paused/preloaded
     videos off-screen hold the TV's limited hardware decoders. Keep the centred video playing and pause
     the rest, unless the user paused it (OK button, or a pointer click just before the pause). */
  var lastClick = 0;
  addEventListener('mousedown', function () { lastClick = Date.now(); }, true);
  document.addEventListener('pause', function (e) {
    if (Date.now() - lastClick < 1500 && e.target === bestVideo()) e.target.__tvUserPaused = true;
  }, true);
  document.addEventListener('play', function (e) { e.target.__tvUserPaused = false; }, true);
  setInterval(function () {
    if (document.hidden) return;
    var cur = bestVideo(), vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) if (vs[i] !== cur && !vs[i].paused) vs[i].pause();
    if (cur && cur.paused && !cur.__tvUserPaused && !cur.ended && cur.readyState >= 2 && !openDialog()) safePlay(cur);
  }, 800);
  function toggleMute() {
    var v = bestVideo(); if (!v) return;
    v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 1;
    toast(v.muted ? 'Muted' : 'Sound on');
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
  function goBack() {
    var d = openDialog();
    if (d) return closeDialog(d);
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
    } else if (dialog) {
      // Inside login / comment dialogs: arrows move focus, OK clicks.
      if (k === KEY.DOWN || k === KEY.RIGHT) moveFocus(dialog, 1);
      else if (k === KEY.UP || k === KEY.LEFT) moveFocus(dialog, -1);
      else if (k === KEY.OK) { if (onControl) t.click(); else moveFocus(dialog, 1); }
      else used = false;
    } else {
      switch (k) {
        case KEY.UP: page(-1); used = false; break;          // let TikTok see the real arrow key too
        case KEY.DOWN: page(1); used = false; break;
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

  function init() {
    (document.head || document.documentElement).appendChild(style);
    applyZoom(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
