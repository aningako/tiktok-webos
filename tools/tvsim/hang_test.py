#!/usr/bin/env python3
"""TV mode with a player that never gets data (server.js --hang): each video must be unloaded and skipped after 15s,
and after 5 in a row the feed must stop and go home (not spin forever)."""
import json, os, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run
prof = tempfile.mkdtemp(prefix='tvsim-')
chrome = subprocess.Popen(['chromium', '--headless=new', '--remote-debugging-port=9334', '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(80):
        try: pages = json.load(urllib.request.urlopen('http://127.0.0.1:9334/json', timeout=2)); break
        except Exception: time.sleep(0.25)
    c = run.CDP([p for p in pages if p['type'] == 'page'][0]['webSocketDebuggerUrl'])
    c.call('Runtime.enable'); c.call('Page.enable')
    c.call('Page.navigate', url=run.BASE + '/robots.txt'); c.pump(1)
    c.js("localStorage.clear(); localStorage.tvCtx = JSON.stringify({region:'PH',language:'en',login:true,wid:'1',sdk:'/mock/sdk.js'}); 1")
    c.call('Page.navigate', url=run.BASE + '/robots.txt?tv=1'); c.pump(1.5)
    c.js(run.SCRIPT + ';1'); c.pump(3)
    c.js("(function(){var it=[].filter.call(document.querySelectorAll('.tv-card'),function(c){return /For You/.test(c.textContent)})[0];it.click();return 1})()")
    st = "(function(){var v=document.getElementById('tv-video');return [document.getElementById('tv-player').style.display, (v.getAttribute('src')||'(none)').replace(/.*video_id=/,'id '), v.readyState]})()"
    t0 = time.time()
    for t in (5, 17, 33, 49, 65, 81):
        c.pump(t0 + t - time.time()); print('%3ds' % t, c.js(st))
    exc = [e for e in c.events if e.get('method') == 'Runtime.exceptionThrown']
    print('exceptions:', len(exc))
finally:
    chrome.kill()
