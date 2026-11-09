// Service worker: does the work content scripts can't (cross-origin fetch,
// downloads).

// After an install or update, open X tabs still run the old content script,
// which can no longer reach this worker. Inject the new one so copy and share
// keep working without a page refresh (content.js retires the old copy).
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  const groups = chrome.runtime.getManifest().content_scripts || [];
  const urls = [...new Set(groups.flatMap((g) => g.matches))];
  const tabs = await chrome.tabs.query({ url: urls });
  for (const tab of tabs) {
    if (tab.discarded) continue; // reloads on its own when next opened
    const target = { tabId: tab.id };
    for (const g of groups) {
      try {
        if (g.css) await chrome.scripting.insertCSS({ target, files: g.css });
        if (g.js) {
          await chrome.scripting.executeScript({ target, files: g.js, world: g.world || 'ISOLATED' });
        }
      } catch (_) {} // tab closed or not scriptable; nothing to fix there
    }
  }
});

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
    case 'syndication':
      return { data: await fetchSyndication(msg.tweetId) };
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
async function fetchSyndication(tweetId) {
  const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=${token}&lang=en`,
    { credentials: 'omit' }
  );
  if (!res.ok) throw new Error(`Lookup failed (HTTP ${res.status})`);
  return res.json();
}

async function resolveVideo(tweetId, mediaId, index) {
  const data = await fetchSyndication(tweetId);

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
