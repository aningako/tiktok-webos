#!/usr/bin/env python3
"""Drive TV mode offline (with tools/tvsim/server.js running) and report JS errors, request counts and checks.

  python3 tools/tvsim/run.py [--port 8090] [--shots DIR]

Starts its own headless Chromium (CDP port 9334), injects webOSUserScripts/userScript.js after load the way
webOS does, walks through every TV-mode screen with remote keys, and prints every uncaught exception,
console error, the API request counts, and a few sanity checks.
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = open(os.path.join(ROOT, 'app', 'com.homebrew.tiktok', 'webOSUserScripts', 'userScript.js')).read()
arg = lambda n, d: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d
PORT, CDP_PORT, SHOTS = int(arg('--port', 8090)), 9334, arg('--shots', None)
BASE = 'http://127.0.0.1:%d' % PORT
KEYS = {'LEFT': 37, 'UP': 38, 'RIGHT': 39, 'DOWN': 40, 'OK': 13, 'BACK': 461, 'RED': 403}
NAMES = {37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 13: 'Enter'}


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=30, suppress_origin=True)
        self.n, self.events = 0, []

    def call(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.n:
                if 'error' in m:
                    raise RuntimeError(m['error'])
                return m['result']
            self.events.append(m)

    def pump(self, secs):
        end = time.time() + secs
        self.ws.settimeout(0.1)
        while time.time() < end:
            try:
                self.events.append(json.loads(self.ws.recv()))
            except websocket.WebSocketTimeoutException:
                pass
        self.ws.settimeout(30)

    def js(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=True)
        if 'exceptionDetails' in r:
            return 'EXC: ' + r['exceptionDetails'].get('exception', {}).get('description', r['exceptionDetails'].get('text', ''))[:300]
        return r['result'].get('value')

    def key(self, name, n=1, wait=0.25):
        kc = KEYS[name]
        for _ in range(n):
            for t in ('rawKeyDown', 'keyUp'):
                self.call('Input.dispatchKeyEvent', type=t, windowsVirtualKeyCode=kc, key=NAMES.get(kc, ''), code=NAMES.get(kc, ''))
            self.pump(wait)

    def type(self, text):
        for ch in text:
            self.call('Input.insertText', text=ch)
        self.pump(0.2)

    def shot(self, name):
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            open(os.path.join(SHOTS, name + '.png'), 'wb').write(base64.b64decode(self.call('Page.captureScreenshot', format='png')['data']))


def main():
    prof = tempfile.mkdtemp(prefix='tvsim-')
    chrome = subprocess.Popen(['chromium', '--headless=new', '--remote-debugging-port=%d' % CDP_PORT, '--window-size=1280,720',
                               '--user-data-dir=' + prof, '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            try:
                pages = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % CDP_PORT, timeout=2)); break
            except Exception:
                time.sleep(0.25)
        c = CDP([p for p in pages if p['type'] == 'page'][0]['webSocketDebuggerUrl'])
        for d in ('Runtime', 'Page', 'Log'):
            c.call(d + '.enable')
        c.call('Emulation.setDeviceMetricsOverride', width=1280, height=720, deviceScaleFactor=1, mobile=False)
        # saved context so TV mode doesn't fetch /foryou, and the stand-in SDK
        c.call('Page.navigate', url=BASE + '/robots.txt'); c.pump(1)
        c.js("localStorage.clear(); localStorage.tvCtx = JSON.stringify({region:'PH',language:'en',login:true,wid:'7300000000000000000',sdk:'/mock/sdk.js'}); 1")
        c.call('Page.navigate', url=BASE + '/robots.txt?tv=1'); c.pump(1.5)
        print('inject:', c.js(SCRIPT + '\n;"ok"'))
        c.pump(3)
        checks = []
        state = lambda: c.js("(function(){var s=[].slice.call(document.querySelectorAll('[id^=tv-]')).filter(function(e){return e.offsetParent&&e.id.length<14}).map(function(e){return e.id});"
                             "var f=document.querySelector('.focus,.f,:focus');return {vis:s.slice(0,6),focus:f?(f.textContent||'').trim().slice(0,40):null,"
                             "videos:document.querySelectorAll('video').length,playing:[].filter.call(document.querySelectorAll('video'),function(v){return !v.paused}).length,"
                             "bold:document.querySelectorAll('#tv-app b, [id^=tv-] b').length}})()")
        def step(label, fn):
            fn(); st = state(); print('%-34s %s' % (label, json.dumps(st)[:220])); checks.append((label, st)); c.shot(label.split()[0])

        step('01-home', lambda: c.pump(1))
        step('02-popular-scroll down+right', lambda: (c.key('DOWN', 5), c.key('RIGHT', 16, 0.12), c.pump(2)))
        step('03-popular-deep down x8', lambda: (c.key('DOWN', 8, 0.3), c.pump(2)))
        step('04-back-to-top up x20', lambda: c.key('UP', 20, 0.1))
        step('05-continue-open OK', lambda: (c.key('OK'), c.pump(2)))
        step('06-drama-nav down/right', lambda: (c.key('DOWN', 2), c.key('RIGHT', 6, 0.15), c.key('UP', 3), c.pump(1)))
        step('07-play-episode OK', lambda: (c.key('DOWN'), c.key('OK'), c.pump(3)))
        step('08-player-next down x3', lambda: (c.key('DOWN', 3, 0.6), c.pump(2)))
        step('09-back-from-player', lambda: (c.key('BACK'), c.pump(1)))
        step('10-back-to-home', lambda: (c.key('BACK'), c.pump(1)))
        step('11-genres-row', lambda: (c.key('DOWN', 3), c.key('OK'), c.pump(2)))
        step('12-genre-scroll down x12', lambda: (c.key('DOWN', 12, 0.2), c.pump(2)))
        step('13-genre-back', lambda: (c.key('BACK'), c.pump(1)))
        step('14-tiktok-row search', lambda: (c.key('UP', 20, 0.08), c.key('DOWN', 2), c.key('LEFT', 8, 0.08), c.key('OK'), c.pump(1)))
        step('15-search-type', lambda: (c.type('love'), c.key('OK'), c.pump(5)))
        step('16-search-results nav', lambda: (c.key('DOWN', 3), c.key('RIGHT', 3), c.pump(1)))
        step('17-search-back', lambda: (c.key('BACK'), c.key('BACK'), c.pump(1)))
        step('18-foryou', lambda: (c.key('UP', 20, 0.08), c.key('DOWN', 2), c.key('LEFT', 8, 0.08), c.key('RIGHT'), c.key('OK'), c.pump(3)))
        step('19-foryou-next x10', lambda: (c.key('DOWN', 10, 0.4), c.pump(2)))
        step('20-foryou-back', lambda: (c.key('BACK'), c.pump(1)))
        step('21-following', lambda: (c.key('RIGHT'), c.key('OK'), c.pump(3)))
        step('22-following-next x25', lambda: (c.key('DOWN', 25, 0.3), c.pump(3)))
        step('23-following-back', lambda: (c.key('BACK'), c.pump(1)))
        step('24-back-rapid x3 on home', lambda: (c.key('BACK', 1), c.pump(0.5)))

        counts = json.load(urllib.request.urlopen(BASE + '/__counts'))
        print('\nAPI requests:', json.dumps(counts, indent=1))
        errs = []
        for e in c.events:
            m, p = e.get('method'), e.get('params', {})
            if m == 'Runtime.exceptionThrown':
                d = p['exceptionDetails']; errs.append('EXCEPTION ' + (d.get('exception', {}).get('description') or d.get('text', ''))[:400] + ' @line ' + str(d.get('lineNumber')))
            elif m == 'Log.entryAdded' and p['entry']['level'] == 'error' and 'Failed to load resource' not in p['entry'].get('text', ''):
                errs.append('LOG ' + p['entry']['text'][:300])
            elif m == 'Runtime.consoleAPICalled' and p['type'] in ('error', 'assert'):
                errs.append('CONSOLE ' + ' '.join(str(a.get('value', a.get('description', '')))[:200] for a in p['args']))
        seen = {}
        for x in errs:
            seen[x] = seen.get(x, 0) + 1
        print('\nErrors (%d unique):' % len(seen))
        for x, n in seen.items():
            print('  [%dx] %s' % (n, x))
        print('\nMax videos playing at once:', max((st or {}).get('playing', 0) if isinstance(st, dict) else 0 for _, st in checks))
        print('Unescaped <b> from API names seen:', any(isinstance(st, dict) and st.get('bold') for _, st in checks))
    finally:
        chrome.kill()


if __name__ == '__main__':
    main()
