// Content script: adds hover buttons to images, videos and tweets on X/Twitter.
(() => {
  'use strict';

  // ---------- video URL cache (fed by inject.js) ----------
  const mediaMap = new Map(); // media id -> mp4 url
  const tweetMap = new Map(); // tweet id -> [{ mediaId, url }]
  const models = new Map();   // tweet id -> full tweet data (see card.js)

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tws !== 'media') return;
    for (const [k, v] of Object.entries(e.data.media || {})) mediaMap.set(k, v);
    for (const [k, v] of Object.entries(e.data.tweets || {})) tweetMap.set(k, v);
    for (const [k, v] of Object.entries(e.data.models || {})) models.set(k, v);
  });

  const SHARE_LABEL = 'Copy tweet as image (Shift-click: image + link)';

  // ---------- helpers ----------
  const svg = (inner) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
    share: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
    ok: svg('<path d="M20 6 9 17l-5-5"/>'),
    err: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    busy: svg('<path d="M21 12a9 9 0 1 1-6.2-8.56"/>'),
  };

  function bg(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (!r || !r.ok) return reject(new Error((r && r.error) || 'Unknown error'));
          resolve(r);
        });
      } catch (e) {
        reject(new Error('Extension was reloaded — refresh the page'));
      }
    });
  }

  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function makeBtn(action, label, extraClass = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tws-btn tws-${action} ${extraClass}`.trim();
    b.dataset.twsAction = action;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = ICONS[action];
    return b;
  }

  function setState(btn, state) {
    const action = btn.dataset.twsAction;
    clearTimeout(btn.__twsTimer);
    btn.classList.remove('tws-busy', 'tws-ok', 'tws-err');
    if (state === 'busy') { btn.classList.add('tws-busy'); btn.innerHTML = ICONS.busy; return; }
    if (state === 'ok' || state === 'err') {
      btn.classList.add(`tws-${state}`);
      btn.innerHTML = ICONS[state];
      btn.__twsTimer = setTimeout(() => setState(btn, null), 1500);
      return;
    }
    btn.innerHTML = ICONS[action];
  }

  // Feedback lives on the button itself: green check on success, red X on
  // failure (hover the button to see the error message).
  function done(btn, err) {
    if (err) {
      btn.title = `Failed: ${err.message}`;
      setState(btn, 'err');
      console.warn('[Tweet Media Tools]', err);
    } else {
      btn.title = btn.getAttribute('aria-label');
      setState(btn, 'ok');
    }
  }

  function tweetInfo(article) {
    const link = article && article.querySelector('a[href*="/status/"] time')?.closest('a');
    const m = link && link.getAttribute('href').match(/\/([^/]+)\/status\/(\d+)/);
    if (m) return { user: m[1], id: m[2] };
    const p = location.pathname.match(/\/([^/]+)\/status\/(\d+)/);
    return p ? { user: p[1], id: p[2] } : { user: 'tweet', id: String(Date.now()) };
  }

  const safe = (s) => String(s).replace(/[^\w.-]+/g, '_');

  // ---------- decorate DOM ----------
  const IMG_SEL = 'img[src*="pbs.twimg.com/media/"]';

  function decorate() {
    // Images (timeline photos + photo viewer)
    document.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="swipe-to-dismiss"]').forEach((host) => {
      const existing = host.querySelector(':scope > .tws-copy');
      const isVideo = host.querySelector('video, [data-testid="videoPlayer"]');
      if (isVideo || !host.querySelector(IMG_SEL)) { existing && existing.remove(); return; }
      if (!existing) {
        host.classList.add('tws-host');
        host.appendChild(makeBtn('copy', 'Copy image'));
      }
    });

    // Videos & GIFs
    document.querySelectorAll('[data-testid="videoPlayer"]').forEach((host) => {
      if (host.querySelector(':scope > .tws-download')) return;
      host.classList.add('tws-host');
      host.appendChild(makeBtn('download', 'Download video'));
    });

    // Tweets
    document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
      if (article.querySelector('.tws-share')) return;
      // Top-right of the tweet, just left of the "···" menu.
      const caret = article.querySelector('[data-testid="caret"]');
      if (caret && caret.parentElement) {
        caret.parentElement.insertBefore(makeBtn('share', SHARE_LABEL, 'tws-share-inline'), caret);
      } else {
        article.classList.add('tws-host');
        article.appendChild(makeBtn('share', SHARE_LABEL));
      }
    });
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => requestAnimationFrame(() => { scheduled = false; decorate(); }), 150);
  }

  function start() {
    decorate();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  // ---------- event handling ----------
  // Swallow pointer events on our buttons so X doesn't open the photo,
  // toggle the video, or navigate to the tweet.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick']) {
    window.addEventListener(type, (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.tws-btn')) return;
      e.stopImmediatePropagation();
      if (type === 'mousedown') e.preventDefault();
    }, true);
  }

  window.addEventListener('click', (e) => {
    const btn = e.target instanceof Element && e.target.closest('.tws-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (btn.classList.contains('tws-busy')) return;
    const action = btn.dataset.twsAction;
    if (action === 'copy') copyImage(btn);
    else if (action === 'download') downloadVideo(btn);
    else if (action === 'share') shareTweet(btn, e.shiftKey);
  }, true);

  // ---------- 1. copy image ----------
  function originalUrl(src) {
    try {
      const u = new URL(src);
      if (u.searchParams.has('name')) { u.searchParams.set('name', 'orig'); return u.href; }
      return src.replace(/:(\w+)$/, '') + ':orig';
    } catch (_) {
      return src;
    }
  }

  async function fetchAsPng(url) {
    const r = await bg({ type: 'fetch', url });
    const blob = b64ToBlob(r.b64, r.mime);
    if (blob.type === 'image/png') return blob;
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return canvas.convertToBlob({ type: 'image/png' });
  }

  async function copyImage(btn) {
    const img = btn.parentElement.querySelector(IMG_SEL);
    if (!img) return;
    const src = img.currentSrc || img.src;
    setState(btn, 'busy');
    try {
      // Pass a promise so the clipboard write keeps the click's user activation.
      const png = fetchAsPng(originalUrl(src)).catch(() => fetchAsPng(src));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      done(btn);
    } catch (err) {
      done(btn, err);
    }
  }

  // ---------- 2. download video ----------
  async function findVideoUrl(player) {
    const video = player.querySelector('video');
    const src = (video && (video.currentSrc || video.src)) || '';
    if (/^https:\/\/video\.twimg\.com\/.+\.mp4/.test(src)) return src; // GIFs are plain MP4s

    const poster = (video && video.poster) || player.querySelector('img')?.src || '';
    const gif = poster.match(/tweet_video_thumb\/([\w-]+)\./);
    if (gif) return `https://video.twimg.com/tweet_video/${gif[1]}.mp4`;

    const mediaId = (poster.match(/(?:ext_tw_video_thumb|amplify_video_thumb|media)\/(\d+)/) || [])[1];
    if (mediaId && mediaMap.has(mediaId)) return mediaMap.get(mediaId);

    const article = player.closest('article');
    const { id: tweetId } = tweetInfo(article);
    const players = article ? [...article.querySelectorAll('[data-testid="videoPlayer"]')] : [player];
    const index = Math.max(0, players.indexOf(player));
    const list = tweetMap.get(tweetId);
    if (list) {
      const hit = (mediaId && list.find((v) => v.mediaId === mediaId)) || list[index];
      if (hit) return hit.url;
    }
    const r = await bg({ type: 'resolveVideo', tweetId, mediaId, index });
    return r.url;
  }

  async function downloadVideo(btn) {
    const player = btn.parentElement;
    setState(btn, 'busy');
    try {
      const url = await findVideoUrl(player);
      if (!url) throw new Error('No downloadable video found');
      const { user, id } = tweetInfo(player.closest('article'));
      await bg({ type: 'download', url, filename: `${safe(user)}_${safe(id)}.mp4` });
      done(btn);
    } catch (err) {
      done(btn, err);
    }
  }

  // ---------- 3. share tweet as image ----------
  // The image is drawn from the tweet's data (card.js), not screenshotted,
  // so nothing on the page moves and long text / all images are included.

  function fromSyndication(d, depth = 0) {
    if (!d || !d.id_str) return null;
    const media = (d.mediaDetails || []).map((m) => ({
      type: m.type,
      url: m.media_url_https,
      w: m.original_info && m.original_info.width,
      h: m.original_info && m.original_info.height,
    }));
    const quote = depth < 1 ? fromSyndication(d.quoted_tweet, depth + 1) : null;
    const entities = d.entities || {};
    const body = TwsCard.cleanText(d.text, d.display_text_range, entities.urls,
      entities.media || d.mediaDetails, quote && quote.id);
    const u = d.user || {};
    return {
      id: d.id_str,
      user: { name: u.name, handle: u.screen_name, avatar: u.profile_image_url_https, verified: !!(u.is_blue_verified || u.verified) },
      createdAt: d.created_at,
      text: body.text,
      links: body.links,
      media,
      quote,
      counts: { replies: d.conversation_count, likes: d.favorite_count },
    };
  }

  // Last resort: read what's on the page (text may be cut at "Show more").
  function fromDom(article, info) {
    const nameEl = article.querySelector('[data-testid="User-Name"] a span');
    const media = [];
    article.querySelectorAll('[data-testid="tweetPhoto"] img[src*="/media/"], video[poster]').forEach((el) => {
      if (el.tagName === 'VIDEO') media.push({ type: 'video', url: el.poster });
      else media.push({ type: 'photo', url: el.src });
    });
    return {
      id: info.id,
      user: {
        name: nameEl ? nameEl.innerText : info.user,
        handle: info.user,
        avatar: article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.src || '',
        verified: !!article.querySelector('[data-testid="icon-verified"]'),
      },
      createdAt: article.querySelector('time')?.getAttribute('datetime'),
      text: article.querySelector('[data-testid="tweetText"]')?.innerText || '',
      links: [],
      media,
      quote: null,
      counts: {},
    };
  }

  async function tweetModel(article) {
    const info = tweetInfo(article);
    if (models.has(info.id)) return models.get(info.id);
    try {
      const { data } = await bg({ type: 'syndication', tweetId: info.id });
      const t = fromSyndication(data);
      if (t) return t;
    } catch (_) {}
    return fromDom(article, info);
  }

  function largeUrl(url) {
    try {
      const u = new URL(url);
      if (!/(^|\.)twimg\.com$/.test(u.hostname) || !/\/(media|\w*video_thumb)\//.test(u.pathname)) return url;
      u.searchParams.set('name', 'large');
      return u.href;
    } catch (_) {
      return url;
    }
  }

  async function loadImage(url) {
    const get = async (u) => {
      const r = await bg({ type: 'fetch', url: u });
      return createImageBitmap(b64ToBlob(r.b64, r.mime));
    };
    const big = largeUrl(url);
    return big === url ? get(url) : get(big).catch(() => get(url));
  }

  function pageTheme() {
    const m = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || []).map(Number);
    if (m.length < 3 || (m.length > 3 && m[3] === 0)) return 'light';
    if (m[0] + m[1] + m[2] > 600) return 'light';
    return m[2] > 30 ? 'dim' : 'dark';
  }

  async function renderTweet(article) {
    const model = await tweetModel(article);
    return TwsCard.render(model, { theme: pageTheme(), loadImage });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  const escapeHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Image + link in one clipboard entry: apps that accept HTML get both,
  // image-only apps take the PNG, text-only apps take the URL.
  function imageLinkItem(pngPromise, link) {
    const html = pngPromise.then(async (png) => {
      const src = await blobToDataUrl(png);
      const a = escapeHtml(link);
      return new Blob([`<img src="${src}" alt="Tweet"><br><a href="${a}">${a}</a>`], { type: 'text/html' });
    });
    return new ClipboardItem({
      'image/png': pngPromise,
      'text/html': html,
      'text/plain': new Blob([link], { type: 'text/plain' }),
    });
  }

  let rendering = false;
  async function shareTweet(btn, withLink) {
    const article = btn.closest('article');
    if (!article || rendering) return;
    const { user, id } = tweetInfo(article);
    const link = `${location.origin}/${user}/status/${id}`;

    rendering = true;
    setState(btn, 'busy');
    try {
      // Pass the pending render as a promise so the write keeps the click's user activation.
      const png = renderTweet(article);
      const item = withLink ? imageLinkItem(png, link) : new ClipboardItem({ 'image/png': png });
      await navigator.clipboard.write([item]);
      done(btn);
    } catch (err) {
      done(btn, err);
    } finally {
      rendering = false;
    }
  }
})();
