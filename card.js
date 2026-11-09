// Draws a tweet (normalised model) onto a canvas and returns a PNG blob.
// No screenshots: the full text and every image are always included.
//
// model = {
//   id, user: { name, handle, avatar, verified }, createdAt, text, links: [displayUrl],
//   media: [{ type: 'photo'|'video'|'animated_gif', url, w, h }],
//   quote: model | null, counts: { replies, reposts, likes, views },
//   card: { url, large, title, domain, description, image: { url, w, h } } | null,   // link preview
//   url,                                                                        // tweet permalink
// }
// opts.cardLink: 'above' | 'below' — where the link preview's full URL goes.
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

  function textBlock(L, text, links, x, y, maxW, size, lineH, color, maxLines = Infinity) {
    const font = `400 ${size}px ${FONT}`;
    L.m.font = font;
    let lines = wrap(L.m, text, maxW, linkRanges(text, links));
    if (lines.length > maxLines) {
      // Cut like X does: keep the first lines and end the last one with "…".
      lines = lines.slice(0, maxLines);
      const last = lines[maxLines - 1].slice();
      const ell = L.m.measureText('…').width;
      const end = () => (last.length ? last[last.length - 1].x + L.m.measureText(last[last.length - 1].t).width : 0);
      while (last.length && (end() + ell > maxW || !last[last.length - 1].t.trim())) last.pop();
      last.push({ t: '…', x: end(), link: false });
      lines[maxLines - 1] = last;
    }
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

  function userLine(L, user, x, y, avSize, nameSize, inlineHandle, maxW, date) {
    const th = L.th;
    const dateFont = `400 15px ${FONT}`;
    L.m.font = dateFont;
    const dateW = date ? L.m.measureText(date).width + 12 : 0;
    const av = L.imgs.get(avatarUrl(user.avatar));
    L.ops.push((ctx) => drawAvatar(ctx, av, x, y, avSize, th));
    const nx = x + avSize + (inlineHandle ? 8 : 12);
    const nameFont = `700 ${nameSize}px ${FONT}`;
    const handleFont = `400 ${nameSize - (inlineHandle ? 0 : 2)}px ${FONT}`;
    const badgeR = nameSize * 0.5;
    const avail = x + maxW - nx - dateW;

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
      if (date) {
        ctx.font = dateFont;
        ctx.fillStyle = th.muted;
        ctx.textAlign = 'right';
        ctx.fillText(date, x + maxW, nameY);
        ctx.textAlign = 'left';
      }
    });
    return y + avSize;
  }

  // Outline icons (Lucide, ISC licence) on a 24px grid.
  const COUNT_ICONS = {
    replies: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
    reposts: ['m2 9 3-3 3 3', 'M13 18H7a2 2 0 0 1-2-2V6', 'm22 15-3 3-3-3', 'M11 6h6a2 2 0 0 1 2 2v10'],
    likes: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'],
    views: ['M4 21v-6', 'M9.33 21V9', 'M14.67 21V3', 'M20 21v-9'],
  };

  // Reply / repost / like / view icons with numbers, spread across the width like X.
  function countsLine(L, counts, x, y, w) {
    const th = L.th;
    const keys = ['replies', 'reposts', 'likes', 'views'];
    const font = `400 14px ${FONT}`;
    const ICON = 18;
    const cy = y + 10;
    L.ops.push((ctx) => {
      keys.forEach((k, i) => {
        const ix = x + (w / keys.length) * i;
        ctx.save();
        ctx.translate(ix, cy - ICON / 2);
        ctx.scale(ICON / 24, ICON / 24);
        ctx.strokeStyle = th.muted;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const d of COUNT_ICONS[k]) ctx.stroke(new Path2D(d));
        ctx.restore();
        const n = counts[k];
        if (typeof n === 'number' && n > 0) {
          ctx.font = font;
          ctx.fillStyle = th.muted;
          ctx.textBaseline = 'middle';
          ctx.fillText(compact.format(n), ix + ICON + 6, cy);
        }
      });
    });
    return y + 20;
  }


  function translatedNote(L, lang, x, y, size) {
    let name = lang;
    try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang; } catch (_) {}
    const th = L.th;
    const font = `400 ${size}px ${FONT}`;
    L.ops.push((ctx) => {
      ctx.font = font; ctx.fillStyle = th.muted; ctx.textBaseline = 'middle';
      ctx.fillText(`Translated from ${name}`, x, y + size * 0.7);
    });
    return y + size * 1.4;
  }

  // Link preview ("summary_large_image" / "summary" cards).
  function linkCardBlock(L, card, x, y, w) {
    const th = L.th;
    const bmp = card.image && L.imgs.get(card.image.url);
    const R = 16;
    if (card.large && (bmp || card.image)) {
      const ar = bmp ? bmp.width / bmp.height : (card.image.w && card.image.h ? card.image.w / card.image.h : 1.91);
      const h = Math.min(w / ar, w * 1.2);
      const capFont = `400 15px ${FONT}`;
      L.m.font = capFont;
      const title = card.title ? fit(L.m, card.title, w - 48) : '';
      const tw = title ? L.m.measureText(title).width : 0;
      const top = y;
      L.ops.push((ctx) => {
        drawMedia(ctx, { m: { type: 'photo' }, bmp }, x, top, w, h, R, th);
        if (!title) return;
        const ph = 28, px = x + 12, py = top + h - 12 - ph;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.77)';
        ctx.beginPath();
        ctx.roundRect(px, py, tw + 20, ph, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = capFont;
        ctx.textBaseline = 'middle';
        ctx.fillText(title, px + 10, py + ph / 2);
      });
      y += h;
      if (card.url && L.cardLink === 'below') {
        return textBlock(L, card.url, [card.url], x, y + 4, w, 14, 20, th.muted);
      }
      if (card.domain && !L.cardUrlShown) {
        const dy = y + 4;
        L.ops.push((ctx) => {
          ctx.font = `400 14px ${FONT}`;
          ctx.fillStyle = th.muted;
          ctx.textBaseline = 'middle';
          ctx.fillText(`From ${card.domain}`, x, dy + 10);
        });
        y = dy + 20;
      }
      return y;
    }

    // Small card: thumbnail on the left, text on the right.
    const H = 120, tx = x + (bmp ? H + 14 : 14), tw = x + w - 14 - tx;
    const lines = [];
    const add = (text, font, color, max) => {
      if (!text) return;
      L.m.font = font;
      const wrapped = wrap(L.m, text, tw, []).slice(0, max)
        .map((l) => l.map((p) => p.t).join(''));
      for (const l of wrapped) lines.push({ t: fit(L.m, l, tw), font, color });
    };
    add(card.domain, `400 14px ${FONT}`, th.muted, 1);
    add(card.title, `400 15px ${FONT}`, th.text, 2);
    add(card.description, `400 14px ${FONT}`, th.muted, 2);
    const textTop = y + (H - lines.length * 20) / 2;
    L.ops.push((ctx) => {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, H, R);
      ctx.clip();
      if (bmp) {
        const s = Math.max(H / bmp.width, H / bmp.height); // cover-crop the square thumbnail
        const sw = H / s, sh = H / s;
        ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, x, y, H, H);
        ctx.fillStyle = th.border;
        ctx.fillRect(x + H, y, 1, H);
      }
      ctx.restore();
      ctx.strokeStyle = th.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, w - 1, H - 1, R);
      ctx.stroke();
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => {
        ctx.font = l.font;
        ctx.fillStyle = l.color;
        ctx.fillText(l.t, tx, textTop + i * 20 + 10);
      });
    });
    return y + H;
  }

  // The tweet's own link, in full (wrapped if it doesn't fit on one line).
  function footerBlock(L, model, x, y, w) {
    if (!model.url) return y;
    return textBlock(L, model.url, [model.url], x, y + 12, w, 14, 20, L.th.link);
  }

  // A quoted tweet in a bordered box. Like X, a quote can hold one more
  // quote (level 2), drawn smaller with its text cut to a few lines.
  function quoteBlock(L, q, x, top, w, level) {
    const th = L.th, nested = level > 1;
    const ip = nested ? 12 : 14, inner = w - ip * 2;
    const size = nested ? 14 : 15, lineH = nested ? 20 : 21;
    let qy = userLine(L, q.user || {}, x + ip, top + ip, nested ? 20 : 22, size, true, inner);
    if (q.text) qy = textBlock(L, q.text, q.links, x + ip, qy + 6, inner, size, lineH, th.text, nested ? 4 : Infinity);
    if (q.text && q.translatedFrom) qy = translatedNote(L, q.translatedFrom, x + ip, qy + 2, 13);
    if (q.media && q.media.length) qy = mediaBlock(L, q.media, x + ip, qy + 10, inner, nested ? inner * 0.6 : inner, nested ? 10 : 12);
    if (q.quote && level < 2) qy = quoteBlock(L, q.quote, x + ip, qy + 10, inner, level + 1);
    const bottom = qy + ip;
    L.ops.push((ctx) => {
      ctx.strokeStyle = th.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, top + 0.5, w - 1, bottom - top - 1, nested ? 12 : 16);
      ctx.stroke();
    });
    return bottom;
  }

  // Every image the card draws (also used to prefetch them).
  function imageUrls(model) {
    const urls = new Set();
    const collect = (t) => {
      if (!t) return;
      if (t.user && t.user.avatar) urls.add(avatarUrl(t.user.avatar));
      for (const m of t.media || []) if (m.url) urls.add(m.url);
      if (t.card && t.card.image && t.card.image.url) urls.add(t.card.image.url);
      collect(t.quote);
    };
    collect(model);
    return [...urls];
  }

  async function render(model, { theme = 'light', loadImage, cardLink = 'above' }) {
    const th = THEMES[theme] || THEMES.light;

    // Load every image first so the layout knows real aspect ratios.
    const imgs = new Map();
    await Promise.all(imageUrls(model).map(async (u) => {
      try { const b = await loadImage(u); if (b) imgs.set(u, b); } catch (_) {}
    }));

    const L = { m: new OffscreenCanvas(1, 1).getContext('2d'), ops: [], th, imgs, cardLink };
    const innerW = W - PAD * 2;
    let y = PAD;

    let text = model.text || '';
    const card = model.card && !(model.media && model.media.length) ? model.card : null;
    let cardUrlAbove = !!(card && card.url && cardLink === 'above');
    if (card && card.url) {
      const t = text.trimEnd();
      if (t.endsWith(card.url)) text = t.slice(0, -card.url.length).trimEnd();
      else if (text.includes(card.url)) cardUrlAbove = false;
    }
    L.cardUrlShown = cardUrlAbove || !!(card && card.url && text.includes(card.url));

    y = userLine(L, model.user || {}, PAD, y, 48, 17, false, innerW, formatDate(model.createdAt));
    if (text) y = textBlock(L, text, model.links, PAD, y + 12, innerW, 18, 26, th.text);
    if (text && model.translatedFrom) y = translatedNote(L, model.translatedFrom, PAD, y + 4, 14);
    if (model.media && model.media.length) y = mediaBlock(L, model.media, PAD, y + 14, innerW, innerW * 1.2, 16);
    if (card) {
      if (cardUrlAbove) y = textBlock(L, card.url, [card.url], PAD, y + (text ? 6 : 12), innerW, 18, 26, th.text);
      y = linkCardBlock(L, card, PAD, y + 14, innerW);
    }

    if (model.quote) y = quoteBlock(L, model.quote, PAD, y + 14, innerW, 1);

    y = footerBlock(L, model, PAD, y, innerW);

    const c = model.counts || {};
    if ([c.replies, c.reposts, c.likes, c.views].some((n) => n > 0)) {
      const ly = y + 14;
      L.ops.push((ctx) => {
        ctx.fillStyle = th.border;
        ctx.fillRect(PAD, ly, innerW, 1);
      });
      y = countsLine(L, c, PAD, ly + 14, innerW);
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

  // X link-preview card -> { url, large, title, domain, description, image }.
  // `raw` is { name, url, binding_values } where binding_values is either an
  // array of { key, value } (web API) or an object (embed API).
  function cardOf(raw, urls) {
    if (!raw || !raw.binding_values || /poll|unified|audiospace|broadcast/.test(raw.name || '')) return null;
    const bv = Array.isArray(raw.binding_values)
      ? Object.fromEntries(raw.binding_values.map((b) => [b.key, b.value]))
      : raw.binding_values;
    const str = (k) => (bv[k] && bv[k].string_value) || '';
    const img = ['photo_image_full_size_original', 'summary_photo_image_original', 'player_image_original',
      'thumbnail_image_original', 'photo_image_full_size', 'summary_photo_image', 'thumbnail_image']
      .map((k) => bv[k] && bv[k].image_value).find(Boolean);
    const title = str('title');
    if (!title && !img) return null;
    const short = raw.url || str('card_url');
    const hit = (urls || []).find((u) => u && u.url === short);
    const full = (hit && hit.expanded_url) || (/^https?:\/\/t\.co\//.test(short) ? '' : short);
    return {
      url: full,
      large: /large|player/.test(raw.name || '') || !!bv.photo_image_full_size_original,
      title,
      domain: str('domain') || str('vanity_url'),
      description: str('description'),
      image: img ? { url: img.url, w: img.width, h: img.height } : null,
    };
  }

  globalThis.TwsCard = { render, imageUrls, cleanText, avatarUrl, cardOf };
})();
