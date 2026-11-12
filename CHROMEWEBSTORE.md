# Chrome Web Store — Tweet Picker

Last updated: 2026-11-12

## Listing

- Version: 1.0.0, published 2026-11: https://chromewebstore.google.com/detail/tweetpicker/ppophefnhihljeoakdkcmfajgammnghf
- Summary: On X/Twitter: copy images on hover, download videos, and share any tweet as an image.
- Category: Social Networking
- Language: English (United States)
- Single purpose: Help users copy, download, and share content from posts on X/Twitter.

Tweet Picker adds convenient tools to X and Twitter.

• Copy photos: hover over a photo and click the copy button to copy the original-size image.
• Download videos and GIFs: hover over a video or GIF and click download to save an available MP4.
• Share posts as images: turn a post into an image card with its text, media, quoted post, link preview, engagement counts, date, and link where available. The card follows your X theme.

Optional settings let you automatically like or bookmark a post after copying or sharing, and expand long posts in your timeline. These options are off by default.

### Suggested search-friendly copy (not yet in the dashboard)

Google ranks the store page on its title, summary and description, and the current ones never say "Twitter video", "download" next to "video", or "tweet as image" in the way people search. Paste into Store listing when ready:

- Summary (132 max): Download Twitter/X videos and GIFs, copy full-size photos, and save any tweet as an image with full links. Free.
- Description:

Tweet Picker is a free Chrome extension for X (Twitter). Hover a photo, a video or a post and a small button appears; move away and it's gone.

• Download Twitter / X videos and GIFs: click the button on any video to save the best-quality MP4.
• Copy images from tweets: copy the original-size photo to your clipboard, also from the full-screen viewer.
• Save a tweet as an image: turn the whole post into one picture, with the full text (no "Show more" cut), every photo uncropped, quoted posts, link previews, counts, the date and the post's x.com link. The card follows your X theme (light, dim or dark).
• Full links: shortened links like site.com/pa… are written out in full in the image.

Optional, off by default: like or bookmark a post when you copy it, and expand long posts automatically.

No account, no analytics, no developer server: Tweet Picker only talks to X's own servers. Works on x.com and twitter.com.
Website: https://tweetpicker.weierz.com/

## Permissions

- downloads: Save videos and GIFs as MP4 files on request.
- clipboardWrite: Copy selected photos and generated post images on request.
- storage: Remember and sync the optional Like, Bookmark, and Expand settings.
- scripting: Load packaged scripts and styles into already-open X/Twitter tabs after installation or update.
- X/Twitter hosts: Add controls and read post data for image cards.
- twimg.com: Retrieve media and, when needed, public embed data for image cards and video URLs.
- Remote code: No.

## Privacy and assets

The extension processes website content to provide its features. Optional settings use Chrome sync storage. It requests media and public embed data from X's servers; the inspected code does not send content to a separate developer server. Website content is disclosed in the dashboard. The three data-use certifications are checked based on the inspected code.

- Privacy policy URL: https://tweetpicker.weierz.com/privacy/ (landing page at https://tweetpicker.weierz.com/; served from `site/` on DMIT, deploy with `site/deploy.sh`).
- Store icon: `icons/icon128.png` uploaded to the draft.
- Screenshots: `store/screenshots/screenshot-1..4.png` (1280×800, 24-bit PNG, no alpha); regenerate with `store/render.sh`.
- Distribution, publisher contact, and support URL: Check dashboard settings.
