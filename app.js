/* 园林史 · 地图复习
   地图为主角：46 站落在真实经纬度，点站点看内容，按顺序一站点一站点过。
*/
(() => {
'use strict';

const DATA = window.APP_DATA;
const STOPS = DATA.stops;
const ERAS = DATA.eras;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtYear = y => y < 0 ? `前 ${-y}` : `${y}`;
const eraOf = k => ERAS.find(e => e.k === k) || {};
const isCn = s => s.id.startsWith('c');

/* ---------- 进度 ---------- */
const LS = 'garden-map-v1';
let seen = new Set();
try { seen = new Set(JSON.parse(localStorage.getItem(LS) || '[]')); } catch (_) {}
const saveSeen = () => localStorage.setItem(LS, JSON.stringify([...seen]));

/* ---------- 画布 ---------- */
const cvs = $('#map'), fxc = $('#fx');
const ctx = cvs.getContext('2d'), fx = fxc.getContext('2d');
const pinsHost = $('#pins');

const VIEW = { lon0: -20, lon1: 150, lat0: -14, lat1: 68 };
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const M0 = mercY(VIEW.lat0), M1 = mercY(VIEW.lat1);

let W = 0, H = 0;
const DPR = Math.min(devicePixelRatio || 1, 2.5);
const view = { k: 1, tx: 0, ty: 0 };
let GEO = null;

function projRaw(lon, lat) {
  const x = (lon - VIEW.lon0) / (VIEW.lon1 - VIEW.lon0) * W;
  const my = mercY(Math.max(-84, Math.min(84, lat)));
  const y = (M1 - my) / (M1 - M0) * H;
  return [x, y];
}
function proj(lon, lat) {
  const [x, y] = projRaw(lon, lat);
  return [x * view.k + view.tx, y * view.k + view.ty];
}

function resize() {
  W = innerWidth; H = innerHeight;
  for (const c of [cvs, fxc]) {
    c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    c.style.width = W + 'px'; c.style.height = H + 'px';
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fx.setTransform(DPR, 0, 0, DPR, 0, 0);
  draw();
  placePins();
}

/* ---------- 画地图 ---------- */
function draw() {
  ctx.clearRect(0, 0, W, H);

  // 海
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0a09');
  bg.addColorStop(.5, '#0e0c0a');
  bg.addColorStop(1, '#0a0908');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  if (GEO) {
    const p = new Path2D();
    for (const f of GEO.features) {
      const g = f.geometry;
      if (g.type !== 'MultiPolygon') continue;
      for (const poly of g.coordinates) {
        for (const ring of poly) {
          if (ring.length < 3) continue;
          let st = false;
          for (const pt of ring) {
            const [x, y] = proj(pt[0], pt[1]);
            if (x < -W * .3 || x > W * 1.3) { st = false; continue; }
            if (!st) { p.moveTo(x, y); st = true; } else p.lineTo(x, y);
          }
          p.closePath();
        }
      }
    }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a241c');
    g.addColorStop(.55, '#211c16');
    g.addColorStop(1, '#191510');
    ctx.fillStyle = g;
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(163,141,105,.42)';
    ctx.lineWidth = .65;
    ctx.stroke(p);
  }

  // 经纬网
  ctx.strokeStyle = 'rgba(190,168,132,.045)';
  ctx.lineWidth = 1;
  for (let lon = -20; lon <= 150; lon += 20) {
    const x = proj(lon, 0)[0];
    if (x < 0 || x > W) continue;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = 0; lat <= 60; lat += 15) {
    const y = proj(0, lat)[1];
    if (y < 0 || y > H) continue;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // 区域标注（东亚 / 地中海 / 西欧）
  ctx.save();
  ctx.font = '600 11px "Songti SC",serif';
  ctx.fillStyle = 'rgba(140,124,104,.34)';
  ctx.letterSpacing = '3px';
  const regions = [
    ['东　亚', 112, 34], ['地　中　海', 18, 36], ['西　欧', -4, 50], ['两　河', 44, 33]
  ];
  for (const [t, lon, lat] of regions) {
    const [x, y] = proj(lon, lat);
    if (x > -40 && x < W + 40) ctx.fillText(t, x, y);
  }
  ctx.restore();
}

/* ---------- 点 ---------- */
const pinMap = new Map();
let activeId = null;
let curIdx = 0;

function placePins() {
  if (!pinMap.size) buildPins();

  const items = STOPS.map(s => {
    const [x, y] = proj(s.lon, s.lat);
    return { s, tx: x, ty: y, x, y };
  });

  // 按重要度占位，避免重叠
  items.sort((a, b) => (b.s.q.length + b.s.pts.length) - (a.s.q.length + a.s.pts.length));
  const done = [];
  for (const it of items) {
    let t = 0;
    while (t < 36) {
      const hit = done.some(p => Math.abs(p.x - it.x) < 24 && Math.abs(p.y - it.y) < 19);
      if (!hit) break;
      const a = t * 2.39996, r = 13 + Math.sqrt(t) * 8;
      it.x = it.tx + Math.cos(a) * r;
      it.y = it.ty + Math.sin(a) * r * .8;
      t++;
    }
    done.push(it);
  }

  const leader = [];
  for (const it of items) {
    const el = pinMap.get(it.s.id);
    if (!el) continue;
    el.style.left = it.x + 'px';
    el.style.top = it.y + 'px';
    el.classList.toggle('active', it.s.id === activeId);
    el.classList.toggle('seen', seen.has(it.s.id) && it.s.id !== activeId);
    el.classList.toggle('future', it.s.seq > curIdx + 1 && it.s.id !== activeId);
    // 标签放左侧还是右侧
    el.classList.toggle('left', it.x > W - 130);
    if (Math.hypot(it.x - it.tx, it.y - it.ty) > 5) leader.push([it.tx, it.ty, it.x, it.y]);
  }

  // 引线
  fx.clearRect(0, 0, W, H);
  fx.strokeStyle = 'rgba(180,158,124,.22)';
  fx.lineWidth = .8;
  for (const [x1, y1, x2, y2] of leader) {
    fx.beginPath(); fx.moveTo(x1, y1); fx.lineTo(x2, y2); fx.stroke();
  }
  // 当前点的地形十字
  const cur = STOPS.find(s => s.id === activeId);
  if (cur) {
    const [ax, ay] = proj(cur.lon, cur.lat);
    fx.save();
    fx.strokeStyle = 'rgba(201,162,39,.30)';
    fx.setLineDash([3, 6]);
    fx.lineWidth = 1;
    fx.beginPath(); fx.moveTo(ax - 60, ay); fx.lineTo(ax + 60, ay); fx.stroke();
    fx.beginPath(); fx.moveTo(ax, ay - 60); fx.lineTo(ax, ay + 60); fx.stroke();
    fx.restore();
  }
}

function buildPins() {
  pinsHost.innerHTML = '';
  for (const s of STOPS) {
    const el = document.createElement('div');
    el.className = 'pin ' + (isCn(s) ? 'cn' : 'we') + (s.q.length >= 3 ? ' big' : '');
    el.dataset.id = s.id;
    el.innerHTML = `<span class="halo"></span><span class="dot"></span>
      <span class="pinlabel">${esc(s.place)}</span>`;
    el.addEventListener('click', e => { e.stopPropagation(); selectStop(s.seq - 1, true); });
    pinsHost.appendChild(el);
    pinMap.set(s.id, el);
  }
}

/* ---------- 选中站点 ---------- */
function selectStop(idx, pan = true) {
  idx = Math.max(0, Math.min(STOPS.length - 1, idx));
  curIdx = idx;
  const s = STOPS[idx];
  activeId = s.id;
  seen.add(s.id); saveSeen();

  renderCard(s);
  $('#hudPlace').textContent = s.place;
  $('#hudMeta').textContent = fmtYear(s.y) + ' 年 · ' + (eraOf(s.era).n || '');
  $('#pos').textContent = String(idx + 1).padStart(2, '0') + ' / ' + STOPS.length;
  $('#prog').style.setProperty('--p', ((idx + 1) / STOPS.length * 100) + '%');
  $('#prev').disabled = idx === 0;
  $('#next').textContent = idx === STOPS.length - 1 ? '回到第一站 ↺' : '下一站 →';

  // 目录高亮
  $$('.li').forEach(el => el.classList.toggle('on', el.dataset.id === s.id));
  const onLi = $(`.li[data-id="${s.id}"]`);
  if (onLi) onLi.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  if (pan) centerOn(s);
  placePins();
}

function centerOn(s, zoomK) {
  const cardEl = $('#card');
  let cardW = 0;
  if (!cardEl.classList.contains('hidden') && innerWidth > 640) {
    cardW = cardEl.getBoundingClientRect().width + 18;
  }
  const targetX = cardW + (W - cardW) * 0.5;
  const targetY = innerWidth <= 640 ? H * 0.21 : H * 0.5;

  // 缩放：至少要能看清该区域（默认 4.5 倍；全球视图下自动拉近）
  const k = zoomK || Math.max(view.k, innerWidth <= 640 ? 2.2 : 2.6);
  view.k = Math.min(14, k);

  // 先归零算基准位置
  const kx = view.k;
  view.tx = 0; view.ty = 0;
  const [bx, by] = projRaw(s.lon, s.lat);
  view.tx = targetX - bx * kx;
  view.ty = targetY - by * kx;
  clampView();
  draw(); placePins();
}

function clampView() {
  const mxX = W * (view.k - 1), mxY = H * (view.k - 1);
  view.tx = Math.min(0, Math.max(-mxX, view.tx));
  view.ty = Math.min(0, Math.max(-mxY, view.ty));
}

/* ---------- 卡片 ---------- */
function renderCard(s) {
  const e = eraOf(s.era);
  const cn = isCn(s);
  let h = `<div class="cMeta">
    <span class="side ${cn ? 'cn' : 'we'}">${cn ? '中国' : '西方'}</span>
    <span>${esc(e.n)}</span>
    <span>${fmtYear(s.y)} 年</span>
    <span>·</span>
    <span>第 ${s.seq} 站</span>
  </div>
  <h1>${esc(s.t)}</h1>
  <p class="lead">${esc(s.lead)}</p>`;

  if (s.img) {
    h += `<img class="planImg" src="assets/plans/${s.img}.webp?v=2" alt="${esc(s.t)}" loading="lazy">
          <div class="planCap">平面图 · 裁自教材 · 点击放大</div>`;
  }

  h += '<div class="ptsBox">';
  for (const p of s.pts) h += `<div class="pt"><h3>${esc(p.h)}</h3><p>${esc(p.b)}</p></div>`;
  h += '</div>';

  if (s.q.length) {
    h += `<div class="qHead"><span>本站考点</span><span>${s.q.length} 题</span></div>`;
    for (const q of s.q) {
      h += `<details class="qcard"><summary>
        <span class="kb kb-${q.k}">${q.k}</span><span>${esc(q.t)}</span>
      </summary><div class="qbody">
        <h4>参考答案</h4><p>${esc(q.a)}</p>
        ${q.kp ? `<div class="kp"><b>得分点：</b>${esc(q.kp)}</div>` : ''}
        ${q.err ? `<div class="err"><b>易错：</b>${esc(q.err)}</div>` : ''}
      </div></details>`;
    }
  }

  $('#cardBody').innerHTML = h;
  const img = $('#cardBody .planImg');
  if (img) img.addEventListener('click', () => zoomImg(img.src));
  const card = $('#card');
  card.classList.remove('hidden');
  card.scrollTop = 0;
}

/* ---------- 目录 ---------- */
let listFilter = 'all', lastEra = null;

function renderList() {
  let h = '';
  // 按时代分组顺序：西方 8 个 + 中国 6 个，按起始年排
  const eraOrder = ERAS.slice().sort((a, b) => {
    const ya = STOPS.find(s => s.era === a.k);
    const yb = STOPS.find(s => s.era === b.k);
    return (ya ? ya.y : 0) - (yb ? yb.y : 0);
  });
  for (const e of eraOrder) {
    const group = STOPS.filter(s => s.era === e.k);
    if (!group.length) continue;
    if (listFilter !== 'all' && (listFilter === 'cn') !== (e.side === 'cn')) continue;
    h += `<div class="eraDiv">${esc(e.n)} · ${esc(e.sub)}　<span style="opacity:.55">${group.length}站</span></div>`;
    for (const s of group.sort((a, b) => a.seq - b.seq)) {
    if (listFilter !== 'all' && (listFilter === 'cn') !== isCn(s)) continue;
      h += `<div class="li ${isCn(s) ? 'cn' : 'we'} ${seen.has(s.id) ? 'seen' : ''}" data-id="${s.id}" data-seq="${s.seq}">
        <span class="no">${String(s.seq).padStart(2, '0')}</span>
        <span class="tt">${esc(s.t)}</span>
        <span class="yr">${fmtYear(s.y)}</span>
      </div>`;
    }
  }
  $('#listBody').innerHTML = h;
  $$('.li').forEach(el => el.addEventListener('click', () => {
    selectStop(+el.dataset.seq - 1, true);
    if (innerWidth <= 640) $('#list').classList.add('hidden');
  }));
  const cur = STOPS[curIdx];
  if (cur) $$('.li').forEach(el => el.classList.toggle('on', el.dataset.id === cur.id));
}

/* ---------- 缩放 / 聚焦 ---------- */
function setZoom(k, cx, cy) {
  k = Math.max(1, Math.min(14, k));
  cx = cx ?? W / 2; cy = cy ?? H / 2;
  const k0 = view.k;
  view.tx = cx - (cx - view.tx) * (k / k0);
  view.ty = cy - (cy - view.ty) * (k / k0);
  view.k = k;
  clampView(); draw(); placePins();
}

function focus(lon0, lon1, lat0, lat1) {
  const a = projRaw(lon0, lat1), b = projRaw(lon1, lat0);
  const bw = Math.abs(b[0] - a[0]), bh = Math.abs(b[1] - a[1]);
  if (bw < 1 || bh < 1) return;
  const k = Math.max(1, Math.min(14, Math.min(W / bw, H / bh) * .88));
  view.k = k;
  view.tx = W / 2 - (a[0] + b[0]) / 2 * k;
  view.ty = H / 2 - (a[1] + b[1]) / 2 * k;
  clampView(); draw(); placePins();
}

/* ---------- 搜索 ---------- */
let INDEX = null;
function buildIndex() {
  const arr = [];
  for (const s of STOPS) {
    arr.push({ t: s.t, sub: `${fmtYear(s.y)} · ${s.place}`, k: '站', seq: s.seq });
    for (const p of s.pts) arr.push({ t: p.h, sub: s.t, k: '知识点', seq: s.seq });
    for (const q of s.q) arr.push({ t: q.t, sub: q.k + ' · ' + s.t, k: q.k, seq: s.seq });
  }
  return arr;
}

function doSearch(kw) {
  if (!INDEX) INDEX = buildIndex();
  kw = kw.trim().toLowerCase();
  const box = $('#searchResults');
  if (!kw) { box.innerHTML = ''; return; }
  const hits = INDEX.filter(x =>
    x.t.toLowerCase().includes(kw) || (x.sub || '').toLowerCase().includes(kw)).slice(0, 40);
  box.innerHTML = hits.length ? hits.map((x, i) =>
    `<div class="sr" data-i="${i}"><span class="sk">${x.k}</span>
     <span>${esc(x.t)}</span><span class="st">${esc(x.sub || '')}</span></div>`).join('')
    : '<div class="sr" style="color:#6b6257">没有找到</div>';
  $$('.sr').forEach(el => el.addEventListener('click', () => {
    const x = hits[+el.dataset.i];
    if (!x) return;
    selectStop(x.seq - 1, true);
    $('#searchBox').classList.add('hidden');
    const cur = STOPS[x.seq - 1];
    const q = cur.q.find(q => q.t === x.t);
    if (q) {
      setTimeout(() => {
        for (const c of $$('.qcard')) {
          if (c.querySelector('summary span:nth-child(2)')?.textContent === x.t) {
            c.open = true; c.scrollIntoView({ block: 'center', behavior: 'smooth' }); break;
          }
        }
      }, 240);
    }
  }));
}

/* ---------- 放大图 ---------- */
function zoomImg(src) {
  let z = $('#zoom');
  if (!z) {
    z = document.createElement('div');
    z.id = 'zoom';
    z.innerHTML = '<img alt="">';
    z.addEventListener('click', () => z.remove());
    document.body.appendChild(z);
  }
  z.querySelector('img').src = src;
}

/* ---------- 拖拽 ---------- */
let dragging = false, sx = 0, sy = 0, moved = false;
cvs.addEventListener('pointerdown', e => {
  dragging = true; moved = false;
  sx = e.clientX - view.tx; sy = e.clientY - view.ty;
  cvs.setPointerCapture(e.pointerId);
});
cvs.addEventListener('pointermove', e => {
  if (!dragging) return;
  const nx = e.clientX - sx, ny = e.clientY - sy;
  if (Math.abs(nx - view.tx) + Math.abs(ny - view.ty) > 3) moved = true;
  view.tx = nx; view.ty = ny;
  clampView(); draw(); placePins();
});
cvs.addEventListener('pointerup', e => {
  dragging = false;
  try { cvs.releasePointerCapture(e.pointerId); } catch (_) {}
});
cvs.addEventListener('wheel', e => {
  e.preventDefault();
  setZoom(view.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY);
}, { passive: false });

/* ---------- 绑定 ---------- */
function bind() {
  $('#zIn').addEventListener('click', () => setZoom(view.k * 1.45));
  $('#zOut').addEventListener('click', () => setZoom(view.k / 1.45));
  $('#zAll').addEventListener('click', () => { view.k = 1; view.tx = 0; view.ty = 0; draw(); placePins(); });
  $('#zCn').addEventListener('click', () => focus(103, 126, 20, 44));
  $('#zWe').addEventListener('click', () => focus(-12, 24, 36, 58));

  $('#prev').addEventListener('click', () => selectStop(curIdx - 1, true));
  $('#next').addEventListener('click', () => selectStop(curIdx >= STOPS.length - 1 ? 0 : curIdx + 1, true));
  $('#cardClose').addEventListener('click', () => {
    $('#card').classList.add('hidden');
    activeId = null; placePins();
  });

  $('#btnList').addEventListener('click', () => {
    const l = $('#list');
    l.classList.toggle('hidden');
    if (!l.classList.contains('hidden')) renderList();
  });
  $('#listClose').addEventListener('click', () => $('#list').classList.add('hidden'));
  $$('.listFilter button').forEach(b => b.addEventListener('click', () => {
    listFilter = b.dataset.f;
    $$('.listFilter button').forEach(x => x.classList.toggle('on', x === b));
    renderList();
  }));

  $('#btnSearch').addEventListener('click', () => {
    const s = $('#searchBox');
    s.classList.toggle('hidden');
    if (!s.classList.contains('hidden')) setTimeout(() => $('#searchInput').focus(), 40);
  });
  $('#searchInput').addEventListener('input', e => doSearch(e.target.value));

  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') {
      if (e.key === 'Escape') { $('#searchBox').classList.add('hidden'); e.target.blur(); }
      return;
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); selectStop(curIdx - 1, true); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); selectStop(Math.min(STOPS.length - 1, curIdx + 1), true); }
    else if (e.key === '/') { e.preventDefault(); $('#searchBox').classList.remove('hidden'); $('#searchInput').focus(); }
    else if (e.key === 'm') $('#btnList').click();
    else if (e.key === 'Escape') { $('#searchBox').classList.add('hidden'); $('#list').classList.add('hidden'); }
  });

  addEventListener('resize', () => {
    clearTimeout(window.__rz);
    window.__rz = setTimeout(() => { resize(); if (activeId) { const s = STOPS.find(x => x.id === activeId); if (s) centerOn(s); } }, 150);
  });
}

/* ---------- 启动 ---------- */
function boot() {
  resize();
  bind();
  selectStop(0, false);
  centerOn(STOPS[0]);
  fetch('assets/world.geo.json').then(r => r.json()).then(g => {
    GEO = g; draw(); placePins();
    const s = STOPS[curIdx]; if (s) centerOn(s);
  }).catch(() => {});
}
boot();
})();
