// Service worker: does the work content scripts can't (cross-origin fetch,
// tab screenshots, downloads).

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // async response
});

async function handle(msg, sender) {
  switch (msg && msg.type) {
    case 'fetch': {
      const res = await fetch(msg.url, { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      return { b64: toBase64(buf), mime: res.headers.get('content-type') || 'image/jpeg' };
    }
    case 'capture': {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      return { dataUrl };
    }
    case 'download': {
      const id = await chrome.downloads.download({
        url: msg.url,
        filename: msg.filename,
        conflictAction: 'uniquify',
      });
      return { id };
    }
    case 'resolveVideo':
      return { url: await resolveVideo(msg.tweetId, msg.mediaId, msg.index) };
    default:
      throw new Error('Unknown message');
  }
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function bestMp4(variants) {
  let best = null;
  for (const v of variants || []) {
    if (v && v.url && (v.content_type === 'video/mp4' || v.type === 'video/mp4')) {
      if (!best || (v.bitrate || 0) > (best.bitrate || 0)) best = v;
    }
  }
  return best ? best.url : null;
}

// Fallback when the video URL wasn't seen in X's own API traffic:
// the public embed (syndication) endpoint returns the tweet's media variants.
async function resolveVideo(tweetId, mediaId, index) {
  const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=${token}&lang=en`,
    { credentials: 'omit' }
  );
  if (!res.ok) throw new Error(`Lookup failed (HTTP ${res.status})`);
  const data = await res.json();

  const videos = [];
  const collect = (t) => {
    for (const m of (t && t.mediaDetails) || []) {
      const url = m.video_info && bestMp4(m.video_info.variants);
      if (url) videos.push({ mediaId: m.id_str, url });
    }
  };
  collect(data);
  collect(data.quoted_tweet);

  const match =
    (mediaId && videos.find((v) => v.mediaId === mediaId)) ||
    videos[index || 0] ||
    videos[0];
  if (!match) throw new Error('No downloadable video found');
  return match.url;
}
