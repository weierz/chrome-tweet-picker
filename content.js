// Content script: adds hover buttons to images, videos and tweets on X/Twitter.
(() => {
  'use strict';

  // ---------- video URL cache (fed by inject.js) ----------
  const mediaMap = new Map(); // media id -> mp4 url
  const tweetMap = new Map(); // tweet id -> [{ mediaId, url }]

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tws !== 'media') return;
    for (const [k, v] of Object.entries(e.data.media || {})) mediaMap.set(k, v);
    for (const [k, v] of Object.entries(e.data.tweets || {})) tweetMap.set(k, v);
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

  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    return b64ToBlob(b64, head.slice(5, head.indexOf(';')));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n) => new Promise((r) => {
    const step = () => (--n <= 0 ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

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
  function hideOverlays(el) {
    const r = el.getBoundingClientRect();
    const hidden = [];
    for (const node of document.body.querySelectorAll('*')) {
      if (node === el || node.contains(el) || el.contains(node)) continue;
      const pos = getComputedStyle(node).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const nr = node.getBoundingClientRect();
      if (!nr.width || !nr.height || nr.right <= r.left || nr.left >= r.right) continue;
      hidden.push([node, node.style.getPropertyValue('visibility'), node.style.getPropertyPriority('visibility')]);
      node.style.setProperty('visibility', 'hidden', 'important');
    }
    return () => {
      for (const [node, value, prio] of hidden) {
        if (value) node.style.setProperty('visibility', value, prio);
        else node.style.removeProperty('visibility');
      }
    };
  }

  async function captureElement(el) {
    const root = document.documentElement;
    root.classList.add('tws-capturing');
    const restoreOverlays = hideOverlays(el);
    const startX = window.scrollX;
    const startY = window.scrollY;
    try {
      const r0 = el.getBoundingClientRect();
      const width = r0.width;
      const height = r0.height;
      const absTop = r0.top + window.scrollY;
      let canvas = null, ctx = null, scale = 1;
      let y = 0, lastShot = 0;

      while (y < height - 0.5) {
        window.scrollTo(startX, absTop + y);
        await frames(2);
        const wait = 550 - (Date.now() - lastShot); // captureVisibleTab is rate-limited to 2/s
        if (wait > 0) await sleep(wait);

        const r = el.getBoundingClientRect();
        const { dataUrl } = await bg({ type: 'capture' });
        lastShot = Date.now();
        const bmp = await createImageBitmap(dataUrlToBlob(dataUrl));
        if (!canvas) {
          scale = bmp.width / window.innerWidth;
          canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
          ctx = canvas.getContext('2d');
        }
        const srcTop = Math.max(r.top + y, 0);
        const h = Math.min(r.bottom, window.innerHeight) - srcTop;
        if (h <= 0) { bmp.close(); break; }
        ctx.drawImage(bmp, r.left * scale, srcTop * scale, width * scale, h * scale,
          0, y * scale, width * scale, h * scale);
        bmp.close();
        y += h;
      }
      if (!canvas) throw new Error('Nothing to capture');
      return await canvas.convertToBlob({ type: 'image/png' });
    } finally {
      restoreOverlays();
      root.classList.remove('tws-capturing');
      window.scrollTo(startX, startY);
    }
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

  let capturing = false;
  async function shareTweet(btn, withLink) {
    const article = btn.closest('article');
    if (!article || capturing) return;
    const { user, id } = tweetInfo(article);
    const link = `${location.origin}/${user}/status/${id}`;

    capturing = true;
    setState(btn, 'busy');
    try {
      // Pass the pending capture as a promise so the write keeps the click's user activation.
      const png = captureElement(article);
      const item = withLink ? imageLinkItem(png, link) : new ClipboardItem({ 'image/png': png });
      await navigator.clipboard.write([item]);
      done(btn);
    } catch (err) {
      done(btn, err);
    } finally {
      capturing = false;
    }
  }
})();
