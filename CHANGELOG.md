# Changelog

All notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [2.6.2]
### Fixed
- **Videos stuck on "loading" everywhere** (TV mode For You/Following/Explore and the full site): a video player
  that hung while loading kept the TV's hardware decoders, so no other video could start until the app was
  closed. Every video is now unloaded when a page is left (full site <-> TV mode, reloads), and in TV mode a video
  with no data after 15s is unloaded and skipped (feeds) or offered for retry (episodes) instead of spinning.
- Following in TV mode now pages the way TikTok does (level 1, then level 2 with real cursors, stepping over
  empty pages) and stops when TikTok repeats itself.
- Search: Enter closes the TV's on-screen keyboard so all results are visible (it covered all but the first line).
- Back twice on the TV-mode home screen didn't exit on webOS 10 (`platformBack()` does nothing on tiktok.com
  pages); the app now closes with `window.close()` (memory and decoders freed).
### QA (LG 50UR7550, webOS 10.3.1)
- Passed: home rows, drama page (tags, episodes, More like this), player (pause, ±10s, next/previous, auto-next,
  progress), genre grid with paging, search, For You/Following/Explore incl. resume, full site feed, side menu,
  Short dramas page and episodes, Back route to TV mode, reload, relaunch, decoder release.
- `tools/tvsim`: `--hang` mode and `hang_test.py` for the loading timeout; Following paging emulated.

## [2.6.1]
### Fixed
- TV mode: "Continue watching" crashed (and kept crashing on every return home) when TikTok's history
  contained an empty entry; lists now skip empty/ID-less dramas and episodes.
- TV mode: opening a drama and quickly choosing an episode could load the episode list twice and play the
  wrong episode (and save progress for the wrong one); episode lists now load one page at a time.
- TV mode: a resume seek left over from the previous video could jump the next video (or skip a short
  episode); Back while the next episode was still loading saved the old video's time to it.
- TV mode: no more repeated requests after a failure (Popular, genres, feeds wait 30s; a failed home
  recommendation isn't retried on every return home; the search Enter key doesn't re-send) and the feed
  stops after 5 videos in a row fail instead of skipping and fetching forever (captcha risk).
- TV mode: "Press OK to try again" now really reloads a failed video; "Episode N isn't available" and a
  failed episode load open that drama's page (not a stale one / home); Popular is de-duplicated and says
  so when empty; reopening a genre that failed to load tries again; no "Episode 3 of undefined".
- Full site: Back on a dialog without a close button recursed until "Maximum call stack size exceeded"
  and never reached TikTok; synthetic keys are now left to TikTok.
- Full site: OK didn't pause after a pointer click on the player; a pause carried over to the next
  video/episode when TikTok reused the <video> element; a released video could get an old URL back.
- Full site: a drama episode failing mid-way reloaded forever (retries now reset only after the episode
  played to the end); the autoplay keeper no longer restarts hover previews on grid pages; the
  "Loading…" toast no longer sticks for 60s when a video or login dialog opens instead of a new page.
### Added
- `tools/tvsim`: offline harness for TV mode (fake API incl. a --chaos mode, test clips, remote-driven
  walk through every screen that reports JS errors and request counts) — no TV or TikTok needed.

## [2.6.0]
### Added
- **Genres** in TV mode: a Genres row on the home screen (Fantasy, Werewolf, Vampire, Martial arts,
  Post-apocalyptic, Revenge, Mystery… TikTok's own list of 60+ genres). Choosing one opens all its dramas as a grid,
  7 per line, that keeps loading as you go down. Same filter as the genre buttons in TikTok's Short dramas section.
- **Genre tags on the drama page**: press Up from Play to reach them; OK on a tag lists that genre.
- **More like this** on the drama page: TikTok's recommendations for that drama, the ones sharing its genre
  first. Press Down from the last line of episodes to reach it. After the last episode the app goes there.
- **Because you watched …** row on the home screen: recommendations for the drama watched last.
- **Search dramas** (first card in the TikTok row): type a drama's name or a genre with the TV keyboard, OK to
  search. Uses TikTok's search and keeps the drama results, plus dramas the app has already listed that match.
### Known limits
- TikTok has no "Sci-fi" genre; the closest are Post-apocalyptic, Infinite worlds, System quests, Transmigration.
- Search usually finds a handful of dramas and takes 15-25s (TikTok has no drama-only search; about 1 in 10 of
  its results is a drama).

## [2.5.0]
### Added
- **TV mode**, the app's new home screen: a light player of its own instead of TikTok's heavy desktop site.
  It runs on a bare tiktok.com page with only TikTok's request-signing script, gets lists from TikTok's web API
  and plays them in one plain video player. On the 50UR7550: next episode / video in about 1.5-2.5s (the website
  took 7-13s), the page uses ~2% CPU while playing (35-98% before), home screen ready ~7s after launch.
  - Continue watching (TikTok's drama watch history plus progress kept on the TV, resumes where you stopped),
    Popular short dramas, For You.
  - Drama page with Play/Continue and an episode grid. In the player: Up/Down previous/next episode or video,
    OK pause, Left/Right 10s back/forward, Back to the drama page / home; episodes play on automatically.
  - Following (videos from people you follow) and Explore (trending videos) feeds, next to For You.
  - The home screen scrolls: Popular short dramas is a grid, 7 per line, that keeps loading as you go down.
    The Magic Remote wheel moves through it (and to the next/previous video or episode in the player).
  - "Full TikTok" opens the website for LIVE, search, comments and logging in; Back on its For You
    (twice: menu, then TV mode) returns to TV mode.
### Fixed
- TikTok's security check ("Drag the slider to fit the puzzle") couldn't be solved with the remote: the app took
  over OK while any pop-up was open, which cancelled the Magic Remote's hold-and-drag. The app now leaves the
  remote alone on that check.
- For You on the full site stuck on "LIVE now" preview cards (their stream never ends, so Auto scroll never
  moved on, and they often froze): one that stays in the middle for 8s with no remote input is skipped.
### Known limits
- Watching in TV mode doesn't update TikTok's own watch history (progress is kept on the TV).
- No likes or comments in TV mode yet (use Full TikTok).

## [2.4.0]
### Changed
- Phone-app look on For You and Following: the video fills the whole screen (TikTok's frame, rounded corners and
  sidebar are gone), with like/comment/share on the right and the caption at the bottom, like the phone app.
- The menu (sidebar) is hidden on those pages. It slides in when the Magic Remote pointer reaches the left edge, or
  with Back on For You ("Press Back again to exit"; a second Back exits). In the menu, Up/Down choose a page, OK
  opens it, Right closes the menu. Short dramas, Explore and LIVE keep TikTok's normal layout.

## [2.3.0]
### Added
- "Loading Explore…" (Following, Friends, Short dramas, …) message from clicking a menu item until TikTok has drawn
  the new page. TikTok takes 5-55s to switch pages on the TV and leaves the old page frozen on screen meanwhile,
  which looked like the app had hung or restarted. (LIVE really is a full page reload, by TikTok's design.)
### Fixed
- Videos start sooner: TikTok's first two video URLs (v*-webapp-prime) need a browser cookie that the TV's own
  video player doesn't send, so every video failed twice (403) before TikTok tried the URL that works. The app now
  gives the player the working www.tiktok.com/aweme/v1/play/ URL straight away.
- Scrolling with the Magic Remote wheel/pointer on Explore, the Short dramas list and other grid pages: webOS
  blocks user scrolling of a web app's main page unless appinfo sets `disallowScrollingInMainFrame: false`.
- Up/Down on grid pages (Explore, Short dramas list) sometimes did nothing: their small preview videos were mistaken
  for a feed. Pages without a large video now simply scroll.
### Changed
- CSS animations and transitions finish instantly. TikTok's endless decorative animations (sound-bar equalizers,
  pulsing LIVE rings) kept the TV's CPU busy repainting: 66% -> 38% CPU busy with them off. Spinners no longer spin.
- Short dramas: when an episode shows "We're having trouble playing this video", the app now reloads and retries the
  same episode (up to 2 times) instead of skipping to the next episode; if it still fails it asks to press the red
  button. For You and other feeds still skip to the next video.

## [2.2.6]
### Fixed
- Red line along the drama player: the remote's focus outline was also drawn around TikTok's large focusable page
  areas. It is now only drawn on real controls (buttons, links, inputs, tabs) and on what the remote's arrows select
  in dialogs, and never on elements larger than 600x400.

## [2.2.5]
### Fixed
- Left (mute) now presses TikTok's own sound button, so TikTok's speaker icon matches the real sound. Before, the
  app toggled the video directly and TikTok kept showing "muted" while sound played. If TikTok's icon is already
  out of sync it is pressed twice; items without a sound button (LIVE previews in the feed) are toggled directly.

## [2.2.4]
### Fixed
- Auto scroll getting stuck forever on a video that failed ("We're having trouble playing this video"): TikTok
  removes the failed video's player, so it never ends and Auto scroll never moves on. If the video on screen
  shows that error for 4s, the app now skips to the next video (once per failed video).

## [2.2.3]
### Added
- Automatic recovery when tiktok.com's CDN answers with a bare "An error occurred while processing your request"
  (Akamai Reference #102) page: retries with a cache-busting parameter (plain reloads could get the same error),
  up to 5 times with growing delays, then asks to press the red button.

## [2.2.2]
### Fixed
- Whole page crashing with "Something went wrong" when switching drama episodes. TikTok's drama player creates a
  MediaSource without checking for it ("MediaSource is not a constructor"); it now gets the real one, while
  MediaSource stays hidden from TikTok's feature check so feed/drama videos keep using plain MP4 links.
### Added
- Homebrew Channel repository (`repo/apps.json`), so the app can be installed and updated from Homebrew Channel.
  `scripts/make_repo.py` regenerates it for each release.

## [2.2.1]
### Changed
- Credits: made for Pie Amolong, to watch AI dramas on an LG TV with TikTok.
### Notes
- Tested swapping TikTok's `v*-webapp-prime` video links for its `www.tiktok.com/aweme/v1/play` link (it avoids the
  decode errors and stalls on those servers), but videos still took 18-27s to start unless preloaded, so it wasn't
  shipped. The main limit on the test TV (50UR7550, 4 cores, 1.2 GB RAM) is CPU/memory load from TikTok's desktop site.

## [2.2.0]
### Added
- LIVE: the "Go LIVE and own the moment" promo that covered the player is closed automatically, and remote
  Up / Down switch to the previous / next stream.
- README screenshots captured on a real TV.
### Fixed
- LIVE streams didn't play: they need MediaSource, which 2.1.0 hid. MediaSource is now hidden everywhere except
  LIVE pages (follows in-app navigation).
- "Something went wrong" cards in the feed: TikTok assigns `window.MediaSource`, which crashed its video component
  when the property had no setter.
### Known issues
- Feed and drama videos can take 15–20s to start: TikTok first tries its `v*-webapp-prime` video servers, which stall
  on the test TV, before falling back to `www.tiktok.com/aweme/v1/play`, which plays at once. Being worked on.

## [2.1.1]
### Fixed
- Pause other videos the moment one starts playing, and free decoders when the watched video hits a decode
  error, to reduce "Something went wrong" when switching videos/episodes (still being worked on).
### Changed
- Credits: created by aning and Cipher Amir with the help of Claude.

## [2.1.0]
### Fixed
- Videos freezing at 0:00. Cause: the TV has very few hardware video decoders and TikTok's off-screen
  `<video>` elements (previous video, preloaded next one) keep holding them even while paused.
### Changed
- MediaSource is hidden from the page, so TikTok plays progressive MP4 URLs instead of MSE streams.
  Those can be unloaded to free a decoder and restored when scrolled back to (a detached MediaSource can't).
- Autoplay keeper is back (it was briefly removed while testing). It now also resumes videos that have
  only metadata loaded.
### Added
- Stall watchdog: if the on-screen video has data buffered but isn't progressing for 1.5s, other videos are
  unloaded to free their decoders and restored automatically when they come back on screen.
### Known issues
- On low-memory "TV Lite" models (50UR7550: 4 cores, 1.2 GB RAM) the desktop site keeps the CPU busy, so the
  first videos after launch can take 10–15s to start and the remote can lag a few seconds after each press.

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
