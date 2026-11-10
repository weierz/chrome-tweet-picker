# TweetPicker

Chrome extension (Manifest V3) for x.com / twitter.com.

| Feature | How |
| --- | --- |
| Copy image | Hover a tweet photo (or the full-screen photo viewer) → click the copy button in the top-right corner. Copies the original-size image as PNG. |
| Download video | Hover a video or GIF → click the download button in the top-right corner. Saves the highest-bitrate MP4 to your Downloads folder. |
| Share tweet | Hover a tweet → click the picture icon at the start of its top-right icons (before Grok and `···`). Copies the tweet as a clean image card: full text (no "Show more" cut-off), every image uncropped, the link preview with its full URL above it, the quoted tweet, X Articles in full (cover, title, headings, lists, images), counts, the date in the top-right corner, and a footer with the tweet's full `https://x.com/…` link. Drawn in your X theme; the page doesn't scroll or flash. |

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.

Open x.com tabs pick up the extension (and later updates) on their own; no refresh needed.

Buttons give feedback in place: a green check on success, a red ✕ on failure (hover it to see the error).

## Settings

Click the extension's toolbar icon to turn on **Like** and/or **Bookmark**: after a successful image copy or tweet share, the tweet is liked / bookmarked using X's own buttons. Tweets you've already liked or bookmarked are left as they are. Both are off by default.

The share card shows each tweet as you see it on the page: if you've pressed X's "Show translation", the card uses that translation with a small "Translated from …" note; otherwise it keeps the original text. Nothing is translated on its own.

**Expand "Show more"**: long tweets in the timeline open up in place as they appear, using X's own "Show more" button, so you never have to click it. Off by default.

## How it works

- `inject.js` runs in the page and reads X's own API responses to learn each video's MP4 URLs. If a URL wasn't seen, `background.js` falls back to the public embed endpoint (`cdn.syndication.twimg.com`).
- `inject.js` also keeps each tweet's full data (long-tweet text, media, link preview, quoted tweet, counts) for the share card.
- Timelines only carry an X Article's preview, so for an article post `inject.js` loads the full body from X's own API (`TweetResultByRestId`, using your signed-in session, as the page itself does). If that fails, the card shows the preview.
- `card.js` draws the share card on a canvas. If X's data for a tweet wasn't seen, it uses the embed endpoint, then the visible page as a last resort.
- `content.js` adds the hover buttons and handles the clipboard.
- `background.js` fetches images cross-origin and starts downloads.

## Permissions

- `downloads` — save videos.
- `clipboardWrite` — copy images.
- `storage` — remember the Like / Bookmark / Expand settings.
- `scripting` + x.com / twitter.com hosts — after an install or update, load the new version into tabs that are already open (the same sites the content scripts already run on).
- `*.twimg.com` host access — fetch images, video URLs and tweet data from X's media/embed servers.

## Notes

- X changes its markup often; selectors live at the top of `decorate()` in `content.js`.
