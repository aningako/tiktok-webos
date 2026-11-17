# Changelog

All notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/).

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
