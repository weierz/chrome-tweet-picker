# Tweet Media Tools

Chrome extension (Manifest V3) for x.com / twitter.com.

| Feature | How |
| --- | --- |
| Copy image | Hover a tweet photo (or the full-screen photo viewer) → click the copy button in the top-right corner. Copies the original-size image as PNG. |
| Download video | Hover a video or GIF → click the download button in the top-right corner. Saves the highest-bitrate MP4 to your Downloads folder. |
| Share tweet as image | Hover a tweet → click the picture icon at the end of the action bar (reply / repost / like …). The tweet is screenshotted (long tweets are stitched), copied to the clipboard, and shown in a preview with Copy / Download. |

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Reload any open x.com tabs.

## How it works

- `inject.js` runs in the page and reads X's own API responses to learn each video's MP4 URLs. If a URL wasn't seen, `background.js` falls back to the public embed endpoint (`cdn.syndication.twimg.com`).
- `content.js` adds the hover buttons and does the image conversion / screenshot stitching.
- `background.js` fetches images cross-origin, takes tab screenshots (`captureVisibleTab`), and starts downloads.

## Permissions

- `downloads` — save videos.
- `clipboardWrite` — copy images.
- `<all_urls>` host access — required by Chrome for `captureVisibleTab` when it's triggered from the page rather than the toolbar, and for fetching from `pbs.twimg.com` / `video.twimg.com`.

## Notes

- X changes its markup often; selectors live at the top of `decorate()` in `content.js`.
- While a tweet is being captured, X's sticky header and floating elements are hidden briefly and the page may scroll; it returns to where it was.
