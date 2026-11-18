# Changelog

All notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [2.0.0]
### Changed
- Removed the local proxy service. The app now loads the real `https://www.tiktok.com` directly. This fixes slow
  loading, the For You feed stopping after a couple of videos (request-signature mismatch) and login spinning forever
  (cookies/captcha on the wrong origin). Verified on a 50UR7550 / webOS 10.3.1.
- Remote-control script moved to `webOSUserScripts/userScript.js`, which webOS injects into the page.
- App renders at 1280×720 (about 150% on a 1080p TV) instead of an iframe zoom; Channel Up/Down still fine-tune zoom (default 100%).
- Works on non-rooted (Dev Mode) and rooted TVs alike; no service needs to run.
### Added
- Login/comment dialogs: arrow keys move focus, OK clicks, Back closes the dialog.
- Like now clicks the like button of the video on screen; on-screen feedback for play/pause/mute/like/zoom.
- `scripts/build_ipk.py` builds the IPK without the webOS SDK.
- Autoplay keeper (keeps the on-screen video playing, pauses off-screen ones) and playback workarounds for webOS
  (H.264 preferred, MediaSource-in-Worker disabled). Video playback is still being worked on, see README.
- Credits: created by aning with the help of Claude.

## [1.4.0]
### Added
- TV zoom: Channel Up / Channel Down change zoom (75–250%, 25% steps, default 125%). Level is saved between launches.
### Changed
- Zoom scales the whole frame like browser zoom, so full-screen video layout still fits.

## [1.3.0]
### Changed
- Switched from the mobile site to TikTok's desktop layout (desktop Chrome user-agent).
- Removed Android/touch spoofing; remote keys remapped for the desktop site
  (OK play/pause, Right like, Left mute, colour buttons for For You / Following / Explore).

## [1.2.0]
### Changed
- App now fills the whole screen instead of a centered 9:16 phone frame.
- Packaging switched to `ares-package`.

## [1.1.0]
### Added
- Local proxy service (`com.homebrew.tiktok.proxy`) that strips frame/CSP restrictions, rewrites TikTok hostnames
  to stay same-origin and injects a remote-control script.
- Android phone emulation (user-agent, touch, client hints) and D-pad swipe/tap mapping.

## [1.0.0]
- Initial release: simple launcher that navigates to tiktok.com.
