#!/usr/bin/env python3
"""Full-site check: Back on a dialog without a close button must send Escape to the page once (no recursion)."""
import json, os, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run
prof = tempfile.mkdtemp(prefix='tvsim-')
chrome = subprocess.Popen(['chromium', '--headless=new', '--remote-debugging-port=9334', '--user-data-dir=' + prof, 'about:blank'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(80):
        try: pages = json.load(urllib.request.urlopen('http://127.0.0.1:9334/json', timeout=2)); break
        except Exception: time.sleep(0.25)
    c = run.CDP([p for p in pages if p['type'] == 'page'][0]['webSocketDebuggerUrl'])
    c.call('Runtime.enable'); c.call('Page.enable')
    c.call('Page.navigate', url=run.BASE + '/dialogtest'); c.pump(1)
    print('inject:', c.js(run.SCRIPT + '\n;"ok"'))
    c.key('BACK', 1, 0.5)
    exc = [e for e in c.events if e.get('method') == 'Runtime.exceptionThrown']
    print('Escape events the page received:', c.js('window.escSeen'))
    print('exceptions:', [e['params']['exceptionDetails'].get('exception', {}).get('description', '')[:120] for e in exc])
finally:
    chrome.kill()
