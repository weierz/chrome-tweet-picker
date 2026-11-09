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

  // ---- full tweet data, used to draw the "share as image" card ----
  function userOf(r) {
    r = r && (r.result || r);
    if (!r) return null;
    const l = r.legacy || {};
    const c = r.core || {};
    return {
      name: c.name || l.name || '',
      handle: c.screen_name || l.screen_name || '',
      avatar: (r.avatar && r.avatar.image_url) || l.profile_image_url_https || '',
      verified: !!(r.is_blue_verified || l.verified),
    };
  }

  // Strip media/quote t.co links, expand the rest to their display form.
  function cleanText(text, range, urls, media, quoteId) {
    // X counts display_text_range on the decoded text, so decode entities first.
    const decoded = (text || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    let t = range ? Array.from(decoded).slice(range[0], range[1]).join('') : decoded;
    const links = [];
    for (const m of media || []) if (m.url) t = t.split(m.url).join('');
    for (const u of urls || []) {
      if (!u.url) continue;
      const isQuote = quoteId && /\/status\/(\d+)/.exec(u.expanded_url || '')?.[1] === quoteId;
      const d = isQuote ? '' : (u.expanded_url || u.display_url || u.url);
      t = t.split(u.url).join(d);
      if (d) links.push(d);
    }
    t = t.trim();
    return { text: t, links };
  }

  function tweetOf(o, depth) {
    if (o && o.__typename === 'TweetWithVisibilityResults') o = o.tweet;
    if (!o || !o.rest_id || !o.legacy || typeof o.legacy.full_text !== 'string') return null;
    const l = o.legacy;
    const note = o.note_tweet && o.note_tweet.note_tweet_results && o.note_tweet.note_tweet_results.result;
    const mediaList = (l.extended_entities && l.extended_entities.media) || (l.entities && l.entities.media) || [];
    // A quoted tweet's own quote comes as nested_quoted_tweet_results
    // (its quoted_status_result is only a { rest_id } reference).
    const quoteRaw = (o.quoted_status_result && o.quoted_status_result.result) ||
      (o.nested_quoted_tweet_results && o.nested_quoted_tweet_results.result);
    const quote = depth < 2 ? tweetOf(quoteRaw, depth + 1) : null;
    const quoteId = (quote && quote.id) || l.quoted_status_id_str;
    const urls = note ? note.entity_set && note.entity_set.urls : l.entities && l.entities.urls;
    const body = note
      ? cleanText(note.text || '', null, urls, mediaList, quoteId)
      : cleanText(l.full_text, l.display_text_range, urls, mediaList, quoteId);
    const card = o.card && o.card.legacy;
    return {
      id: o.rest_id,
      lang: l.lang,
      user: userOf(o.core && o.core.user_results),
      createdAt: l.created_at,
      text: body.text,
      links: body.links,
      media: mediaList.map((m) => ({
        type: m.type,
        url: m.media_url_https,
        w: m.original_info && m.original_info.width,
        h: m.original_info && m.original_info.height,
      })),
      quote,
      // Link preview; parsed by card.js in the content script.
      cardRaw: card ? { name: card.name, url: card.url, binding_values: card.binding_values } : null,
      cardUrls: (urls || []).concat((l.entities && l.entities.urls) || [])
        .map((u) => ({ url: u.url, expanded_url: u.expanded_url })),
      counts: {
        replies: l.reply_count,
        reposts: l.retweet_count,
        likes: l.favorite_count,
        views: o.views && o.views.count != null ? Number(o.views.count) : undefined,
      },
    };
  }

  function scan(root) {
    const media = {};
    const tweets = {};
    const models = {};
    let found = false;
    const stack = [root];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) {
        for (const x of o) if (x && typeof x === 'object') stack.push(x);
        continue;
      }
      if (o.rest_id && o.legacy) {
        try {
          const t = tweetOf(o, 0);
          if (t) { models[t.id] = t; found = true; }
        } catch (_) {}
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
    if (found) window.postMessage({ __tws: 'media', media, tweets, models }, location.origin);
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
