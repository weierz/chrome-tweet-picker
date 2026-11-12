// Runs in the page's own JS world. Watches X's API responses for video
// metadata and forwards the best MP4 URLs to the content script.
// After an extension update a newer copy runs in the same page: it takes over
// scanning (window.__twsScan) while the network hooks stay installed once.
(() => {
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

  // X Article (long-form post). The full body (content_state) only comes with
  // the tweet's detail request; timelines carry just the title and preview.
  function articleOf(o) {
    const a = o.article && o.article.article_results && o.article.article_results.result;
    if (!a || !a.title) return null;
    const img = (m) => {
      const i = m && m.media_info;
      return i && i.original_img_url ? { url: i.original_img_url, w: i.original_img_width, h: i.original_img_height } : null;
    };
    const mediaById = {};
    for (const m of a.media_entities || []) {
      const i = img(m);
      if (i) mediaById[m.media_id] = i;
    }
    let blocks = null;
    const cs = a.content_state;
    if (cs && Array.isArray(cs.blocks)) {
      const ents = {};
      const list = Array.isArray(cs.entityMap) ? cs.entityMap
        : Object.entries(cs.entityMap || {}).map(([key, value]) => ({ key, value }));
      for (const e of list) if (e && e.value) ents[e.key] = e.value;
      blocks = cs.blocks.map((b) => {
        const out = {
          type: b.type,
          text: b.text || '',
          depth: b.depth || 0,
          styles: (b.inlineStyleRanges || []).map((r) => ({ o: r.offset, l: r.length, s: r.style })),
          links: [],
        };
        for (const r of b.entityRanges || []) {
          const e = ents[r.key];
          const d = (e && e.data) || {};
          if (!e) continue;
          if (e.type === 'LINK') out.links.push({ o: r.offset, l: r.length });
          else if (b.type === 'atomic') {
            out.entity = e.type;
            if (e.type === 'MEDIA') {
              out.media = (d.mediaItems || []).map((i) => mediaById[i.mediaId]).filter(Boolean);
              out.caption = d.caption || '';
            } else if (e.type === 'MARKDOWN') out.code = d.markdown || '';
            else if (e.type === 'TWEET') out.tweetId = d.tweetId || '';
          }
        }
        return out;
      });
    }
    return { id: a.rest_id, title: a.title, preview: a.preview_text || '', cover: img(a.cover_media), blocks };
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
      // Thread links: the post this one answers, and the thread it starts or continues.
      replyTo: l.in_reply_to_status_id_str || null,
      replyToUser: l.in_reply_to_screen_name || null,
      selfThread: (l.self_thread && l.self_thread.id_str) || null,
      text: body.text,
      links: body.links,
      media: mediaList.map((m) => ({
        type: m.type,
        url: m.media_url_https,
        w: m.original_info && m.original_info.width,
        h: m.original_info && m.original_info.height,
      })),
      quote,
      article: articleOf(o),
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

  // ---- full article on demand ----
  // Timelines only carry an article's preview, so ask X's API for the post
  // the same way the page does (same session, same endpoint) and scan it.
  const state = window.__twsState || (window.__twsState = { ops: {}, features: null, auth: null, fetch: null });
  // X's public web-app token, used only if the page's own one wasn't seen.
  const BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

  function noteRequest(url) {
    try {
      const u = new URL(url, location.href);
      const m = /\/graphql\/([\w-]+)\/(\w+)$/.exec(u.pathname);
      if (!m) return;
      state.ops[m[2]] = m[1];
      // Reuse the feature flags of a request that loads tweets (others lack
      // the article ones), preferring the very query used below.
      const f = u.searchParams.get('features');
      if (f) (state.opFeatures || (state.opFeatures = {}))[m[2]] = f;
      if (f && f.includes('article_tweet_consumption') && (m[2] === 'TweetResultByRestId' || !state.exactFeatures)) {
        state.features = f;
        state.exactFeatures = m[2] === 'TweetResultByRestId';
      }
    } catch (_) {}
  }

  async function queryId(op) {
    if (state.ops[op]) return state.ops[op];
    const src = [...document.scripts].map((s) => s.src).find((s) => /\/main\.\w+\.js$/.test(s));
    if (!src) return null;
    const js = await (await fetch(src)).text();
    const m = new RegExp(`queryId:"([\\w-]+)",operationName:"${op}"`).exec(js);
    if (m) state.ops[op] = m[1];
    return m && m[1];
  }

  // GET one of X's GraphQL queries with the page's own session, and scan the result.
  async function query(op, variables, fieldToggles) {
    const qid = await queryId(op);
    const ct0 = (/(?:^|;\s*)ct0=([^;]+)/.exec(document.cookie) || [])[1];
    const features = (state.opFeatures && state.opFeatures[op]) || state.features;
    if (!qid || !features || !ct0) throw new Error('X API not available');
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify({
        ...JSON.parse(features),
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        articles_preview_enabled: true,
      }),
      fieldToggles: JSON.stringify(fieldToggles),
    });
    const res = await (state.fetch || window.fetch).call(window, `/i/api/graphql/${qid}/${op}?${params}`, {
      credentials: 'include',
      headers: {
        authorization: state.auth || BEARER,
        'x-csrf-token': decodeURIComponent(ct0),
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'content-type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    window.__twsScan(await res.json());
  }

  const fetchArticle = (tweetId) => query('TweetResultByRestId',
    { tweetId, withCommunity: false, includePromotedContent: false, withVoice: false },
    { withArticleRichContentState: true, withArticlePlainText: false });

  // A post's conversation as its page loads it: every post above it, and the
  // replies below (the author's own continuation first).
  const fetchDetail = (focalTweetId) => query('TweetDetail', {
    focalTweetId, with_rux_injections: false, rankingMode: 'Relevance', includePromotedContent: false,
    withCommunity: true, withQuickPromoteEligibilityTweetFields: false, withBirdwatchNotes: true, withVoice: true,
  }, { withArticleRichContentState: true, withArticlePlainText: false, withGrokAnalyze: false, withDisallowedReplyControls: false });

  window.__twsScan = scan;
  window.__twsArticle = fetchArticle;
  window.__twsDetail = fetchDetail;
  if (window.__twsHooks) return;
  window.__twsHooks = true;
  window.__twsInjected = true;

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tws !== 'getArticle') return;
    const id = String(e.data.id);
    const reply = (ok) => window.postMessage({ __tws: 'articleDone', id, ok }, location.origin);
    window.__twsArticle(id).then(() => reply(true), () => reply(false));
  });
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tws !== 'getDetail') return;
    const id = String(e.data.id);
    const reply = (ok, error) => window.postMessage({ __tws: 'detailDone', id, ok, error }, location.origin);
    window.__twsDetail(id).then(() => reply(true), (err) => reply(false, String(err && err.message || err)));
  });

  // XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__twsUrl = String(url); noteRequest(this.__twsUrl); } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (/^authorization$/i.test(name) && /^Bearer /.test(value) && API_RE.test(this.__twsUrl || '')) state.auth = value;
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__twsUrl && API_RE.test(this.__twsUrl)) {
      this.addEventListener('load', () => {
        try {
          let data = null;
          if (this.responseType === '' || this.responseType === 'text') data = JSON.parse(this.responseText);
          else if (this.responseType === 'json') data = this.response;
          if (data) window.__twsScan(data);
        } catch (_) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // fetch
  const origFetch = window.fetch;
  state.fetch = origFetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      if (url && API_RE.test(url)) {
        noteRequest(url);
        const h = init && init.headers;
        const auth = h && (typeof h.get === 'function' ? h.get('authorization') : h.authorization || h.Authorization);
        if (auth && /^Bearer /.test(auth)) state.auth = auth;
        p.then((r) => r.clone().json().then((d) => window.__twsScan(d))).catch(() => {});
      }
    } catch (_) {}
    return p;
  };
})();
