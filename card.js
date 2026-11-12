// Draws a tweet (normalised model) onto a canvas and returns a PNG blob.
// No screenshots: the full text and every image are always included.
//
// model = {
//   id, user: { name, handle, avatar, verified }, createdAt, text, links: [displayUrl],
//   media: [{ type: 'photo'|'video'|'animated_gif', url, w, h }],
//   quote: model | null, counts: { replies, reposts, likes, views },
//   card: { url, large, title, domain, description, image: { url, w, h } } | null,   // link preview
//   article: { title, preview, cover: { url, w, h }, blocks: [...] | null } | null,  // X Article
//   url,                                                                        // tweet permalink
// }
// opts.cardLink: 'above' | 'below' — where the link preview's full URL goes.
(() => {
  'use strict';

  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", ' +
    '"Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const THEMES = {
    light: { bg: '#ffffff', text: '#0f1419', muted: '#536471', border: '#cfd9de', link: '#1d9bf0', fill: '#eff3f4' },
    dim: { bg: '#15202b', text: '#f7f9f9', muted: '#8b98a5', border: '#38444d', link: '#1d9bf0', fill: '#1e2732' },
    dark: { bg: '#000000', text: '#e7e9ea', muted: '#71767b', border: '#2f3336', link: '#1d9bf0', fill: '#16181c' },
  };
  const W = 600;      // card width (CSS px)
  const PAD = 24;
  // Output pixel density: 3x keeps text crisp when the image is zoomed or
  // shown large. A long article is a big PNG at this density (~7 MB).
  const SCALE = 3;
  const MAX_SIDE = 65535;      // Chrome's largest canvas side
  const MAX_AREA = 268435456;  // and largest canvas area
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
  // fontAt(i) gives the font at text index i (bold / italic runs); `cuts` are
  // the indexes where it changes.
  function wrap(ctx, text, maxW, ranges, fontAt, cuts) {
    const isLink = (i) => ranges.some(([a, b]) => i >= a && i < b);
    const lines = [];
    let offset = 0;
    for (const para of text.split('\n')) {
      let line = [];
      let x = 0;
      const push = (t, idx, font) => {
        const w = ctx.measureText(t).width;
        const blank = !t.trim();
        if (x + w > maxW && line.length && !NO_LINE_START.test(t)) {
          lines.push(line);
          line = [];
          x = 0;
          if (blank) return; // no leading space on wrapped lines
        }
        line.push({ t, x, link: isLink(offset + idx), font });
        x += w;
      };
      const runs = [0, para.length];
      for (const c of cuts || []) if (c > offset && c < offset + para.length) runs.push(c - offset);
      runs.sort((a, b) => a - b);
      for (let k = 0; k < runs.length - 1; k++) {
        const r0 = runs[k], r1 = runs[k + 1];
        if (r0 === r1) continue;
        const font = fontAt ? fontAt(offset + r0) : undefined;
        if (font) ctx.font = font;
        for (const s of wordSeg.segment(para.slice(r0, r1))) {
          if (CJK.test(s.segment) || ctx.measureText(s.segment).width > maxW) {
            for (const g of graphemeSeg.segment(s.segment)) push(g.segment, r0 + s.index + g.index, font);
          } else {
            push(s.segment, r0 + s.index, font);
          }
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
    return richBlock(L, text, { links, x, y, w: maxW, size, lineH, color });
  }

  // Wrapped text with optional bold / italic runs (o.styles: [{ o, l, s }]),
  // extra link ranges (o.ranges: [[start, end]]) and weight / monospace.
  function richBlock(L, text, o) {
    const styles = o.styles || [];
    const face = o.mono ? MONO : FONT;
    const fontOf = (bold, italic) => `${italic ? 'italic ' : ''}${bold ? 700 : (o.weight || 400)} ${o.size}px ${face}`;
    const fontAt = (i) => {
      let bold = false, italic = false;
      for (const s of styles) {
        if (i < s.o || i >= s.o + s.l) continue;
        if (/bold/i.test(s.s)) bold = true;
        if (/italic/i.test(s.s)) italic = true;
      }
      return fontOf(bold, italic);
    };
    const cuts = styles.flatMap((s) => [s.o, s.o + s.l]);
    const ranges = (o.ranges || []).concat(o.mono ? [] : linkRanges(text, o.links));
    L.m.font = fontOf(false, false);
    const lines = wrap(L.m, text, o.w, ranges, styles.length ? fontAt : null, cuts);
    const { x, y, lineH, color } = o;
    const base = fontOf(false, false);
    L.ops.push((ctx) => {
      ctx.textBaseline = 'middle';
      lines.forEach((line, i) => {
        const by = y + i * lineH + lineH / 2;
        for (const p of line) {
          ctx.font = p.font || base;
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

  // ---------- X Money ----------
  // A pay link (x.com/i/jf/cards/money/share?share_id=…). X shows it as a
  // "Pay @handle with X Money" box; its link preview is only X's generic one.
  const MONEY_URL = /https?:\/\/(?:x|twitter)\.com\/i\/jf\/cards\/money\/\S*/g;
  const X_LOGO = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';

  function moneyBlock(L, payee, x, y, w) {
    const th = L.th;
    const H = 84, R = 16;
    const titleFont = `700 17px ${FONT}`, subFont = `400 15px ${FONT}`, btnFont = `700 16px ${FONT}`;
    L.m.font = btnFont;
    const bw = L.m.measureText('Pay').width + 40, bh = 40;
    L.m.font = titleFont;
    const title = fit(L.m, `Pay @${payee}`, w - 32 - bw - 16);
    L.m.font = subFont;
    const withW = L.m.measureText('with ').width;
    L.ops.push((ctx) => {
      ctx.fillStyle = th.fill;
      ctx.beginPath(); ctx.roundRect(x, y, w, H, R); ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.font = titleFont; ctx.fillStyle = th.text;
      ctx.fillText(title, x + 16, y + 30);
      ctx.font = subFont; ctx.fillStyle = th.muted;
      ctx.fillText('with', x + 16, y + 56);
      const lx = x + 16 + withW, ls = 14;
      ctx.save(); ctx.translate(lx, y + 56 - ls / 2); ctx.scale(ls / 24, ls / 24);
      ctx.fillStyle = th.text; ctx.fill(new Path2D(X_LOGO)); ctx.restore();
      ctx.font = subFont; ctx.fillStyle = th.text;
      ctx.fillText('Money', lx + ls + 4, y + 56);
      const bx = x + w - 16 - bw, by = y + (H - bh) / 2;
      ctx.fillStyle = th.text;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh / 2); ctx.fill();
      ctx.font = btnFont; ctx.fillStyle = th.bg; ctx.textAlign = 'center';
      ctx.fillText('Pay', bx + bw / 2, by + bh / 2);
      ctx.textAlign = 'left';
    });
    return y + H;
  }

  // ---------- X Articles ----------
  const ARTICLE_URL = /https?:\/\/(?:x|twitter)\.com\/i\/article\/\d+\S*/g;

  // The whole article: cover, title, then every block of the body
  // (or the preview, if the body couldn't be loaded).
  function articleBlock(L, a, x, y, w) {
    const th = L.th;
    if (a.cover) y = mediaBlock(L, [{ type: 'photo', ...a.cover }], x, y, w, w * 1.2, 16) + 18;
    y = richBlock(L, a.title, { x, y, w, size: 26, lineH: 32, weight: 800, color: th.text, links: [] });

    const blocks = a.blocks || (a.preview ? [{ type: 'unstyled', text: a.preview.trimEnd() + '…' }] : []);
    const BODY = { size: 17, lineH: 26, color: th.text };
    let num = 0, prev = '';
    for (const b of blocks) {
      const ranges = (b.links || []).map((l) => [l.o, l.o + l.l]);
      const isList = /list-item$/.test(b.type);
      if (b.type !== 'ordered-list-item') num = 0;
      if (b.type === 'atomic') {
        y = atomicBlock(L, b, x, y, w);
      } else if (!b.text.trim()) {
        y += 6;
      } else if (/^header-/.test(b.type)) {
        const size = b.type === 'header-one' ? 24 : b.type === 'header-two' ? 21 : 18;
        y = richBlock(L, b.text, { x, y: y + 22, w, size, lineH: Math.round(size * 1.3), weight: 700,
          color: th.text, styles: b.styles, ranges });
      } else if (isList) {
        const indent = 26 + (b.depth || 0) * 22;
        const top = y + (/list-item$/.test(prev) ? 6 : 14);
        const marker = b.type === 'ordered-list-item' ? `${++num}.` : '•';
        L.ops.push((ctx) => {
          ctx.font = `400 ${BODY.size}px ${FONT}`;
          ctx.fillStyle = th.text;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'right';
          ctx.fillText(marker, x + indent - 8, top + BODY.lineH / 2);
          ctx.textAlign = 'left';
        });
        y = richBlock(L, b.text, { ...BODY, x: x + indent, y: top, w: w - indent, styles: b.styles, ranges });
      } else if (b.type === 'blockquote') {
        const top = y + 14;
        y = richBlock(L, b.text, { ...BODY, x: x + 16, y: top, w: w - 16, styles: b.styles, ranges });
        const bottom = y;
        L.ops.push((ctx) => { ctx.fillStyle = th.border; ctx.fillRect(x, top, 3, bottom - top); });
      } else if (b.type === 'code-block') {
        y = codeBlock(L, b.text, x, y + 14, w);
      } else {
        y = richBlock(L, b.text, { ...BODY, x, y: y + 14, w, styles: b.styles, ranges });
      }
      prev = b.type;
    }
    return y;
  }

  function atomicBlock(L, b, x, y, w) {
    const th = L.th;
    if (b.entity === 'MEDIA' && b.media && b.media.length) {
      y = mediaBlock(L, b.media.map((m) => ({ type: 'photo', ...m })), x, y + 18, w, w * 1.2, 12);
      if (b.caption) y = richBlock(L, b.caption, { x, y: y + 6, w, size: 14, lineH: 20, color: th.muted, links: [] });
      return y + 4;
    }
    if (b.entity === 'DIVIDER') {
      const ly = y + 18;
      L.ops.push((ctx) => { ctx.fillStyle = th.border; ctx.fillRect(x, ly, w, 1); });
      return ly + 4;
    }
    if (b.entity === 'MARKDOWN' && b.code) return codeBlock(L, b.code.replace(/^```\w*\n?|\n?```\s*$/g, ''), x, y + 14, w);
    if (b.entity === 'TWEET' && b.tweetId) {
      const url = `https://x.com/i/status/${b.tweetId}`;
      return richBlock(L, url, { x, y: y + 14, w, size: 17, lineH: 26, color: th.text, links: [url] });
    }
    return y;
  }

  function codeBlock(L, code, x, top, w) {
    const th = L.th;
    let h = 0;
    L.ops.push((ctx) => {
      ctx.fillStyle = th.fill;
      ctx.beginPath();
      ctx.roundRect(x, top, w, h, 8);
      ctx.fill();
    });
    const end = richBlock(L, code, { x: x + 12, y: top + 10, w: w - 24, size: 14, lineH: 20, mono: true, color: th.text });
    h = end + 10 - top;
    return top + h;
  }

  // The tweet's own link, in full (wrapped if it doesn't fit on one line).
  function footerBlock(L, model, x, y, w) {
    if (!model.url) return y;
    return textBlock(L, model.url, [model.url], x, y + 12, w, 14, 20, L.th.link);
  }

  // A quoted tweet in a bordered box. Like X, a quote can hold one more
  // quote (level 2), drawn a little smaller, with its full text.
  function quoteBlock(L, q, x, top, w, level) {
    const th = L.th, nested = level > 1;
    const ip = nested ? 12 : 14, inner = w - ip * 2;
    const size = nested ? 14 : 15, lineH = nested ? 20 : 21;
    let qy = userLine(L, q.user || {}, x + ip, top + ip, nested ? 20 : 22, size, true, inner);
    let qText = q.article ? (q.text || '').replace(ARTICLE_URL, '').trim() : q.text;
    if (qText) qText = qText.replace(MONEY_URL, '').trim();
    if (qText) qy = textBlock(L, qText, q.links, x + ip, qy + 6, inner, size, lineH, th.text);
    if (q.article) {
      // Quoted article: cover, title and preview, like X shows it.
      if (q.article.cover) qy = mediaBlock(L, [{ type: 'photo', ...q.article.cover }], x + ip, qy + 10, inner, inner * 0.6, 12);
      qy = richBlock(L, q.article.title, { x: x + ip, y: qy + 8, w: inner, size: size + 2, lineH: lineH + 2, weight: 700, color: th.text, links: [] });
      if (q.article.preview) qy = richBlock(L, q.article.preview.trimEnd() + '…', { x: x + ip, y: qy + 4, w: inner, size, lineH, color: th.muted, links: [] });
    }
    if (qText && q.translatedFrom) qy = translatedNote(L, q.translatedFrom, x + ip, qy + 2, 13);
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
      const a = t.article;
      if (a && a.cover) urls.add(a.cover.url);
      if (a && t === model) {
        for (const b of a.blocks || []) for (const m of b.media || []) urls.add(m.url);
      }
      collect(t.quote);
    };
    collect(model);
    return [...urls];
  }

  // Load every image first so the layout knows real aspect ratios.
  async function loadAll(urls, loadImage) {
    const imgs = new Map();
    await Promise.all(urls.map(async (u) => {
      try { const b = await loadImage(u); if (b) imgs.set(u, b); } catch (_) {}
    }));
    return imgs;
  }

  // A post's body below its author line: text, media, link preview, article
  // and quoted post. `gap` is the space above the first piece.
  function postBody(L, model, x, y, w, gap) {
    const th = L.th;
    const art = model.article;
    let text = model.text || '';
    if (art) text = text.replace(ARTICLE_URL, '').trim();
    // An X Money pay link: draw the Pay box instead of the link and its preview.
    const isMoney = (u) => !!u && new RegExp(MONEY_URL.source).test(u);
    const money = isMoney(model.card && model.card.url) || isMoney(text);
    if (money) text = text.replace(MONEY_URL, '').trim();
    const card = !art && !money && model.card && !(model.media && model.media.length) ? model.card : null;
    let cardUrlAbove = !!(card && card.url && L.cardLink === 'above');
    if (card && card.url) {
      const t = text.trimEnd();
      if (t.endsWith(card.url)) text = t.slice(0, -card.url.length).trimEnd();
      else if (text.includes(card.url)) cardUrlAbove = false;
    }
    L.cardUrlShown = cardUrlAbove || !!(card && card.url && text.includes(card.url));

    const start = y;
    const sp = (n) => (y === start && !gap ? 0 : n); // gap 0: nothing above the first piece
    if (text) y = textBlock(L, text, model.links, x, y + gap, w, 18, 26, th.text);
    if (text && model.translatedFrom) y = translatedNote(L, model.translatedFrom, x, y + 4, 14);
    if (model.media && model.media.length) y = mediaBlock(L, model.media, x, y + sp(14), w, w * 1.2, 16);
    if (card) {
      if (cardUrlAbove) y = textBlock(L, card.url, [card.url], x, y + (text ? 6 : gap), w, 18, 26, th.text);
      y = linkCardBlock(L, card, x, y + sp(14), w);
    }
    if (money) y = moneyBlock(L, model.moneyPayee || (model.user && model.user.handle) || '', x, y + sp(14), w);
    if (art) y = articleBlock(L, art, x, y + (text ? 18 : gap + 4), w);
    if (model.quote) y = quoteBlock(L, model.quote, x, y + sp(14), w, 1);
    return y;
  }

  // Draw the laid-out ops onto a canvas of height y and return the PNG.
  function paint(L, y, imgs) {
    // A very long card can be taller than a canvas may be, so lower the
    // density for those instead of failing.
    const scale = Math.min(SCALE, MAX_SIDE / y, Math.sqrt(MAX_AREA / (W * y)));
    const canvas = new OffscreenCanvas(Math.round(W * scale), Math.floor(y * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = L.th.bg;
    ctx.fillRect(0, 0, W, y);
    for (const op of L.ops) op(ctx);
    for (const b of imgs.values()) b.close && b.close();
    return canvas.convertToBlob({ type: 'image/png' });
  }

  // A whole thread as one card: the author once at the top, then every post
  // in order on a line that joins them, then the first post's link.
  async function renderThread(posts, { theme = 'light', loadImage, cardLink = 'above' }) {
    const th = THEMES[theme] || THEMES.light;
    const first = posts[0];
    const urls = new Set();
    for (const p of posts) for (const u of imageUrls(p)) urls.add(u);
    const imgs = await loadAll([...urls], loadImage);
    const L = { m: new OffscreenCanvas(1, 1).getContext('2d'), ops: [], th, imgs, cardLink };
    const innerW = W - PAD * 2;

    let y = userLine(L, first.user || {}, PAD, PAD, 48, 17, false, innerW, formatDate(first.createdAt));
    // Thread line: a dot per post in a narrow gutter under the avatar's centre.
    const GUT = 24, lineX = PAD + 5, bx = PAD + GUT, bw = innerW - GUT;
    const dots = [];
    y += 6;
    posts.forEach((p, i) => {
      const top = y + (i ? 22 : 12);
      dots.push(top + 13);
      y = postBody(L, p, bx, top, bw, 0);
      if (y === top) y += 26; // a post with nothing we can draw still gets its dot
    });
    const firstDot = dots[0], lastDot = dots[dots.length - 1];
    L.ops.unshift((ctx) => {
      ctx.fillStyle = th.border;
      ctx.fillRect(lineX - 1, firstDot, 2, lastDot - firstDot);
    });
    L.ops.push((ctx) => {
      for (const d of dots) {
        ctx.fillStyle = th.bg;
        ctx.beginPath(); ctx.arc(lineX, d, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = th.muted;
        ctx.beginPath(); ctx.arc(lineX, d, 4, 0, Math.PI * 2); ctx.fill();
      }
    });

    y = footerBlock(L, first, PAD, y + 6, innerW);
    const n = posts.length;
    L.ops.push(((fy) => (ctx) => {
      ctx.font = `400 14px ${FONT}`; ctx.fillStyle = th.muted; ctx.textBaseline = 'middle';
      ctx.fillText(`Thread · ${n} posts`, PAD, fy + 10);
    })(y + 4));
    y += 24 + PAD;
    return paint(L, y, imgs);
  }

  async function render(model, { theme = 'light', loadImage, cardLink = 'above' }) {
    const th = THEMES[theme] || THEMES.light;
    const imgs = await loadAll(imageUrls(model), loadImage);

    const L = { m: new OffscreenCanvas(1, 1).getContext('2d'), ops: [], th, imgs, cardLink };
    const innerW = W - PAD * 2;
    let y = PAD;

    y = userLine(L, model.user || {}, PAD, y, 48, 17, false, innerW, formatDate(model.createdAt));
    y = postBody(L, model, PAD, y, innerW, 12);

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
    return paint(L, y, imgs);
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

  globalThis.TwsCard = { render, renderThread, imageUrls, cleanText, avatarUrl, cardOf };
})();
