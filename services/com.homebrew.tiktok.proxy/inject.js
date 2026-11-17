/* Injected into proxied HTML: TV-friendly remote control for the TikTok desktop site. */
(function () {
  if (window.__tvInjected) return; window.__tvInjected = true;

  function scrollable(el) {
    while (el && el !== document.documentElement) {
      var cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(cs.overflowY)) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function centerEl() { return document.elementFromPoint(innerWidth / 2, innerHeight / 2) || document.body; }
  function bestVideo() {
    var vs = document.querySelectorAll('video'), best = null, d = 1e9;
    for (var i = 0; i < vs.length; i++) {
      var r = vs[i].getBoundingClientRect(), dd = Math.abs(r.top + r.height / 2 - innerHeight / 2);
      if (dd < d) { d = dd; best = vs[i]; }
    }
    return best;
  }
  function sendKey(key, code, kc) {
    var t = document.activeElement || document.body;
    ['keydown', 'keyup'].forEach(function (type) {
      var ev = new KeyboardEvent(type, { key: key, code: code, keyCode: kc, which: kc, bubbles: true, cancelable: true });
      try { Object.defineProperty(ev, 'keyCode', { get: function () { return kc; } }); Object.defineProperty(ev, 'which', { get: function () { return kc; } }); } catch (e) {}
      t.dispatchEvent(ev);
    });
  }
  function page(dir) {
    var v = bestVideo(), sc = scrollable(v || centerEl()), before = sc.scrollTop;
    sc.scrollBy ? sc.scrollBy({ top: dir * innerHeight, behavior: 'smooth' }) : (sc.scrollTop += dir * innerHeight);
    setTimeout(function () { if (sc.scrollTop === before) sendKey(dir > 0 ? 'ArrowDown' : 'ArrowUp', dir > 0 ? 'ArrowDown' : 'ArrowUp', dir > 0 ? 40 : 38); }, 400);
  }
  function togglePlay() { var v = bestVideo(); if (v) { v.paused ? v.play() : v.pause(); } }
  function toggleMute() { var v = bestVideo(); if (v) v.muted = !v.muted; }
  function exitApp() { try { parent.postMessage('tv-exit', '*'); } catch (e) {} try { window.close(); } catch (e) {} }

  addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    var k = e.keyCode, used = true;
    if (typing && k !== 461 && k !== 27) return;
    switch (k) {
      case 38: page(-1); break;                              // Up    -> previous video
      case 40: page(1); break;                               // Down  -> next video
      case 13: togglePlay(); break;                          // OK    -> play/pause
      case 39: sendKey('l', 'KeyL', 76); break;              // Right -> like (TikTok shortcut)
      case 37: toggleMute(); break;                          // Left  -> mute/unmute
      case 415: case 19: case 463: togglePlay(); break;      // media play/pause
      case 427: case 187: case 107: parent.postMessage('tv-zoom-in', '*'); break;   // Channel Up / + -> zoom in
      case 428: case 189: case 109: parent.postMessage('tv-zoom-out', '*'); break;  // Channel Down / - -> zoom out
      case 403: location.reload(); break;                    // Red    -> reload
      case 404: location.href = '/foryou'; break;            // Green  -> For You
      case 405: location.href = '/following'; break;         // Yellow -> Following
      case 406: location.href = '/explore'; break;           // Blue   -> Explore
      case 461: case 27:                                     // Back
        if (history.length > 1 && !/^\/(foryou)?\/?$/.test(location.pathname)) history.back(); else exitApp();
        break;
      default: used = false;
    }
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // 10-foot UI: slightly larger text/controls, auto-hide cursor handled by webOS
  var st = document.createElement('style');
  st.textContent = '::-webkit-scrollbar{display:none}html{cursor:default}';
  (document.head || document.documentElement).appendChild(st);
})();
