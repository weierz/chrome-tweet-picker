# Tweet Media Tools

Chrome extension (Manifest V3) for x.com / twitter.com.

| Feature | How |
| --- | --- |
| Copy image | Hover a tweet photo (or the full-screen photo viewer) → click the copy button in the top-right corner. Copies the original-size image as PNG. |
| Download video | Hover a video or GIF → click the download button in the top-right corner. Saves the highest-bitrate MP4 to your Downloads folder. |
| Share tweet | Hover a tweet → click the picture icon at the start of its top-right icons (before Grok and `···`). Copies the tweet as a clean image card: full text (no "Show more" cut-off), every image uncropped, the link preview with its full URL above it, the quoted tweet, counts, and a footer with the tweet's own `https://x.com/…` link and date. Drawn in your X theme; the page doesn't scroll or flash. |

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Reload any open x.com tabs.

Buttons give feedback in place: a green check on success, a red ✕ on failure (hover it to see the error).

## How it works

- `inject.js` runs in the page and reads X's own API responses to learn each video's MP4 URLs. If a URL wasn't seen, `background.js` falls back to the public embed endpoint (`cdn.syndication.twimg.com`).
- `inject.js` also keeps each tweet's full data (long-tweet text, media, link preview, quoted tweet, counts) for the share card.
- `card.js` draws the share card on a canvas. If X's data for a tweet wasn't seen, it uses the embed endpoint, then the visible page as a last resort.
- `content.js` adds the hover buttons and handles the clipboard.
- `background.js` fetches images cross-origin and starts downloads.

## Permissions

- `downloads` — save videos.
- `clipboardWrite` — copy images.
- `*.twimg.com` host access — fetch images, video URLs and tweet data from X's media/embed servers.

## Notes

- X changes its markup often; selectors live at the top of `decorate()` in `content.js`.
