// Landing page demos. Every account, post and photo is made up; photos are
// drawn on a canvas, and the share cards are drawn by the extension's own card.js.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

  // ---------- action rows ----------
  const ICON = {
    reply: '<path d="M4 12a8 8 0 0 1 8-8h1a7 7 0 0 1 0 14H9l-4 3v-4.5A8 8 0 0 1 4 12z"/>',
    repost: '<path d="M7 7h11l-3-3M17 17H6l3 3"/><path d="M18 7v5M6 17v-5"/>',
    like: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    views: '<path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/>',
  };
  $$('[data-actions]').forEach((el) => {
    const n = el.dataset.actions.split(',');
    el.innerHTML = ['reply', 'repost', 'like', 'views'].map((k, i) => `<span><svg class="i" viewBox="0 0 24 24">${ICON[k]}</svg>${n[i]}</span>`).join('');
  });

  // ---------- canvas pictures ----------
  function avatar(c, color, letter, size = 120) {
    c.width = c.height = size;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, color); g.addColorStop(1, '#0f1419');
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    x.fillStyle = '#fff'; x.font = `700 ${size * 0.5}px -apple-system, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(letter, size / 2, size / 2 + size * 0.03);
    return c;
  }
  function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
  function ridge(c) {
    const x = c.getContext('2d'), w = c.width, h = c.height, r = rng(7);
    const sky = x.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2b3a67'); sky.addColorStop(0.45, '#f08a5d'); sky.addColorStop(0.7, '#ffd479'); sky.addColorStop(1, '#ffe9b0');
    x.fillStyle = sky; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,240,200,.95)'; x.beginPath(); x.arc(w * 0.62, h * 0.6, h * 0.09, 0, 7); x.fill();
    ['#6b4f7a', '#4a3a63', '#33294b', '#1f1a33'].forEach((col, i) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, h);
      let y = h * (0.5 + i * 0.1);
      for (let px = 0; px <= w; px += w / 14) { y += (r() - 0.5) * h * 0.14; y = Math.min(h * 0.95, Math.max(h * 0.35 + i * h * 0.08, y)); x.lineTo(px, y); }
      x.lineTo(w, h); x.fill();
    });
  }
  function kitchen(c) {
    const x = c.getContext('2d'), w = c.width, h = c.height;
    const bg = x.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#d6b48c'); bg.addColorStop(1, '#8a6240');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) { x.strokeStyle = `rgba(90,60,30,${0.08 + (i % 3) * 0.04})`; x.lineWidth = 6; x.beginPath(); x.moveTo(0, i * 40 + 10); x.bezierCurveTo(w * .3, i * 40 - 20, w * .7, i * 40 + 40, w, i * 40); x.stroke(); }
    x.save(); x.translate(w * 0.5, h * 0.55); x.rotate(-0.08);
    x.fillStyle = '#f7ead2'; x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 30; x.shadowOffsetY = 12;
    x.beginPath(); x.roundRect(-w * 0.3, -h * 0.22, w * 0.6, h * 0.44, 40); x.fill(); x.shadowColor = 'transparent';
    for (let i = 0; i < 7; i++) { x.strokeStyle = 'rgba(200,160,100,.45)'; x.lineWidth = 3; x.beginPath(); x.moveTo(-w * 0.28, -h * 0.18 + i * h * 0.06); x.lineTo(w * 0.28, -h * 0.18 + i * h * 0.06); x.stroke(); }
    x.fillStyle = '#f2d08a'; x.beginPath(); x.roundRect(-w * 0.12, -h * 0.07, w * 0.24, h * 0.14, 14); x.fill();
    x.restore();
    x.fillStyle = '#c9c2b6'; x.save(); x.translate(w * 0.82, h * 0.25); x.rotate(0.5); x.beginPath(); x.roundRect(-20, -150, 40, 300, 20); x.fill(); x.restore();
  }
  function harbor(c) {
    const x = c.getContext('2d'), w = c.width, h = c.height, r = rng(3);
    const sky = x.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, '#7cc4f2'); sky.addColorStop(1, '#d9f0ff');
    x.fillStyle = sky; x.fillRect(0, 0, w, h);
    const sea = x.createLinearGradient(0, h * 0.6, 0, h);
    sea.addColorStop(0, '#2e86c1'); sea.addColorStop(1, '#154f7a');
    x.fillStyle = sea; x.fillRect(0, h * 0.6, w, h * 0.4);
    const cols = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#f1faee', '#e63946', '#a8dadc'];
    let px = 0;
    while (px < w) {
      const bw = 60 + r() * 70, bh = h * (0.18 + r() * 0.2);
      x.fillStyle = cols[Math.floor(r() * cols.length)]; x.fillRect(px, h * 0.6 - bh, bw, bh);
      x.fillStyle = 'rgba(255,255,255,.7)';
      for (let wy = h * 0.6 - bh + 16; wy < h * 0.6 - 20; wy += 30) for (let wx = px + 10; wx < px + bw - 14; wx += 24) x.fillRect(wx, wy, 10, 14);
      x.fillStyle = '#5b4636'; x.beginPath(); x.moveTo(px - 4, h * 0.6 - bh); x.lineTo(px + bw / 2, h * 0.6 - bh - 36); x.lineTo(px + bw + 4, h * 0.6 - bh); x.fill();
      px += bw + 2;
    }
    for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(r() * w, h * 0.62 + r() * h * 0.36, 30 + r() * 60, 3); }
  }
  const PICS = { ridge, kitchen, harbor };
  $$('canvas[data-photo]').forEach((c) => PICS[c.dataset.photo](c));
  $$('canvas[data-av]').forEach((c) => { const [col, l] = c.dataset.av.split(':'); avatar(c, col, l); });

  // ---------- share cards, drawn by card.js ----------
  const AV = { harbor: ['#1d9bf0', 'H'], pier: ['#e76f51', 'P'], trails: ['#f59e0b', 'N'], lumen: ['#6366f1', 'L'] };
  const PIC = { harbor: [1200, 800], ridge: [1200, 800], kitchen: [1136, 1420] };
  async function loadImage(url) {
    const m = /#(av|pic)-(\w+)/.exec(url);
    if (!m) return null;
    if (m[1] === 'av') { const [c, l] = AV[m[2]]; return createImageBitmap(avatar(document.createElement('canvas'), c, l, 200)); }
    const [w, h] = PIC[m[2]];
    const c = document.createElement('canvas'); c.width = w; c.height = h; PICS[m[2]](c);
    return createImageBitmap(c);
  }
  const photo = (k) => ({ type: 'photo', url: 'https://example.invalid/#pic-' + k, w: PIC[k][0], h: PIC[k][1] });
  const URL_A = 'https://harborlight.co/journal/2026/north-quay-houses-before-the-renovation';
  const CARDS = {
    a: {
      id: '1855201934477051392', url: 'https://x.com/harborlightco/status/1855201934477051392',
      user: { name: 'Harbor Light Co.', handle: 'harborlightco', avatar: 'https://example.invalid/#av-harbor', verified: true },
      createdAt: '2026-11-08T09:41:00Z',
      text: `New on the journal: ${URL_A}\n\nWe spent six months in the town archive tracing every house on the north quay: who built it, who painted it which colour, and what the renovation in December will change. Thank you to everyone who lent us old photos — there are more than 200 in the piece.`,
      links: [URL_A], media: [],
      quote: {
        id: '2', user: { name: 'Pier Archive', handle: 'pierarchive', avatar: 'https://example.invalid/#av-pier' },
        createdAt: '2026-11-07T18:20:00Z', text: 'Renovation of the north quay begins on 1 December. Here is what is planned, street by street.',
        links: [], media: [photo('harbor')],
      },
      counts: { replies: 214, reposts: 1840, likes: 12600, views: 482000 },
    },
    b: {
      id: '1855377012984', url: 'https://x.com/northwindtrails/status/1855377012984',
      user: { name: 'Northwind Trails', handle: 'northwindtrails', avatar: 'https://example.invalid/#av-trails' },
      createdAt: '2026-11-09T06:12:00Z',
      text: 'Ridge at sunrise, and the reward waiting back at the hut. Both photos exactly as shot, nothing cropped.',
      links: [], media: [photo('ridge'), photo('kitchen')],
      quote: {
        id: '3', user: { name: 'Lumen Notes', handle: 'lumennotes', avatar: 'https://example.invalid/#av-lumen' },
        createdAt: '2026-11-08T20:02:00Z', text: 'Best breakfast you have ever had after a hike? Photos welcome.', links: [], media: [],
      },
      counts: { replies: 48, reposts: 212, likes: 1900, views: 64000 },
    },
  };
  const ready = {};
  for (const [k, model] of Object.entries(CARDS)) {
    ready[k] = (async () => {
      try {
        const blob = await TwsCard.render(model, { theme: dark() ? 'dark' : 'light', loadImage });
        const src = URL.createObjectURL(blob);
        await Promise.all($$(`img[data-card="${k}"]`).map((img) => { img.src = src; return img.decode().catch(() => {}); }));
      } catch (e) { console.error('card', k, e); }
    })();
  }

  // ---------- animation helpers ----------
  // Each demo runs only while it is on screen.
  function runner(root, script, final) {
    if (!root) return;
    if (reduced) { final(); return; }
    let visible = false, wake = null;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && wake) { wake(); wake = null; } }, { threshold: 0.25 }).observe(root);
    const wait = async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      while (!visible) await new Promise((r) => (wake = r));
    };
    const stage = $('.stagebox', root) || root;
    const cur = $('[data-cursor]', root);
    const at = (el, fx = 0.5, fy = 0.5) => {
      const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
      return [r.left - s.left + r.width * fx, r.top - s.top + r.height * fy];
    };
    const move = async (el, fx, fy, ms = 800) => {
      const [x, y] = Array.isArray(el) ? el : at(el, fx, fy);
      cur.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
      await wait(ms);
    };
    const jump = (x, y) => { cur.style.transition = 'none'; cur.style.transform = `translate(${x}px, ${y}px)`; cur.offsetWidth; cur.style.transition = ''; };
    const click = async () => { cur.classList.add('press'); await wait(140); cur.classList.remove('press'); await wait(120); };
    const tipAt = (tip, el, side) => {
      const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
      let x = side === 'left' ? r.left - s.left - t.width - 8 : r.left - s.left + r.width / 2 - t.width / 2;
      let y = side === 'left' ? r.top - s.top + r.height / 2 - t.height / 2 : r.top - s.top - t.height - 8;
      x = Math.max(4, Math.min(x, s.width - t.width - 4));
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    };
    const api = { wait, move, jump, click, tipAt, stage };
    (async () => { for (;;) await script(api); })();
  }

  // ---------- hero: share a post ----------
  {
    const root = $('#demo-share');
    const post = $('[data-hover-target]', root), ic = $('[data-share]', root), out = $('[data-out]', root), tip = $('[data-tip]', root);
    const final = () => { post.classList.add('hovered'); out.classList.add('on'); };
    ready.a.then(() => runner(root, async ({ wait, move, jump, click, tipAt, stage }) => {
      post.classList.remove('hovered'); ic.className = 'share-ic'; out.classList.remove('on'); tip.classList.remove('on');
      jump(stage.clientWidth * 0.48, stage.clientHeight + 30);
      await wait(700);
      await move(post, 0.45, 0.35, 850);
      post.classList.add('hovered');
      await wait(500);
      await move(ic, 0.5, 0.55, 750);
      ic.classList.add('hot'); tipAt(tip, ic); tip.classList.add('on');
      await wait(700);
      await click();
      tip.classList.remove('on'); ic.classList.remove('hot'); ic.classList.add('ok');
      await wait(250);
      out.classList.add('on');
      await wait(4500);
      await move([stage.clientWidth * 0.48, stage.clientHeight + 30], 0, 0, 700);
      post.classList.remove('hovered');
      await wait(400);
    }, final));
  }

  // ---------- hover to show ----------
  {
    const root = $('#demo-hover');
    const pm = $('[data-photo-media]', root), vm = $('[data-video-media]', root);
    const pb = $('[data-btn]', pm), vb = $('[data-btn]', vm), tip = $('[data-tip]', root), chip = $('[data-chip]', root);
    const pIcon = pb.innerHTML;
    const reset = () => {
      [pm, vm].forEach((m) => m.classList.remove('hovered'));
      [pb, vb].forEach((b) => b.classList.remove('hot', 'ok'));
      pb.innerHTML = pIcon; tip.classList.remove('on'); chip.classList.remove('on');
    };
    const final = () => { pm.classList.add('hovered'); vm.classList.add('hovered'); };
    runner(root, async ({ wait, move, jump, click, tipAt, stage }) => {
      reset();
      const outside = [stage.clientWidth + 30, stage.clientHeight * 0.3];
      jump(...outside);
      await wait(900);
      await move(pm, 0.35, 0.55, 900);
      pm.classList.add('hovered');
      await wait(600);
      await move(pb, 0.5, 0.55, 650);
      pb.classList.add('hot');
      await wait(300);
      await click();
      pb.classList.remove('hot'); pb.classList.add('ok'); pb.innerHTML = '<svg><use href="#i-check"/></svg>';
      tipAt(tip, pb, 'left'); tip.classList.add('on');
      await wait(1400);
      tip.classList.remove('on');
      await move(vm, 0.3, 0.75, 450);
      pm.classList.remove('hovered');
      await wait(400);
      vm.classList.add('hovered');
      await wait(500);
      await move(vb, 0.5, 0.55, 750);
      vb.classList.add('hot');
      await wait(300);
      await click();
      vb.classList.remove('hot'); vb.classList.add('ok');
      await wait(300);
      chip.classList.add('on');
      await wait(1500);
      await move([stage.clientWidth + 30, stage.clientHeight * 0.6], 0, 0, 800);
      vm.classList.remove('hovered');
      await wait(1400);
      chip.classList.remove('on');
      pb.innerHTML = pIcon;
      await wait(500);
    }, final);
  }

  // ---------- expand "Show more" ----------
  {
    const root = $('#demo-expand');
    const txt = $('[data-ex]', root), more = $('[data-more]', root);
    const lineH = 20, shortH = lineH * 4;
    const full = () => txt.scrollHeight;
    const collapse = (animate) => {
      if (!animate) txt.style.transition = 'none';
      txt.style.maxHeight = shortH + 'px';
      txt.offsetWidth; txt.style.transition = '';
    };
    const final = () => { txt.style.maxHeight = 'none'; more.classList.add('gone'); more.style.display = 'none'; };
    // Reserve the expanded height so the page below doesn't jump on each loop.
    const reserve = () => {
      const keep = txt.style.maxHeight, shown = more.style.display;
      root.style.minHeight = ''; txt.style.transition = 'none'; txt.style.maxHeight = 'none'; more.style.display = 'none';
      root.style.minHeight = root.offsetHeight + 'px';
      txt.style.maxHeight = keep; more.style.display = shown; txt.offsetWidth; txt.style.transition = '';
    };
    if (!reduced) { reserve(); addEventListener('resize', reserve); }
    runner(root, async ({ wait }) => {
      root.style.opacity = '0';
      collapse(false); more.style.display = ''; more.classList.remove('gone', 'flash');
      await wait(50);
      root.style.transition = 'opacity .4s'; root.style.opacity = '1';
      await wait(1300);
      more.classList.add('flash');
      await wait(450);
      more.classList.add('gone');
      txt.style.maxHeight = full() + 'px';
      await wait(500);
      more.style.display = 'none';
      await wait(3200);
      root.style.opacity = '0';
      await wait(450);
    }, final);
  }
})();
