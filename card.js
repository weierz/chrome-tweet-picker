// Draws a tweet (normalised model) onto a canvas and returns a PNG blob.
// No screenshots: the full text and every image are always included.
//
// model = {
//   id, user: { name, handle, avatar, verified }, createdAt, text, links: [displayUrl],
//   media: [{ type: 'photo'|'video'|'animated_gif', url, w, h }],
//   quote: model | null, counts: { replies, reposts, likes, views }
// }
(() => {
  'use strict';

  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", ' +
    '"Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  const THEMES = {
    light: { bg: '#ffffff', text: '#0f1419', muted: '#536471', border: '#cfd9de', link: '#1d9bf0', fill: '#eff3f4' },
    dim: { bg: '#15202b', text: '#f7f9f9', muted: '#8b98a5', border: '#38444d', link: '#1d9bf0', fill: '#1e2732' },
    dark: { bg: '#000000', text: '#e7e9ea', muted: '#71767b', border: '#2f3336', link: '#1d9bf0', fill: '#16181c' },
  };
  const W = 600;      // card width (CSS px)
  const PAD = 24;
  const SCALE = 2;    // output pixel density
  const BLUE = '#1d9bf0';

  const wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' });
  const graphemeSeg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  // ---------- text ----------
  function cleanText(text, range, urls, media, quoteId) {
    // X counts display_text_range on the decoded text, so decode entities first.
    const decoded = (text || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    let t = range ? Array.from(decoded).slice(range[0], range[1]).join('') : decoded;
    const links = [];
    for (const m of media || []) if (m && m.url) t = t.split(m.url).join('');
    for (const u of urls || []) {
      if (!u || !u.url) continue;
      const isQuote = quoteId && (/\/status\/(\d+)/.exec(u.expanded_url || '') || [])[1] === quoteId;
      const d = isQuote ? '' : (u.expanded_url || u.display_url || u.url);
      t = t.split(u.url).join(d);
      if (d) links.push(d);
    }
    t = t.trim();
    return { text: t, links };
  }

  function linkRanges(text, links) {
    const ranges = [];
    let m;
    const tag = /(^|[^\p{L}\p{N}_])([@#][\p{L}\p{N}_]+)/gu;
    while ((m = tag.exec(text))) {
      const s = m.index + m[1].length;
      ranges.push([s, s + m[2].length]);
    }
    const url = /https?:\/\/\S+/g;
    while ((m = url.exec(text))) ranges.push([m.index, m.index + m[0].length]);
    for (const l of links || []) {
      if (!l) continue;
      for (let i = text.indexOf(l); i >= 0; i = text.indexOf(l, i + l.length)) ranges.push([i, i + l.length]);
    }
    return ranges;
  }

  // CJK can break between any two characters; closing punctuation never starts a line.
  const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;
  const NO_LINE_START = /^[，。、；：！？）」』》〉】,.!?;:)\]}%]$/;

  // Word-wrap via Intl.Segmenter. Returns lines of positioned pieces.
  function wrap(ctx, text, maxW, ranges) {
    const isLink = (i) => ranges.some(([a, b]) => i >= a && i < b);
    const lines = [];
    let offset = 0;
    for (const para of text.split('\n')) {
      let line = [];
      let x = 0;
      const push = (t, idx) => {
        const w = ctx.measureText(t).width;
        const blank = !t.trim();
        if (x + w > maxW && line.length && !NO_LINE_START.test(t)) {
          lines.push(line);
          line = [];
          x = 0;
          if (blank) return; // no leading space on wrapped lines
        }
        line.push({ t, x, link: isLink(offset + idx) });
        x += w;
      };
      for (const s of wordSeg.segment(para)) {
        if (CJK.test(s.segment) || ctx.measureText(s.segment).width > maxW) {
          for (const g of graphemeSeg.segment(s.segment)) push(g.segment, s.index + g.index);
        } else {
          push(s.segment, s.index);
        }
      }
      lines.push(line);
      offset += para.length + 1;
    }
    return lines;
  }

  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    const g = [...graphemeSeg.segment(text)].map((s) => s.segment);
    while (g.length && ctx.measureText(g.join('') + '…').width > maxW) g.pop();
    return g.join('') + '…';
  }

  function formatDate(s) {
    const d = new Date(s);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' · ' +
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const avatarUrl = (u) => (u || '').replace(/_(normal|bigger|mini)(\.\w+)$/, '_200x200$2');

  // ---------- drawing primitives ----------
  function drawAvatar(ctx, bmp, x, y, size, th) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    if (bmp) ctx.drawImage(bmp, x, y, size, size);
    else { ctx.fillStyle = th.fill; ctx.fillRect(x, y, size, size); }
    ctx.restore();
  }

  function drawBadge(ctx, cx, cy, r) {
    ctx.save();
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = r * 0.28;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
    ctx.lineTo(cx - r * 0.12, cy + r * 0.35);
    ctx.lineTo(cx + r * 0.48, cy - r * 0.32);
    ctx.stroke();
    ctx.restore();
  }

  function drawMedia(ctx, item, x, y, w, h, radius, th) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.clip();
    if (item.bmp) ctx.drawImage(item.bmp, x, y, w, h);
    else { ctx.fillStyle = th.fill; ctx.fillRect(x, y, w, h); }
    ctx.restore();

    if (item.m.type === 'video' || item.m.type === 'animated_gif') {
      const r = Math.min(26, w / 5, h / 5);
      const cx = x + w / 2, cy = y + h / 2;
      ctx.save();
      ctx.fillStyle = BLUE;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.3, cy - r * 0.45);
      ctx.lineTo(cx + r * 0.5, cy);
      ctx.lineTo(cx - r * 0.3, cy + r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- layout ----------
  // Every block measures with `m` and pushes draw closures to `ops`; returns the new y.

  function textBlock(L, text, links, x, y, maxW, size, lineH, color) {
    const font = `400 ${size}px ${FONT}`;
    L.m.font = font;
    const lines = wrap(L.m, text, maxW, linkRanges(text, links));
    L.ops.push((ctx) => {
      ctx.font = font;
      ctx.textBaseline = 'middle';
      lines.forEach((line, i) => {
        const by = y + i * lineH + lineH / 2;
        for (const p of line) {
          ctx.fillStyle = p.link ? L.th.link : color;
          ctx.fillText(p.t, x + p.x, by);
        }
      });
    });
    return y + lines.length * lineH;
  }

  // Uncropped "justified" rows: every image keeps its aspect ratio.
  function mediaBlock(L, media, x, y, maxW, maxRowH, radius) {
    const items = media.map((m) => {
      const bmp = L.imgs.get(m.url);
      const ar = bmp ? bmp.width / bmp.height : (m.w && m.h ? m.w / m.h : 16 / 9);
      return { m, bmp, ar };
    });
    const rows = items.length <= 2 ? [items]
      : items.length === 3 ? [items.slice(0, 1), items.slice(1)]
      : [items.slice(0, 2), items.slice(2, 4)];
    const GAP = 4;
    for (const row of rows) {
      const sumAr = row.reduce((s, it) => s + it.ar, 0);
      let h = (maxW - GAP * (row.length - 1)) / sumAr;
      let rowW = maxW;
      if (h > maxRowH) { h = maxRowH; rowW = sumAr * h + GAP * (row.length - 1); }
      let cx = x + (maxW - rowW) / 2;
      for (const it of row) {
        const w = it.ar * h, X = cx, Y = y;
        L.ops.push((ctx) => drawMedia(ctx, it, X, Y, w, h, radius, L.th));
        cx += w + GAP;
      }
      y += h + GAP;
    }
    return y - GAP;
  }

  function userLine(L, user, x, y, avSize, nameSize, inlineHandle, maxW) {
    const th = L.th;
    const av = L.imgs.get(avatarUrl(user.avatar));
    L.ops.push((ctx) => drawAvatar(ctx, av, x, y, avSize, th));
    const nx = x + avSize + (inlineHandle ? 8 : 12);
    const nameFont = `700 ${nameSize}px ${FONT}`;
    const handleFont = `400 ${nameSize - (inlineHandle ? 0 : 2)}px ${FONT}`;
    const badgeR = nameSize * 0.5;
    const avail = x + maxW - nx;

    L.m.font = nameFont;
    const name = fit(L.m, user.name || user.handle || '', avail - (user.verified ? badgeR * 2 + 6 : 0) - (inlineHandle ? 60 : 0));
    const nameW = L.m.measureText(name).width;
    const afterName = nameW + (user.verified ? badgeR * 2 + 6 : 0);
    L.m.font = handleFont;
    const handle = fit(L.m, '@' + (user.handle || ''), inlineHandle ? Math.max(0, avail - afterName - 6) : avail);

    const nameY = inlineHandle ? y + avSize / 2 : y + avSize * 0.3;
    const handleY = inlineHandle ? nameY : y + avSize * 0.75;
    const handleX = inlineHandle ? nx + afterName + 6 : nx;
    L.ops.push((ctx) => {
      ctx.textBaseline = 'middle';
      ctx.font = nameFont;
      ctx.fillStyle = th.text;
      ctx.fillText(name, nx, nameY);
      if (user.verified) drawBadge(ctx, nx + nameW + 4 + badgeR, nameY, badgeR);
      ctx.font = handleFont;
      ctx.fillStyle = th.muted;
      ctx.fillText(handle, handleX, handleY);
    });
    return y + avSize;
  }

  function countsLine(L, counts, x, y) {
    const parts = [
      [counts.replies, 'Reply', 'Replies'],
      [counts.reposts, 'Repost', 'Reposts'],
      [counts.likes, 'Like', 'Likes'],
      [counts.views, 'View', 'Views'],
    ].filter(([n]) => typeof n === 'number' && n > 0);
    if (!parts.length) return y;
    const numFont = `700 15px ${FONT}`, lblFont = `400 15px ${FONT}`;
    const pieces = [];
    let cx = x;
    for (const [n, one, many] of parts) {
      const num = compact.format(n);
      const lbl = ' ' + (n === 1 ? one : many);
      L.m.font = numFont;
      const nw = L.m.measureText(num).width;
      L.m.font = lblFont;
      const lw = L.m.measureText(lbl).width;
      pieces.push([num, cx, lbl, cx + nw]);
      cx += nw + lw + 20;
    }
    const th = L.th;
    L.ops.push((ctx) => {
      ctx.textBaseline = 'middle';
      for (const [num, nx, lbl, lx] of pieces) {
        ctx.font = numFont; ctx.fillStyle = th.text; ctx.fillText(num, nx, y + 10);
        ctx.font = lblFont; ctx.fillStyle = th.muted; ctx.fillText(lbl, lx, y + 10);
      }
    });
    return y + 20;
  }

  async function render(model, { theme = 'light', loadImage }) {
    const th = THEMES[theme] || THEMES.light;

    // Load every image first so the layout knows real aspect ratios.
    const urls = new Set();
    const collect = (t) => {
      if (!t) return;
      if (t.user && t.user.avatar) urls.add(avatarUrl(t.user.avatar));
      for (const m of t.media || []) if (m.url) urls.add(m.url);
      collect(t.quote);
    };
    collect(model);
    const imgs = new Map();
    await Promise.all([...urls].map(async (u) => {
      try { const b = await loadImage(u); if (b) imgs.set(u, b); } catch (_) {}
    }));

    const L = { m: new OffscreenCanvas(1, 1).getContext('2d'), ops: [], th, imgs };
    const innerW = W - PAD * 2;
    let y = PAD;

    y = userLine(L, model.user || {}, PAD, y, 48, 17, false, innerW);
    if (model.text) y = textBlock(L, model.text, model.links, PAD, y + 12, innerW, 18, 26, th.text);
    if (model.media && model.media.length) y = mediaBlock(L, model.media, PAD, y + 14, innerW, innerW * 1.2, 16);

    const q = model.quote;
    if (q) {
      const top = y + 14, ip = 14, qInner = innerW - ip * 2;
      let qy = userLine(L, q.user || {}, PAD + ip, top + ip, 22, 15, true, qInner);
      if (q.text) qy = textBlock(L, q.text, q.links, PAD + ip, qy + 6, qInner, 15, 21, th.text);
      if (q.media && q.media.length) qy = mediaBlock(L, q.media, PAD + ip, qy + 10, qInner, qInner, 12);
      const bottom = qy + ip;
      L.ops.push((ctx) => {
        ctx.strokeStyle = th.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(PAD + 0.5, top + 0.5, innerW - 1, bottom - top - 1, 16);
        ctx.stroke();
      });
      y = bottom;
    }

    const date = formatDate(model.createdAt);
    if (date) {
      const dy = y + 16;
      L.ops.push((ctx) => {
        ctx.textBaseline = 'middle';
        ctx.font = `400 15px ${FONT}`;
        ctx.fillStyle = th.muted;
        ctx.fillText(date, PAD, dy + 10);
      });
      y = dy + 20;
    }

    const c = model.counts || {};
    if ([c.replies, c.reposts, c.likes, c.views].some((n) => n > 0)) {
      const ly = y + 14;
      L.ops.push((ctx) => {
        ctx.fillStyle = th.border;
        ctx.fillRect(PAD, ly, innerW, 1);
      });
      y = countsLine(L, c, PAD, ly + 14);
    }

    y += PAD;
    const canvas = new OffscreenCanvas(W * SCALE, Math.ceil(y * SCALE));
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, y);
    for (const op of L.ops) op(ctx);
    for (const b of imgs.values()) b.close && b.close();
    return canvas.convertToBlob({ type: 'image/png' });
  }

  globalThis.TwsCard = { render, cleanText, avatarUrl };
})();
