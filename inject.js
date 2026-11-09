// Runs in the page's own JS world. Watches X's API responses for video
// metadata and forwards the best MP4 URLs to the content script.
(() => {
  if (window.__twsInjected) return;
  window.__twsInjected = true;

  const API_RE = /\/(graphql|i\/api)\//;

  function bestMp4(variants) {
    let best = null;
    for (const v of variants || []) {
      if (v && v.url && v.content_type === 'video/mp4') {
        if (!best || (v.bitrate || 0) > (best.bitrate || 0)) best = v;
      }
    }
    return best ? best.url : null;
  }

  function videosOf(mediaList) {
    const out = [];
    for (const m of mediaList || []) {
      const url = m && m.video_info && bestMp4(m.video_info.variants);
      if (url) out.push({ mediaId: m.id_str, url });
    }
    return out;
  }

  function scan(root) {
    const media = {};
    const tweets = {};
    let found = false;
    const stack = [root];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) {
        for (const x of o) if (x && typeof x === 'object') stack.push(x);
        continue;
      }
      if (o.video_info && o.id_str) {
        const url = bestMp4(o.video_info.variants);
        if (url) { media[o.id_str] = url; found = true; }
      }
      const legacyMedia = o.legacy && o.legacy.extended_entities && o.legacy.extended_entities.media;
      const tid = o.rest_id || (o.legacy && o.legacy.id_str);
      if (Array.isArray(legacyMedia) && tid) {
        const list = videosOf(legacyMedia);
        if (list.length) { tweets[tid] = list; found = true; }
      }
      if (o.extended_entities && Array.isArray(o.extended_entities.media) && o.id_str) {
        const list = videosOf(o.extended_entities.media);
        if (list.length) { tweets[o.id_str] = list; found = true; }
      }
      for (const k in o) {
        const v = o[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
    if (found) window.postMessage({ __tws: 'media', media, tweets }, location.origin);
  }

  // XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__twsUrl = String(url); } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__twsUrl && API_RE.test(this.__twsUrl)) {
      this.addEventListener('load', () => {
        try {
          let data = null;
          if (this.responseType === '' || this.responseType === 'text') data = JSON.parse(this.responseText);
          else if (this.responseType === 'json') data = this.response;
          if (data) scan(data);
        } catch (_) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // fetch
  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (url && API_RE.test(url)) {
        p.then((r) => r.clone().json().then(scan)).catch(() => {});
      }
    } catch (_) {}
    return p;
  };
})();
