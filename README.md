# TikTok for LG webOS (homebrew)

Unofficial TikTok app for LG webOS TVs. It opens the real TikTok **desktop** site (`https://www.tiktok.com`) full-screen,
and webOS injects a small script that adds remote-control mappings, zoom and playback fixes for a 10-foot UI.

**Created by aning with the help of Claude** (Anthropic's AI assistant).

Works on **rooted and non-rooted** TVs: no background service, no root access needed.

> Not affiliated with or endorsed by TikTok / ByteDance or LG. Use at your own risk. TikTok may change its site at any time and break this app.

## Install

**Rooted TV (SSH / root shell):** copy the IPK to the TV and install it:

```sh
scp releases/com.homebrew.tiktok_2.0.0_all.ipk root@<tv-ip>:/tmp/
ssh root@<tv-ip> "luna-send -i 'luna://com.webos.appInstallService/dev/install' '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/tmp/com.homebrew.tiktok_2.0.0_all.ipk\",\"subscribe\":true}'"
```
(Press Ctrl+C once it reports `installed`.)

**webOS CLI (Dev Mode):**

```sh
ares-setup-device                      # add your TV once
ares-install -d <tv> releases/com.homebrew.tiktok_<version>_all.ipk
ares-launch  -d <tv> com.homebrew.tiktok
```

Upgrading from 1.x: uninstall the old version first. 1.x included a proxy service that 2.x no longer uses.

## Logging in

Use **"Use QR code"** in the login dialog and scan it with the TikTok app on your phone. That's the most reliable method
on a TV. Email/phone + password also works with the on-screen keyboard. Google/Apple/Facebook sign-in opens pop-ups
that may not work inside a TV app.

## Remote controls

| Button | Action |
|---|---|
| Up / Down | Previous / next video |
| OK | Play / pause (or activate the focused button) |
| Right | Like |
| Left | Mute / unmute |
| Channel Up / Down | Zoom in / out (50–200%, saved) |
| Red / Green / Yellow / Blue | Reload / For You / Following / Explore |
| Back | Close dialog → go back → exit |

When a dialog (login, comments…) is open, the arrow keys move focus between its buttons and fields, and OK clicks.
The Magic Remote pointer works for clicking and scrolling everywhere.

## How it works

- `app/com.homebrew.tiktok/index.html` redirects to `https://www.tiktok.com/foryou`.
- `appinfo.json` sets `resolution: 1280x720`: the site renders at 1280×720 and the TV scales it up (about 150%),
  which gives readable text without breaking the layout. The stock webOS user-agent is used; TikTok serves the full
  desktop site to it, and request signing stays consistent because the page runs on the real origin.
- `app/com.homebrew.tiktok/webOSUserScripts/userScript.js` is injected by webOS WebAppManager into every page the app
  loads, the same mechanism [youtube-webos](https://github.com/webosbrew/youtube-webos) uses. It handles remote keys,
  zoom, an autoplay keeper, and playback workarounds (H.264 instead of HEVC, no MediaSource-in-Worker).

## Known issues

- **Performance on low-end TVs:** tested on a 50UR7550 (webOS 10.3.1 "TV Lite", 4 cores, 1.2 GB RAM). TikTok's
  desktop site keeps that TV's CPU busy, so the first videos after launch can take 10–15s to start and the remote
  can lag a few seconds after each press. Close other apps (especially YouTube) so they don't hold memory or a
  video decoder.
- **Video playback:** these TVs have very few hardware video decoders, and TikTok keeps off-screen videos loaded.
  Since 2.1.0 the script makes TikTok use plain MP4s and frees the off-screen videos' decoders when the on-screen
  one stalls (see `userScript.js`).

### Why not a proxy anymore (1.x → 2.0)

1.x ran a Node.js reverse proxy on `127.0.0.1` that rewrote TikTok's pages. That made loading very slow (no
compression or connection reuse, multi-MB JS bundles rewritten on the TV CPU). It also broke the For You feed and
login: TikTok signs its API calls in the browser using the page origin and `navigator.userAgent`, and those didn't
match what the proxy sent, so the feed API returned nothing after the first few server-rendered videos. Login cookies
and the captcha also expect the real `tiktok.com` origin.

## Build

```sh
python3 scripts/build_ipk.py   # outputs releases/com.homebrew.tiktok_<version>_all.ipk (no SDK needed)
# or, with the webOS CLI:  npm run build
```

Bump the version in `app/com.homebrew.tiktok/appinfo.json` and `package.json`, update `CHANGELOG.md`, then tag a release
and attach the IPK.

## Debugging

In Dev Mode: `ares-inspect -d <tv> --app com.homebrew.tiktok --open` opens Chrome DevTools for the running app.

For scripted debugging there's `tools/cdp.py` (developer tool, not needed to use the app). It evaluates JS in the
app page, takes screenshots and sends remote keys over the TV's web inspector (port 9998):

```sh
pip install websocket-client
TV_HOST=<tv-ip> python3 tools/cdp.py eval 'document.querySelectorAll("video").length'
TV_HOST=<tv-ip> python3 tools/cdp.py key 40        # remote Down
TV_HOST=<tv-ip> python3 tools/cdp.py shot out.png  # video area shows blank: webOS draws video on its own plane
```

## Credits

Created by **aning** with the help of **Claude** (Anthropic).

## License
MIT
