# tvsim: TV mode without a TV

Runs TV mode (the app's own player) in desktop headless Chromium against a fake TikTok API, so changes can
be checked without the TV and without sending a single request to TikTok.

```sh
tools/tvsim/make_media.sh                 # once: 10 numbered test clips (needs ffmpeg)
node tools/tvsim/server.js [--chaos]      # fake API on :8090; --chaos breaks ~1/3 of the answers
python3 tools/tvsim/run.py --shots DIR    # walk every screen with remote keys; prints JS errors + request counts
python3 tools/tvsim/dialog_test.py        # full-site check: Back on a dialog with no close button
```
