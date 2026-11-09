# Tweet Media Tools

Chrome extension (Manifest V3) for x.com / twitter.com.

| Feature | How |
| --- | --- |
| Copy image | Hover a tweet photo (or the full-screen photo viewer) → click the copy button in the top-right corner. Copies the original-size image as PNG. |
| Download video | Hover a video or GIF → click the download button in the top-right corner. Saves the highest-bitrate MP4 to your Downloads folder. |
| Share tweet | Hover a tweet → click the picture icon in its top-right corner (next to the `···` menu). By default it copies a screenshot of the tweet (long tweets are stitched). |

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Reload any open x.com tabs.

## Settings

Click the extension's toolbar icon (or right-click it → Options) to choose what the share button does:

- **Copy image** (default) — screenshot only.
- **Copy image + link** — screenshot and tweet URL in one clipboard entry. Rich editors (Gmail, Notion, Docs) paste both; most chat apps paste only the image.

Buttons give feedback in place: a green check on success, a red ✕ on failure (hover it to see the error).

## How it works

- `inject.js` runs in the page and reads X's own API responses to learn each video's MP4 URLs. If a URL wasn't seen, `background.js` falls back to the public embed endpoint (`cdn.syndication.twimg.com`).
- `content.js` adds the hover buttons and does the image conversion / screenshot stitching.
- `background.js` fetches images cross-origin, takes tab screenshots (`captureVisibleTab`), and starts downloads.

## Permissions

- `downloads` — save videos.
- `clipboardWrite` — copy images.
- `storage` — remember the share setting.
- `<all_urls>` host access — required by Chrome for `captureVisibleTab` when it's triggered from the page rather than the toolbar, and for fetching from `pbs.twimg.com` / `video.twimg.com`.

## Notes

- X changes its markup often; selectors live at the top of `decorate()` in `content.js`.
- While a tweet is being captured, X's sticky header and floating elements are hidden briefly and the page may scroll; it returns to where it was.
