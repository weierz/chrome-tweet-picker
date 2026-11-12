# Release notes

## 1.1.0 — 2026-11-12

### New: copy a whole thread as one image

When a post is part of a thread (the author replying to themself), the picture icon now copies the whole thread as a single card:

- Click any post in the thread: the first, one in the middle, or the last.
- The author's name and avatar appear once at the top, then every post in order on a line that joins them.
- Each post keeps its full text, photos, quoted post, link preview and full links.
- Posts the page hasn't loaded yet are fetched from X's API with your signed-in session, the same way the page loads them.
- Replies from other people are left out.
- The footer has the first post's link and the number of posts.

The tooltip reads "Copy thread as image" on posts in a thread. On every other post the button works as before.

### Renamed to Tweet Picker

The extension is now called **Tweet Picker**, with a space. The GitHub repository moved to [weierz/chrome-tweet-picker](https://github.com/weierz/chrome-tweet-picker); old links redirect.

### Privacy

The privacy policy now says that Tweet Picker requests the rest of a thread from X's own API, as it already did for X Articles. Nothing is sent anywhere other than X.

## 1.0.0 — November 2026

First release on the Chrome Web Store.

- **Share a post as an image:** the full text with no "Show more" cut-off, every image uncropped, quoted posts (and the post they quote), link previews with their full URL, X Articles in full, counts, the date and the post's `https://x.com/…` link. Drawn in your X theme (light, dim or dark) at 3x.
- **Copy photos:** the original-size image as a PNG, in the timeline and the full-screen viewer.
- **Save videos and GIFs:** the highest-quality MP4, straight to Downloads.
- **Options:** like or bookmark a post when you copy or share it, and expand "Show more" on long posts automatically. All are off by default.
- Uses X's translation in the card when you've pressed "Show translation".
- Prefetches on hover, so most clicks finish at once.
- Open x.com tabs pick up the extension, and later updates, without a refresh.
