# TikTok for LG webOS (homebrew)

Unofficial TikTok launcher for LG webOS TVs. It runs a tiny local proxy service on the TV that serves the
TikTok **desktop** site full-screen, with remote-control mappings and adjustable zoom for a 10-foot UI.

> Not affiliated with or endorsed by TikTok / ByteDance or LG. Use at your own risk. TikTok may change its site at any time and break this app.

## Install

Requirements: LG TV with [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) on, and the webOS CLI (`npm i -g @webos-tools/cli`).

```sh
ares-setup-device                      # add your TV once
ares-install -d <tv> releases/com.homebrew.tiktok_<version>_all.ipk
ares-launch  -d <tv> com.homebrew.tiktok
```
Download the IPK from the [Releases](../../releases) page.

## Remote controls

| Button | Action |
|---|---|
| Up / Down | Previous / next video |
| OK | Play / pause |
| Right | Like (`L` shortcut) |
| Left | Mute / unmute |
| Channel Up / Down | Zoom in / out (default 125%) |
| Red / Green / Yellow / Blue | Reload / For You / Following / Explore |
| Back | Go back, or exit |

The Magic Remote pointer works for clicking and scrolling.

## How it works

- `app/com.homebrew.tiktok/` – web app. Starts the service via Luna, waits for it, then opens the local page.
- `services/com.homebrew.tiktok.proxy/` – Node.js service (no dependencies, plain ES5/ES2015).
  - `proxy-service.js` – reverse proxy on `127.0.0.1:8765`; desktop Chrome UA, strips `X-Frame-Options`/CSP,
    rewrites TikTok hostnames so all traffic stays same-origin, injects `inject.js`.
  - `shell.html` – full-screen iframe with zoom handling.
  - `inject.js` – remote-key handling inside the page.

Limitations: WebSockets aren't proxied; TikTok API signing/bot checks may break features; old webOS versions
may not run TikTok's current JS. The Node.js version on the TV is older than on a dev PC (see LG's docs).

## Build

```sh
npm i -g @webos-tools/cli
npm run build        # outputs releases/com.homebrew.tiktok_<version>_all.ipk
npm run dev:proxy    # run the proxy on your PC, open http://127.0.0.1:8765/__shell
```
Bump the version in `app/com.homebrew.tiktok/appinfo.json` and `package.json`, update `CHANGELOG.md`, then tag a release and attach the IPK.

## License
MIT
