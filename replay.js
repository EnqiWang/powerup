
(function () {
'use strict';
const G = window.PowerupReplayEngine;
const $ = id => document.getElementById(id);
const NAMED = G.NAMED, S = G.S, C = G.C, HOURS = G.HOURS;
const RUNG_NAMES = { none: 'Ordinary day', watch: 'Watch', ask: 'Ask', fill: 'Fill', hold: 'Hold', hand: 'Hand' };
const STATUS_LABEL = { normal: 'ordinary', watch: 'watch', held: 'held at 100%', filling: 'filling', islanded: 'islanded', empty: 'empty', silent: 'silent', fault: 'fault', restoring: 'recharging', standby: 'grid on, recharge pending' };
const STATUS_ORDER = [S.normal, S.watch, S.held, S.filling, S.restoring, S.standby, S.islanded, S.silent, S.empty, S.fault];
const PLAN_EVENT_H = Math.round(G.hourOf(DATA.timeline.find(ev => ev.kind === 'plan').t));   // the pack's planned first restoration (Oct 18 06:00)
const isPhone = () => window.innerWidth < 560;
const CHAN_LABEL = ['home internet', 'SMS (cell)', 'mesh to Starlink', 'silent: tower down', 'silent: check this one', 'none'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const fmtInt = n => Math.round(n).toLocaleString();
const money = n => '$' + Math.round(n).toLocaleString();
const costMoney = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '0%';
const clock12 = h => { const hh = ((h + 11) % 12) + 1; return `${hh} ${h < 12 ? 'AM' : 'PM'}`; };
const pmRange = ([a, b]) => (a >= 12 && b > 12 && b <= 24) ? `${((a + 11) % 12) + 1} to ${((b + 11) % 12) + 1} PM` : `${clock12(a)} to ${clock12(b % 24)}`;
const RUNGS = G.rungHours(DATA);
const TODAY_H = (17 - 7) * 24;
const FIRE_H = G.hourOf(DATA.fire.started);
const FIRE_REPORT_H = Math.ceil(G.hourOf(DATA.fire.as_of));   // the Oct 16 3 PM report the acreage and containment come from

// ---------- state ----------
let P = G.defaultParams(DATA);
const decisions = { restore: {}, ev: {} };
let world = null, sim = null;
let hour = RUNGS.hold;
let selectedCircuit = 'Galahad';
let playing = false, playAcc = 0, lastT = 0;
let T = {}; // theme tokens

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const names = ['bg', 'fg', 'muted', 'panel', 'line', 'accent', 'land', 'ocean', 'coast', 'label', 'halo', 'zone-line', 'zone-down', 'zone-text', 'band', 'band-line',
    'h-plain', 'h-plain-off', 'h-normal', 'h-watch', 'h-held', 'h-filling', 'h-islanded', 'h-empty', 'h-silent', 'h-check', 'h-fault', 'h-restoring', 'h-standby',
    'c-galahad', 'c-maguire', 'c-cuthbert', 'c-merlin', 'c-serra', 'c-tuna', 'c-nicholas', 'r-watch', 'r-ask', 'r-fill', 'r-hold', 'r-hand',
    'fire', 'fire-fill', 'ok', 'warn', 'bad', 'chart-grid', 'chart-band', 'chart-line', 'font-mono', 'font-cond', 'font-ui'];
  T = {};
  for (const n of names) T[n] = cs.getPropertyValue('--' + n).trim();
}
const circColor = c => T['c-' + c.toLowerCase()];
const statusColor = st => T['h-' + G.STATUS[st]];

// ---------- simulation ----------
function run() {
  world = G.buildHomes(DATA, P);
  sim = G.simulate(DATA, world, P, decisions);
  // prune decisions on EV proposals that no longer exist
  const ids = new Set(sim.proposals.ev.map(p => p.id));
  for (const k of Object.keys(decisions.ev)) if (!ids.has(k)) delete decisions.ev[k];
}
function resim() { sim = G.simulate(DATA, world, P, decisions); renderAll(); }

// ---------- map ----------
const mapWrap = $('mapWrap'), canvas = $('map'), ctx = canvas.getContext('2d');
const view = { cx: 0, cy: 0, scale: 10 };
let W = 0, H = 0, dpr = 1;
let coastKm = null, bandsKm = null, linesKm = null, placesKm = null, fireKm = null, contentBox = null;
let hoverId = -1, pinnedId = -1, pinnedPos = null;
let needsDraw = true;

function prepGeometry() {
  const bb = DATA.meta.bbox;
  coastKm = DATA.coast.map(p => G.toKm(p[0], p[1], bb));
  bandsKm = {};
  for (const k of Object.keys(DATA.approx_areas)) bandsKm[k] = G.bandPolygon(DATA.approx_areas[k], DATA.coast, 16).map(p => G.toKm(p[0], p[1], bb));
  linesKm = {};
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const c of Object.keys(DATA.lines)) {
    linesKm[c] = DATA.lines[c].map(pl => pl.map(p => G.toKm(p[0], p[1], bb)));
    if (c === 'Nicholas') continue;
    for (const pl of linesKm[c]) for (const p of pl) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  }
  for (const p of bandsKm.Tuna) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  placesKm = DATA.places.map(p => ({ n: p.n, p: G.toKm(p.lon, p.lat, bb) }));
  fireKm = G.toKm(DATA.fire.lon, DATA.fire.lat, bb);
  contentBox = { minx, miny, maxx, maxy };
}
function resetView(animate) {
  const pad = 0.6;
  const w = contentBox.maxx - contentBox.minx + pad * 2, h = contentBox.maxy - contentBox.miny + pad * 2;
  let scale = Math.min(W / w, H / h);
  let cx = (contentBox.minx + contentBox.maxx) / 2, cy = (contentBox.miny + contentBox.maxy) / 2;
  if (W < 600) { scale = Math.min(W / w, H / h) * 1.9; cx = (contentBox.minx + contentBox.maxx) / 2 - 1.5; cy += 0.8; }
  setView({ cx, cy, scale }, animate);
}
let anim = null;
function setView(v, animate) {
  if (animate && !reduceMotion.matches) {
    const from = { ...view }, t0 = performance.now(), dur = 220;
    cancelAnimationFrame(anim);
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      view.cx = from.cx + (v.cx - from.cx) * e; view.cy = from.cy + (v.cy - from.cy) * e;
      view.scale = from.scale * Math.pow(v.scale / from.scale, e);
      needsDraw = true;
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  } else { Object.assign(view, v); needsDraw = true; }
}
const toPx = (x, y) => [(x - view.cx) * view.scale + W / 2, (y - view.cy) * view.scale + H / 2];
const toKmPt = (px, py) => [(px - W / 2) / view.scale + view.cx, (py - H / 2) / view.scale + view.cy];
function zoomAt(factor, px, py) {
  const ns = Math.max(3, Math.min(400, view.scale * factor));
  const f = ns / view.scale;
  const nx = view.cx + (px - W / 2) * (1 - 1 / f) / view.scale, ny = view.cy + (py - H / 2) * (1 - 1 / f) / view.scale;
  Object.assign(view, { scale: ns, cx: nx, cy: ny }); needsDraw = true;
}
function resize() {
  const r = mapWrap.getBoundingClientRect();
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
  const first = W === 0;
  W = nw; H = nh;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  if (first) resetView(false);
  needsDraw = true;
}

function homeRadius() { return Math.max(2.2, Math.min(6, view.scale * 0.11)); }
function fireVisible() { return hour >= FIRE_H; }

function drawMap(now) {
  labelBoxes = [];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = T.land; ctx.fillRect(0, 0, W, H);
  const h = hour, N = sim.N, base = h * N;
  // ocean
  ctx.beginPath();
  const p0 = toPx(coastKm[0][0], coastKm[0][1]);
  ctx.moveTo(p0[0], p0[1]);
  for (let i = 1; i < coastKm.length; i++) { const p = toPx(coastKm[i][0], coastKm[i][1]); ctx.lineTo(p[0], p[1]); }
  const pe = toPx(coastKm[coastKm.length - 1][0], 200); ctx.lineTo(pe[0] + 4000, pe[1] + 4000); ctx.lineTo(p0[0] - 4000, pe[1] + 4000);
  ctx.closePath(); ctx.fillStyle = T.ocean; ctx.fill();
  ctx.strokeStyle = T.coast; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]);
  for (let i = 1; i < coastKm.length; i++) { const p = toPx(coastKm[i][0], coastKm[i][1]); ctx.lineTo(p[0], p[1]); }
  ctx.stroke();

  // tower zones
  const f = sim.fleet[h];
  ctx.font = `500 11px ${T['font-cond']}`; ctx.textBaseline = 'top';
  const edges = world.zoneEdges;
  for (const z of world.zones) {
    // a zone runs from the first home of its band to the first home of the next (the edges the engine split on)
    const x0 = z.id === 0 ? toPx(z.x0 - 0.2, 0)[0] : toPx(edges[z.id - 1], 0)[0];
    const x1 = z.id === world.zones.length - 1 ? toPx(z.x1 + 0.2, 0)[0] : toPx(edges[z.id], 0)[0];
    const down = f.towerDown[z.id] === 1;
    const silentZone = down && !(P.mesh && z.starlink);
    if (silentZone) { ctx.fillStyle = T['zone-down']; ctx.fillRect(x0, 0, x1 - x0, H); }
    if (z.id > 0) { ctx.setLineDash([3, 5]); ctx.strokeStyle = T['zone-line']; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, H); ctx.stroke(); ctx.setLineDash([]); }
    const lbl = `Zone ${z.id + 1}`;
    const mainOn = sim.circuits[z.mainCircuit].state[h] !== 1;
    // the tower's state: a coloured dot always, then the longest form of the words that fits (one line, two lines, or the zone alone)
    const state = h < RUNGS.hold ? 'up' : down ? (P.mesh && z.starlink ? 'mesh' : 'silent') : mainOn ? 'grid' : 'battery';
    const subs = state === 'up' ? (z.starlink ? ['tower up, Starlink node', 'tower up', 'up'] : ['tower up, no uplink', 'tower up', 'up'])
      : state === 'mesh' ? ['tower down, mesh to Starlink', 'tower down, mesh', 'down, mesh', 'mesh']
      : state === 'silent' ? ['tower down, silent', 'tower down', 'silent']
      : state === 'grid' ? ['tower back on grid', 'tower on grid', 'on grid', 'grid']
      : (z.starlink ? ['tower on battery', 'on battery', 'battery'] : ['tower on battery, no uplink', 'tower on battery', 'on battery', 'battery']);
    const dotCol = state === 'up' || state === 'grid' ? T.ok : state === 'silent' ? T.accent : T.warn;
    const ly = 6, lx0 = Math.max(x0 + 6, 6), limit = Math.min(x1 - 4, W - 54), tx = lx0 + 10;
    const zcol = silentZone ? T.accent : T['zone-text'];
    const fits = t => tx + ctx.measureText(t).width < limit;
    let lines = null;
    for (const sub of subs) { const t = `${lbl}: ${sub}`; if (fits(t)) { lines = [t]; break; } }
    if (!lines) for (const sub of subs) { if (fits(sub)) { lines = [lbl, sub]; break; } }
    if (!lines && fits(lbl)) lines = [lbl];
    if (!lines && tx + ctx.measureText(String(z.id + 1)).width < limit) lines = [String(z.id + 1)];
    if (lines) {
      const tw = Math.max.apply(null, lines.map(t => ctx.measureText(t).width));
      ctx.fillStyle = T.halo; ctx.fillRect(lx0 - 3, ly - 2, tw + 16, 2 + lines.length * 13);
      ctx.fillStyle = dotCol; ctx.beginPath(); ctx.arc(lx0 + 3, ly + 6, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = zcol;
      lines.forEach((t, i) => ctx.fillText(t, tx, ly + i * 13));
    }
  }

  // approximate bands
  for (const k of Object.keys(bandsKm)) {
    const poly = bandsKm[k];
    ctx.beginPath(); poly.forEach((p, i) => { const q = toPx(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath();
    const named = k === 'Tuna';
    ctx.fillStyle = named ? T.band : 'rgba(0,0,0,0)'; if (named) ctx.fill();
    ctx.setLineDash([5, 4]); ctx.strokeStyle = named ? T['c-tuna'] : T['band-line']; ctx.lineWidth = named ? 1.5 : 1; ctx.globalAlpha = named ? 1 : 0.6; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  // lines
  for (const c of Object.keys(linesKm)) {
    const info = DATA.circuits[c];
    const namedAt = info.named_oct_2026 ? sim.namedH[c] : Infinity;
    const isNamed = h >= namedAt;
    const sel = c === selectedCircuit;
    // lines sit under the homes: thicker and brighter so the six circuits read through the dots
    let col = circColor(c), alpha = isNamed ? 1 : 0.45, lw = sel ? 3.4 : 2.3;
    if (c === 'Nicholas') { col = T['c-nicholas']; alpha = 0.7; lw = 1.6; }
    if (selectedCircuit && !sel) alpha *= 0.65;
    if (h >= RUNGS.hold && sim.circuits[c] && sim.circuits[c].state[h] === 1) { ctx.setLineDash([6, 4]); }
    ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const pl of linesKm[c]) {
      for (let i = 0; i < pl.length; i++) { const q = toPx(pl[i][0], pl[i][1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // homes
  const r = homeRadius();
  const sz = Math.max(1.4, r * 0.55);
  // plain homes, drawn light so the lines read through them
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = T['h-plain'];
  ctx.beginPath();
  const offCol = T['h-plain-off'];
  let anyOff = false;
  for (const hm of world.homes) {
    if (hm.battery) continue;
    const off = sim.circuits[hm.circuit].state[h] === 1;
    if (off) { anyOff = true; continue; }
    const q = toPx(hm.x, hm.y); if (q[0] < -5 || q[0] > W + 5 || q[1] < -5 || q[1] > H + 5) continue;
    ctx.rect(q[0] - sz / 2, q[1] - sz / 2, sz, sz);
  }
  ctx.fill();
  if (anyOff) {
    ctx.fillStyle = offCol; ctx.beginPath();
    for (const hm of world.homes) {
      if (hm.battery || sim.circuits[hm.circuit].state[h] !== 1) continue;
      const q = toPx(hm.x, hm.y); if (q[0] < -5 || q[0] > W + 5 || q[1] < -5 || q[1] > H + 5) continue;
      ctx.rect(q[0] - sz / 2, q[1] - sz / 2, sz, sz);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // the selected circuit's line again, above the plain homes, with a thin halo so it is never buried under its homes
  const selOff = selectedCircuit && h >= RUNGS.hold && sim.circuits[selectedCircuit] && sim.circuits[selectedCircuit].state[h] === 1;
  const selPath = () => { ctx.beginPath(); for (const pl of linesKm[selectedCircuit]) for (let i = 0; i < pl.length; i++) { const q = toPx(pl[i][0], pl[i][1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } };
  const selCol = selectedCircuit === 'Nicholas' ? T['c-nicholas'] : selectedCircuit ? circColor(selectedCircuit) : null;
  if (selectedCircuit && linesKm[selectedCircuit]) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    selPath(); ctx.strokeStyle = T.panel; ctx.lineWidth = 4.4; ctx.globalAlpha = 0.9; ctx.stroke();
    if (selOff) ctx.setLineDash([6, 4]);
    selPath(); ctx.strokeStyle = selCol; ctx.lineWidth = 2.4; ctx.globalAlpha = 1; ctx.stroke();
    ctx.setLineDash([]);
  }
  // battery homes grouped by status
  const groups = new Array(G.STATUS.length).fill(null).map(() => []);
  for (const hm of world.batteries) groups[sim.status[base + hm.bi]].push(hm);
  for (const st of STATUS_ORDER) {
    const list = groups[st]; if (!list.length) continue;
    const col = statusColor(st);
    if (st === S.silent) {
      // rings: tower-down grey, check orange; a hollow centre so they stand out from filled dots
      for (const cls of [C.silent_tower, C.silent_check]) {
        ctx.strokeStyle = cls === C.silent_check ? T['h-check'] : T['h-silent']; ctx.lineWidth = Math.max(1.6, r * 0.6); ctx.beginPath();
        for (const hm of list) { if (hm.tier === 1 || sim.chan[base + hm.bi] !== cls) continue; const q = toPx(hm.x, hm.y); if (q[0] < -9 || q[0] > W + 9 || q[1] < -9 || q[1] > H + 9) continue; ctx.moveTo(q[0] + r * 1.05, q[1]); ctx.arc(q[0], q[1], r * 1.05, 0, Math.PI * 2); }
        ctx.stroke();
      }
    } else if (st === S.fault) {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, r * 0.5); ctx.beginPath();
      for (const hm of list) { const q = toPx(hm.x, hm.y); ctx.moveTo(q[0] - r, q[1] - r); ctx.lineTo(q[0] + r, q[1] + r); ctx.moveTo(q[0] + r, q[1] - r); ctx.lineTo(q[0] - r, q[1] + r); }
      ctx.stroke();
    } else {
      ctx.fillStyle = col; ctx.beginPath();
      for (const hm of list) { if (hm.tier === 1) continue; const q = toPx(hm.x, hm.y); if (q[0] < -9 || q[0] > W + 9 || q[1] < -9 || q[1] > H + 9) continue; ctx.moveTo(q[0] + r, q[1]); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); }
      ctx.fill();
    }
    // Medical Baseline: a larger diamond with a dark outline and a cross, so it reads at desktop zoom
    const t1 = list.filter(hm => hm.tier === 1);
    if (t1.length) {
      const R = r * 2.0;
      for (const hm of t1) {
        const q = toPx(hm.x, hm.y); if (q[0] < -12 || q[0] > W + 12 || q[1] < -12 || q[1] > H + 12) continue;
        const silentCls = st === S.silent ? (sim.chan[base + hm.bi] === C.silent_check ? T['h-check'] : T['h-silent']) : null;
        ctx.fillStyle = silentCls ? T.panel : col; ctx.strokeStyle = silentCls || T.fg; ctx.lineWidth = silentCls ? 2 : 1.4;
        ctx.beginPath(); ctx.moveTo(q[0], q[1] - R); ctx.lineTo(q[0] + R, q[1]); ctx.lineTo(q[0], q[1] + R); ctx.lineTo(q[0] - R, q[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = silentCls || T.panel; ctx.lineWidth = Math.max(1.2, R * 0.26);
        ctx.beginPath(); ctx.moveTo(q[0] - R * 0.5, q[1]); ctx.lineTo(q[0] + R * 0.5, q[1]); ctx.moveTo(q[0], q[1] - R * 0.5); ctx.lineTo(q[0], q[1] + R * 0.5); ctx.stroke();
      }
    }
  }
  // the selected line once more, above the battery homes at 40%, so it reads through a dense cluster (Cuthbert at Point Dume)
  if (selectedCircuit && linesKm[selectedCircuit]) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (selOff) ctx.setLineDash([6, 4]);
    selPath(); ctx.strokeStyle = selCol; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.4; ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  // hover / pinned highlight
  const hid = pinnedId >= 0 ? pinnedId : hoverId;
  if (hid >= 0) {
    const hm = world.homes[hid], q = toPx(hm.x, hm.y);
    ctx.strokeStyle = T.fg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q[0], q[1], r * 2.2 + 2, 0, Math.PI * 2); ctx.stroke();
  }

  // fire
  if (fireVisible()) {
    const q = toPx(fireKm[0], fireKm[1]);
    const acres = DATA.fire.acres, rkm = Math.sqrt(acres * 0.00404686 / Math.PI);
    ctx.fillStyle = T['fire-fill']; ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(6, rkm * view.scale), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = T.fire; ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.fill();
    const pulse = reduceMotion.matches ? 0.5 : ((now / 1600) % 1);
    ctx.strokeStyle = T.fire; ctx.globalAlpha = 1 - pulse; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q[0], q[1], 6 + pulse * 22, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    // the acreage and containment come from the Oct 16 3 PM report: before that hour only the start is known
    const ft = hour >= FIRE_REPORT_H ? `Bryson Fire, ${acres} ac, ${DATA.fire.contained_pct}% contained (${G.fmtTime(FIRE_REPORT_H, { short: true })})` : `Bryson Fire, started ${G.fmtTime(FIRE_H, { short: true }).split(', ')[1]}`;
    ctx.font = `600 12px ${T['font-cond']}`;
    const tw = ctx.measureText(ft).width;
    let fx = q[0] + 10, align = 'left';
    if (fx + tw > W - 60) { if (q[0] - 10 - tw >= 4) { fx = q[0] - 10; align = 'right'; } else { fx = Math.min(Math.max(q[0], tw / 2 + 4), W - tw / 2 - 4); align = 'center'; } }
    const fy = align === 'center' || q[1] - 14 < 40 ? q[1] + 16 : q[1] - 14;
    labelFit(ft, fx, fy, T.fire, align, 12, true, true);
  }

  // places, then the approximate bands' labels: a label that would sit on one already drawn moves below it, then above, else waits for a zoom
  for (const pl of placesKm) { const q = toPx(pl.p[0], pl.p[1]); if (q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) continue; if (q[0] > W - 80 && q[1] < 190) continue; labelFit(pl.n, q[0], Math.max(44, q[1]), T.label, 'center', 11); }
  for (const k of Object.keys(bandsKm)) {
    const poly = bandsKm[k], named = k === 'Tuna';
    let q;
    if (named) {
      // Tuna: on the band's seaward edge, over the water, so the 500 assumed homes never cover it
      const e = poly[Math.floor((poly.length / 2 - 1) / 2)]; q = toPx(e[0], e[1]); q[1] += 12;
    } else {
      const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]); q = toPx(c[0], c[1]); q[1] -= 20;
    }
    if (q[0] < -40 || q[0] > W + 40 || q[1] < 0 || q[1] > H) continue;
    labelFit(`${k} (approx.)`, q[0], q[1], named ? T['c-tuna'] : T.muted, 'center', 11, named);
  }

  // scale bar
  const target = 120 / view.scale; // km
  const nice = [0.25, 0.5, 1, 2, 5, 10, 20].reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
  const len = nice * view.scale, x = 12, y = H - 14;
  ctx.strokeStyle = T.fg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + len, y - 4); ctx.lineTo(x + len, y + 4); ctx.stroke();
  label(`${nice} km / ${(nice / 1.609).toFixed(nice < 1 ? 2 : 1)} mi`, x, y - 16, T.fg, 'left', 11);
}
function label(text, x, y, color, align, size, bold) {
  ctx.font = `${bold ? 600 : 500} ${size || 11}px ${T['font-cond']}`;
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = T.halo; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}
// labels that avoid each other: the box of every label drawn this frame is kept; a new one that overlaps tries 14 px below,
// then 14 px above, and is skipped when neither is free (it comes back on zoom). `force` draws it anyway and reserves its box.
let labelBoxes = [];
function labelFit(text, x, y, color, align, size, bold, force) {
  ctx.font = `${bold ? 600 : 500} ${size || 11}px ${T['font-cond']}`;
  const w = ctx.measureText(text).width + 6, hh = (size || 11) + 4;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const hits = yy => labelBoxes.some(b => x0 < b.x1 && x0 + w > b.x0 && yy - hh / 2 < b.y1 && yy + hh / 2 > b.y0);
  let yy = y;
  if (!force && hits(yy)) { if (!hits(y + 14)) yy = y + 14; else if (!hits(y - 14)) yy = y - 14; else return false; }
  labelBoxes.push({ x0, x1: x0 + w, y0: yy - hh / 2, y1: yy + hh / 2 });
  label(text, x, yy, color, align, size, bold);
  return true;
}

// hit testing
function nearestHome(px, py) {
  // battery homes first: the nearest one inside its hit radius wins (a Medical Baseline diamond is drawn at 2r, so it hits at 2r + 6);
  // a plain home is hit only when no battery home is, and only inside its own smaller radius
  let best = -1, bd = Infinity, bestT1 = -1, bdT1 = Infinity;
  const r0 = homeRadius(), r = r0 * 2.4 + 4, r2 = r * r, rT1 = r0 * 2 + 6, rT12 = Math.max(r2, rT1 * rT1), inT1 = (r0 * 2 + 1.5) ** 2;
  const [kx, ky] = toKmPt(px, py);
  const kr = Math.max(r, rT1) / view.scale;
  for (const hm of world.batteries) {
    if (Math.abs(hm.x - kx) > kr || Math.abs(hm.y - ky) > kr) continue;
    const q = toPx(hm.x, hm.y), d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
    if (d < bd && d < (hm.tier === 1 ? rT12 : r2)) { bd = d; best = hm.id; }
    // a tap inside a drawn diamond is the diamond's, even when a dot underneath is nearer to the finger
    if (hm.tier === 1 && d < inT1 && d < bdT1) { bdT1 = d; bestT1 = hm.id; }
  }
  if (bestT1 >= 0) return bestT1;
  if (best >= 0) return best;
  const rp = r0 * 1.6 + 3, rp2 = rp * rp, krp = rp / view.scale;
  for (const hm of world.homes) {
    if (hm.battery || Math.abs(hm.x - kx) > krp || Math.abs(hm.y - ky) > krp) continue;
    const q = toPx(hm.x, hm.y), d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
    if (d < bd && d < rp2) { bd = d; best = hm.id; }
  }
  return best;
}
function nearestLine(px, py) {
  let best = null, bd = 64;
  const [kx, ky] = toKmPt(px, py);
  const kr = 8 / view.scale;
  for (const c of Object.keys(linesKm)) {
    for (const pl of linesKm[c]) for (let i = 1; i < pl.length; i++) {
      const a = pl[i - 1], b = pl[i];
      if (Math.min(a[0], b[0]) - kr > kx || Math.max(a[0], b[0]) + kr < kx || Math.min(a[1], b[1]) - kr > ky || Math.max(a[1], b[1]) + kr < ky) continue;
      const pa = toPx(a[0], a[1]), pb = toPx(b[0], b[1]);
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L2 = dx * dx + dy * dy || 1e-9;
      let t = ((px - pa[0]) * dx + (py - pa[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const d = (pa[0] + dx * t - px) ** 2 + (pa[1] + dy * t - py) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
  }
  return best;
}

// pointer interaction
const pointers = new Map();
let dragStart = null, pinchStart = null, moved = false;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  moved = false;
  if (pointers.size === 1) { dragStart = { x: e.offsetX, y: e.offsetY, cx: view.cx, cy: view.cy }; canvas.classList.add('dragging'); }
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: view.cx, cy: view.cy };
    dragStart = null;
  }
});
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ns = Math.max(3, Math.min(400, pinchStart.scale * d / (pinchStart.d || 1)));
    // keep the pinch midpoint anchored
    const k0 = [(pinchStart.mx - W / 2) / pinchStart.scale + pinchStart.cx, (pinchStart.my - H / 2) / pinchStart.scale + pinchStart.cy];
    view.scale = ns; view.cx = k0[0] - (mx - W / 2) / ns; view.cy = k0[1] - (my - H / 2) / ns;
    moved = true; needsDraw = true; return;
  }
  if (dragStart && pointers.size === 1) {
    const dx = e.offsetX - dragStart.x, dy = e.offsetY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (moved) { view.cx = dragStart.cx - dx / view.scale; view.cy = dragStart.cy - dy / view.scale; needsDraw = true; hideCard(false); }
    return;
  }
  if (e.pointerType === 'mouse' && pinnedId < 0) {
    const id = nearestHome(e.offsetX, e.offsetY);
    if (id !== hoverId) { hoverId = id; needsDraw = true; }
    if (id >= 0) showCard(id, e.offsetX, e.offsetY, false); else hideCard(false);
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0 && dragStart && !moved) {
    // tap or click: a home (battery or not) inside its hit radius pins its card and selects its circuit in place;
    // only a tap on a bare line selects the circuit and, on phone, scrolls to its panel
    const id = nearestHome(e.offsetX, e.offsetY);
    if (id >= 0) {
      pinnedId = id; pinnedPos = { x: e.offsetX, y: e.offsetY }; showCard(id, e.offsetX, e.offsetY, true); selectCircuit(world.homes[id].circuit, false);
      if (window.innerWidth < 700 && !$('legend').hidden) setLegend(false);
    } else {
      hideCard(true);
      const c = nearestLine(e.offsetX, e.offsetY);
      if (c) selectCircuit(c, true);
    }
    needsDraw = true;
  }
  dragStart = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (pinnedId < 0) { hoverId = -1; hideCard(false); needsDraw = true; } });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.pow(1.0018, -e.deltaY), e.offsetX, e.offsetY); }, { passive: false });
canvas.addEventListener('dblclick', e => { zoomAt(1.8, e.offsetX, e.offsetY); });
$('zoomIn').addEventListener('click', () => setView({ cx: view.cx, cy: view.cy, scale: Math.min(400, view.scale * 1.6) }, true));
$('zoomOut').addEventListener('click', () => setView({ cx: view.cx, cy: view.cy, scale: Math.max(3, view.scale / 1.6) }, true));
$('zoomReset').addEventListener('click', () => resetView(true));
function setLegend(show) {
  const l = $('legend'); l.hidden = !show; $('legendBtn').setAttribute('aria-pressed', String(show)); if (show && pinnedId >= 0) hideCard(true); needsDraw = true;
  if (show && window.innerWidth < 900) {
    const mb = mapWrap.getBoundingClientRect().bottom, tt = $('timeline').getBoundingClientRect().top;
    if (mb > tt + 1) window.scrollBy({ top: mb - tt, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }
}
$('legendBtn').addEventListener('click', () => setLegend($('legend').hidden));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pinnedId >= 0) { hideCard(true); needsDraw = true; } });

// home card
const card = $('homeCard');
function homeInfo(id, h) {
  const hm = world.homes[id];
  const circ = sim.circuits[hm.circuit];
  const off = circ.state[h] === 1;
  if (!hm.battery) return { hm, battery: false, off };
  const i = h * sim.N + hm.bi;
  const st = sim.status[i], soc = sim.soc[i], m = sim.mode[i], ch = sim.chan[i], fl = sim.flags[i];
  let hoursLeft = null;
  const budget = [P.mode_critical, P.mode_essential, P.mode_normal][m] * hm.factor;   // this home's budget, kWh/day
  if (off && soc > 0 && st !== S.fault) { hoursLeft = G.hoursLeftWalk(soc, budget, world.prof[hm.circuit].shape, h % 24, 240); }
  return { hm, battery: true, off, st, soc, m, ch, fl, hoursLeft, budget };
}
function showCard(id, x, y, pinned) {
  const info = homeInfo(id, hour), hm = info.hm;
  const tierName = hm.battery ? (hm.tier === 1 ? 'Tier 1 Medical Baseline (demo)' : hm.tier === 2 ? 'Tier 2 registered critical need (assumed)' : 'Tier 3') : 'no battery';
  let html = `<h4><span><i class="dot" style="background:${circColor(hm.circuit)}"></i>Home ${hm.id} on ${hm.circuit}</span><span class="muted">zone ${hm.zone + 1}</span></h4>`;
  if (pinned) html += `<button class="close" id="cardClose" aria-label="Close">&times;</button>`;
  html += '<dl>';
  html += `<dt>Tier</dt><dd>${tierName}</dd>`;
  if (!hm.battery) {
    html += `<dt>Power</dt><dd>${info.off ? 'off since ' + G.fmtTime(RUNGS.hold, { short: true }) : 'grid on'}</dd>`;
    html += `<dt>Battery</dt><dd>none (${100 - P.adoption_pct}% of homes, assumed)</dd>`;
  } else {
    const stName = STATUS_LABEL[G.STATUS[info.st]];
    html += `<dt>Battery</dt><dd><i class="dot" style="background:${statusColor(info.st)}"></i>${stName}</dd>`;
    html += `<dt>State of charge</dt><dd>${Math.round(info.soc / P.capacity_kwh * 100)}% (${info.soc.toFixed(1)} of ${P.capacity_kwh} kWh)</dd>`;
    if (info.off) {
      const modeKwh = [P.mode_critical, P.mode_essential, P.mode_normal][info.m];
      html += `<dt>Budget mode</dt><dd>${G.MODES[info.m]}, ${info.budget.toFixed(1)} kWh/day<br><span class="muted">${modeKwh} kWh/day x ${hm.factor.toFixed(2)} home size (assumed)</span></dd>`;
      if (hm.tier === 1) html += `<dt>Medical device</dt><dd>inside the critical budget</dd>`;
      html += `<dt>Hours left</dt><dd>${info.hoursLeft === null ? (info.st === S.fault ? 'fault' : 'dark') : info.hoursLeft > 99 ? '99+ h' : info.hoursLeft.toFixed(0) + ' h'}</dd>`;
      const cc = sim.circuits[hm.circuit], toR = cc.horizonH[hour] - hour, replans = cc.replans[hour];
      html += `<dt>To restoration</dt><dd>${toR} h (${hour >= RUNGS.hand ? 'planned' : 'estimate'})${replans ? `<br><span class="muted">estimate passed, re-planned ${replans === 1 ? 'once' : replans + ' times'}</span>` : ''}</dd>`;
    } else if (hour < RUNGS.hold) {
      const fl = hm.tier === 3 && hour >= sim.namedH[hm.circuit] ? P.ask_floor_pct : P.reserve_floor_pct;
      html += `<dt>Floor</dt><dd>${fl}%</dd>`;
      if (hm.tier === 3) html += `<dt>Pre-fill consent</dt><dd>${hm.consentDelay === Infinity ? 'declined' : hour >= sim.namedH[hm.circuit] + hm.consentDelay ? 'given' : hour >= sim.namedH[hm.circuit] ? 'asked' : 'not yet asked'}</dd>`;
    }
    html += `<dt>Reporting</dt><dd>${CHAN_LABEL[info.ch]}</dd>`;
    if (hm.ev) html += `<dt>EV</dt><dd>yes (${P.ev_pct}% of homes, assumed)</dd>`;
    html += '</dl>';
    if (info.fl & 3) html += `<div class="flags">${info.fl & 1 ? '<span class="flag">thermostat hold 78&deg;F (assumed)</span>' : ''}${info.fl & 2 ? '<span class="flag">EV charger paused</span>' : ''}<span class="flag">plan signed before shutoff</span></div>`;
  }
  if (!hm.battery) html += '</dl>';
  card.innerHTML = html;
  card.hidden = false; card.classList.toggle('pinned', !!pinned);
  const cw = card.offsetWidth, chh = card.offsetHeight;
  let left = x + 14, top = y + 14;
  if (left + cw > W - 6) left = x - cw - 10;
  if (top + chh > H - 6) top = Math.max(6, y - chh - 10);
  if (left < 6) left = 6;
  card.style.left = left + 'px'; card.style.top = top + 'px';
  if (pinned) $('cardClose').addEventListener('click', () => hideCard(true));
}
function hideCard(unpin) {
  if (unpin) { pinnedId = -1; pinnedPos = null; }
  if (pinnedId < 0) card.hidden = true;
}

// render loop
function frame(now) {
  if (playing) {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    playAcc += dt * +$('speedSel').value;
    if (playAcc >= 1) { const step = Math.floor(playAcc); playAcc -= step; setHour(hour + step); }
    if (hour >= HOURS - 1) togglePlay(false);
  }
  const pulsing = fireVisible() && !reduceMotion.matches && !document.hidden;
  if (needsDraw || pulsing) { needsDraw = false; drawMap(now); }
  requestAnimationFrame(frame);
}

// ---------- timeline ----------
const tl = $('tlCanvas'), tctx = tl.getContext('2d'), tlWrap = $('tlWrap');
let tlW = 0, tlH = 72;
function tlHeight() { return window.innerWidth < 560 ? 54 : window.innerWidth < 900 ? 60 : window.innerHeight <= 820 ? 60 : 72; }
const PADL = 6, PADR = 6;
const xOf = h => PADL + (h / HOURS) * (tlW - PADL - PADR);
const hOf = x => Math.max(0, Math.min(HOURS - 1, Math.round((x - PADL) / (tlW - PADL - PADR) * HOURS)));
function resizeTl() {
  tlW = tl.parentElement.getBoundingClientRect().width; tlH = tlHeight();
  tl.width = Math.round(tlW * dpr); tl.height = Math.round(tlH * dpr); tl.style.height = tlH + 'px';
  drawTl();
}
function drawTl() {
  const c = tctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, tlW, tlH);
  const top = 14, bot = tlH - 16;
  c.fillStyle = T.panel; c.fillRect(0, 0, tlW, tlH);
  // day grid + labels, drawn first so no gridline crosses a rung label
  c.strokeStyle = T['chart-grid']; c.lineWidth = 1; c.font = `500 10px ${T['font-mono']}`; c.fillStyle = T.muted; c.textBaseline = 'alphabetic';
  for (let d = 0; d <= 11; d++) {
    const x = xOf(d * 24);
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bot); c.stroke();
    const p = G.dateParts(d * 24);
    if (tlW > 520 || d % 2 === 0) c.fillText(`${p.wd} ${p.dom}`, x + 3, tlH - 4);
  }
  // rung bands
  const seq = ['watch', 'ask', 'fill', 'hold', 'hand'];
  for (let i = 0; i < seq.length; i++) {
    const a = RUNGS[seq[i]], b = i + 1 < seq.length ? RUNGS[seq[i + 1]] : HOURS;
    c.fillStyle = T['r-' + seq[i]]; c.globalAlpha = 0.16; c.fillRect(xOf(a), top, xOf(b) - xOf(a), bot - top); c.globalAlpha = 1;
    c.fillStyle = T['r-' + seq[i]]; c.fillRect(xOf(a), top, 2, bot - top);
    c.font = `600 10px ${T['font-cond']}`; c.textBaseline = 'top';
    const room = (i + 1 < seq.length ? xOf(b) : tlW) - xOf(a);
    if (room > 30) { c.lineWidth = 3; c.strokeStyle = T.panel; c.lineJoin = 'round'; c.strokeText(seq[i].toUpperCase(), xOf(a) + 5, top + 2); c.fillStyle = T['r-' + seq[i]]; c.fillText(seq[i].toUpperCase(), xOf(a) + 5, top + 2); }
  }
  // planned shading: everything after the Hand rung (Oct 17 20:00) is a forecast or a plan
  c.fillStyle = T.fg; c.globalAlpha = 0.05; c.fillRect(xOf(RUNGS.hand), top, xOf(HOURS) - xOf(RUNGS.hand), bot - top); c.globalAlpha = 1;
  // soc sparkline
  c.strokeStyle = T.muted; c.lineWidth = 1.2; c.beginPath();
  for (let h = 0; h < HOURS; h++) { const y = bot - (sim.fleet[h].socPct / 100) * (bot - top - 14); const x = xOf(h); if (h) c.lineTo(x, y); else c.moveTo(x, y); }
  c.stroke();
  // event ticks: events closer than 8 px share one tick with a count, so a busy day never reads as a clump (hover lists them all)
  const ticks = [];
  for (const ev of DATA.timeline) {
    const x = xOf(G.hourOf(ev.t)), last = ticks[ticks.length - 1];
    if (last && x - last.x < 8) { last.n++; last.plan = last.plan || ev.kind === 'plan'; }
    else ticks.push({ x, n: 1, kind: ev.kind, plan: ev.kind === 'plan' });
  }
  c.font = `600 8px ${T['font-mono']}`; c.textBaseline = 'top';
  for (const t of ticks) {
    const col = t.kind === 'nws' ? T['r-watch'] : t.kind === 'sce' ? T['r-fill'] : t.kind === 'fire' ? T.fire : T.muted;
    c.fillStyle = col; c.beginPath(); c.moveTo(t.x, 2); c.lineTo(t.x - 4, 10); c.lineTo(t.x + 4, 10); c.closePath(); c.fill();
    if (t.n > 1) { c.fillStyle = T.fg; c.fillText(String(t.n), t.x + 5, 1); }
    if (t.plan) { c.strokeStyle = col; c.setLineDash([2, 2]); c.beginPath(); c.moveTo(t.x, 10); c.lineTo(t.x, bot); c.stroke(); c.setLineDash([]); }
  }
  // this run's first planned restoration, when it differs from the pack's plan entry
  const run0 = sim.proposals.restore[0];
  if (run0 && run0.startH !== PLAN_EVENT_H && run0.startH < HOURS) { const x = xOf(run0.startH); c.strokeStyle = T.accent; c.setLineDash([2, 2]); c.beginPath(); c.moveTo(x, 10); c.lineTo(x, bot); c.stroke(); c.setLineDash([]); }
  // today marker
  const tx = xOf(TODAY_H);
  c.strokeStyle = T.fg; c.setLineDash([3, 3]); c.lineWidth = 1; c.beginPath(); c.moveTo(tx, top - 2); c.lineTo(tx, bot); c.stroke(); c.setLineDash([]);
  c.font = `600 10px ${T['font-cond']}`; c.fillStyle = T.fg; c.textBaseline = 'top'; c.fillText('TODAY', tx + 3, top + 14);
  // cursor
  const cx = xOf(hour);
  c.strokeStyle = T.accent; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, top - 4); c.lineTo(cx, bot + 2); c.stroke();
  c.fillStyle = T.accent; c.beginPath(); c.moveTo(cx - 6, top - 4); c.lineTo(cx + 6, top - 4); c.lineTo(cx, top + 3); c.closePath(); c.fill();
}
let tlDrag = false;
tl.addEventListener('pointerdown', e => { tlDrag = true; tl.setPointerCapture(e.pointerId); setHour(hOf(e.offsetX)); if (e.pointerType !== 'touch') tlWrap.focus({ preventScroll: true }); });
tl.addEventListener('pointermove', e => {
  if (tlDrag) { setHour(hOf(e.offsetX)); return; }
  // event hover: every event within 7 px, in time order
  const near = DATA.timeline.filter(ev => Math.abs(xOf(G.hourOf(ev.t)) - e.offsetX) < 7);
  const tip = $('tlTip');
  if (near.length) {
    tip.hidden = false;
    tip.innerHTML = near.map(best => `<div><b>${G.fmtTime(G.hourOf(best.t))}</b> ${best.kind === 'plan' ? '<span class="pill">planned</span> ' : G.hourOf(best.t) >= TODAY_H ? '<span class="pill">forecast</span> ' : ''}${best.rung ? `<span class="pill">${best.rung}</span> ` : ''}${best.text}</div>`).join('');
    const w = tip.offsetWidth; let left = e.offsetX - w / 2; left = Math.max(0, Math.min(tlW - w, left)); tip.style.left = left + 'px';
  } else tip.hidden = true;
});
tl.addEventListener('pointerup', () => { tlDrag = false; });
tl.addEventListener('pointercancel', () => { tlDrag = false; });
tl.addEventListener('pointerleave', () => { $('tlTip').hidden = true; });
tlWrap.addEventListener('keydown', e => {
  const k = e.key;
  if (k === 'ArrowRight' || k === 'ArrowUp') { setHour(hour + (e.shiftKey ? 6 : 1)); e.preventDefault(); }
  else if (k === 'ArrowLeft' || k === 'ArrowDown') { setHour(hour - (e.shiftKey ? 6 : 1)); e.preventDefault(); }
  else if (k === 'Home') { setHour(0); e.preventDefault(); }
  else if (k === 'End') { setHour(HOURS - 1); e.preventDefault(); }
  else if (k === 'PageUp') { setHour(hour + 24); e.preventDefault(); }
  else if (k === 'PageDown') { setHour(hour - 24); e.preventDefault(); }
  else if (k === ' ') { togglePlay(); e.preventDefault(); }
});
document.addEventListener('keydown', e => {
  if (e.key !== ' ' || e.target === tlWrap) return;
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'BUTTON' || t === 'TEXTAREA' || t === 'A') return;
  togglePlay(); e.preventDefault();
});
function togglePlay(force) {
  playing = force === undefined ? !playing : force;
  if (playing && hour >= HOURS - 1) setHour(0);
  lastT = performance.now(); playAcc = 0;
  $('playBtn').textContent = playing ? 'Pause' : 'Play';
  $('playBtn').setAttribute('aria-pressed', String(playing));
}
$('playBtn').addEventListener('click', () => togglePlay());
$('bulletin').addEventListener('click', () => $('bulletin').classList.toggle('expanded'));
$('todayBtn').addEventListener('click', () => setHour(TODAY_H));
const ORDINARY_H = 18;   // Wed Oct 7, 6:00 PM: batteries covering the evening peak
function jumpRung(r) { setHour(r === 'none' ? ORDINARY_H : RUNGS[r]); try { history.replaceState(null, '', '#' + (r === 'none' ? 'ordinary' : r)); } catch (e) { } }
(function buildRungButtons() {
  const box = $('rungBtns');
  for (const r of ['watch', 'ask', 'fill', 'hold', 'hand']) {
    const b = document.createElement('button');
    b.className = 'btn sm'; b.id = 'jump-' + r; b.textContent = RUNG_NAMES[r]; b.style.setProperty('--r-col', `var(--r-${r})`);
    b.title = `Jump to the ${RUNG_NAMES[r]} rung, ${G.fmtTime(RUNGS[r])}`;
    b.addEventListener('click', () => jumpRung(r));
    box.appendChild(b);
  }
})();

// ---------- ladder strip ----------
const eventFor = r => DATA.timeline.find(ev => ev.rung === r);
const LADDER = [
  { r: 'none', k: 'Step 0', name: 'Ordinary day', when: 'Wed Oct 7 and Thu Oct 8', short: 'Oct 7 and 8', col: 'var(--h-normal)', what: () => `Charge off-peak, carry the 4 to 9 PM peak above the ${P.reserve_floor_pct}% floor: about <b>$${ordinaryPerHome().toFixed(2)}</b> a day per home at assumed rates, as Base and Tesla already do.` },
  { r: 'watch', k: 'Step 1', name: 'Watch', col: 'var(--r-watch)', what: () => 'First NWS wind signal, the trigger Storm Watch uses for every home. Here only Medical Baseline homes fill off-peak and hold at 100%; everyone else keeps the ordinary day.' },
  { r: 'ask', k: 'Step 2', name: 'Ask', col: 'var(--r-ask)', what: () => `SCE names Cuthbert, Galahad, Maguire, Merlin. Registered critical-need homes there fill and hold; Tier 3 floors rise to ${P.ask_floor_pct}% (assumed), consent to pre-fill is asked.` },
  { r: 'fill', k: 'Step 3', name: 'Fill', col: 'var(--r-fill)', what: () => 'Six circuits named, shutoff definite. Consenting homes fill to 100% inside each circuit\'s headroom, so no new peak.' },
  { r: 'hold', k: 'Step 4', name: 'Hold', col: 'var(--r-hold)', what: () => `Power off. Every battery islands, never exports, and runs a budget sized to the planned ${P.planned_outage_h} h, pushed before the towers fail.` },
  { r: 'hand', k: 'Step 5', name: 'Hand to a person', col: 'var(--r-hand)', what: () => 'Winds ease (forecast). PoweruP proposes a restoration recharge plan per circuit. <b>The shutoff officer</b> approves or holds each one.' }
];
function ordinaryPerHome() { const N = sim.N || 1; return (sim.fleet[23].savingsDay + sim.fleet[47].savingsDay) / 2 / N; }
(function buildLadder() {
  $('ladderSteps').innerHTML = LADDER.map(s => {
    const ev = eventFor(s.r);
    const when = s.when || (G.fmtTime(G.hourOf(ev.t)) + (s.r === 'hand' ? ' (forecast)' : ''));
    const short = s.short || G.fmtTime(G.hourOf(ev.t)).replace(/^\w+ /, '');
    const lands = s.r === 'none' ? G.fmtTime(ORDINARY_H) : G.fmtTime(RUNGS[s.r]);
    return `<li><button class="step" id="step-${s.r === 'none' ? 'ordinary' : s.r}" data-rung="${s.r}" style="--rc:${s.col}" title="Jump to ${s.name}: replay from ${lands}"><span class="k">${s.k}</span><span class="name">${s.name}</span><span class="when"><span class="full">${when}</span><span class="short">${short}</span></span><span class="what" id="stepWhat-${s.r}"></span></button></li>`;
  }).join('');
  $('ladderSteps').querySelectorAll('button.step').forEach(b => b.addEventListener('click', () => jumpRung(b.dataset.rung)));
})();
function renderLadder(rung) {
  const order = LADDER.map(s => s.r), cur = order.indexOf(rung);
  LADDER.forEach((s, i) => {
    const el = $('step-' + (s.r === 'none' ? 'ordinary' : s.r));
    if (i === cur) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    el.classList.toggle('past', i < cur);
    $('stepWhat-' + s.r).innerHTML = s.what();
    el.title = `${s.name}: ${s.what().replace(/<[^>]+>/g, '')} Click to replay from ${s.r === 'none' ? G.fmtTime(ORDINARY_H) : G.fmtTime(RUNGS[s.r])}.`;
  });
  const now = LADDER[cur] || LADDER[0];
  const nowEl = $('ladderNow');
  nowEl.style.setProperty('--rc', now.col);
  nowEl.innerHTML = `<span class="step-k">${now.k}, ${now.name}</span>${now.what()}`;
}

// ---------- real event line ----------
const EVENT_TAG = { nws: 'NWS', sce: 'SCE', fire: 'Fire', plan: 'planned' };
const EVENT_H = DATA.timeline.map(ev => G.hourOf(ev.t));
function latestEventIdx(h) { let best = -1; for (let i = 0; i < EVENT_H.length; i++) if (EVENT_H[i] <= h) best = i; return best; }
function renderRealEvent() {
  const i = latestEventIdx(hour);
  if (i < 0) { $('realEvent').innerHTML = `Nothing yet. The first forecast discussion comes ${G.fmtTime(EVENT_H[0])}.`; return; }
  const ev = DATA.timeline[i], ago = hour - Math.floor(EVENT_H[i]);
  const run0 = sim.proposals.restore[0];
  const runNote = ev.kind === 'plan' && run0 && run0.startH !== PLAN_EVENT_H ? ` <span class="muted">(this run: first restoration ${G.fmtTime(run0.startH)}, planned outage ${P.planned_outage_h} h)</span>` : '';
  // an event dated after Today (Sat Oct 17) that is not a plan is a forecast, and the line says so
  const forecast = ev.kind !== 'plan' && EVENT_H[i] >= TODAY_H ? ' <span class="pill">forecast</span>' : '';
  $('realEvent').innerHTML = `<b>${G.fmtTime(EVENT_H[i])}, ${EVENT_TAG[ev.kind] || ev.kind}:</b>${forecast} ${ev.text}${ago > 0 ? ` <span class="muted">(${ago} h ago)</span>` : ''}${runNote}`;
}

function setHour(h) {
  h = Math.max(0, Math.min(HOURS - 1, Math.round(h)));
  if (h === hour) return;
  hour = h; needsDraw = true;
  renderHour();
}

// ---------- panels ----------
function renderHour() {
  const f = sim.fleet[hour];
  $('clock').textContent = G.fmtTime(hour);
  const chip = $('rungChip'); chip.textContent = f.rung === 'hand' ? (isPhone() ? 'Hand (planned)' : 'Hand to a person (planned)') : RUNG_NAMES[f.rung]; chip.dataset.rung = f.rung;
  chip.style.background = f.rung === 'none' ? '' : `var(--r-${f.rung})`; chip.style.borderColor = chip.style.background;
  tlWrap.setAttribute('aria-valuenow', hour); tlWrap.setAttribute('aria-valuetext', G.fmtTime(hour));
  $('narrative').textContent = sim.narrative[hour];
  renderRealEvent();
  for (const r of ['watch', 'ask', 'fill', 'hold', 'hand']) $('jump-' + r).setAttribute('aria-pressed', String(f.rung === r));
  renderLadder(f.rung);
  drawTl();
  renderFleet(); renderCircuit(); renderApprovals(); renderMath();
  if (pinnedId >= 0 && pinnedPos) showCard(pinnedId, pinnedPos.x, pinnedPos.y, true);
}

function renderFleet() {
  const f = sim.fleet[hour], N = sim.N;
  const silentT = f.byChan[C.silent_tower], silentC = f.byChan[C.silent_check];
  const outage = hour >= RUNGS.hold;
  $('fleetSub').textContent = `${fmtInt(N)} battery homes of ${fmtInt(world.homes.length)} (Tuna's ${DATA.circuits.Tuna.customers} assumed) on six circuits (${P.adoption_pct}% adoption, assumed)`;
  const k = [];
  const gridBack = f.byStatus[S.standby] + f.byStatus[S.restoring] > 0;
  k.push(['Battery homes with power', `${fmtInt(f.power)}<small> of ${fmtInt(N)}</small>`]);
  k.push(['Medical Baseline (demo) with power', `${fmtInt(f.mbPower)}<small> of ${fmtInt(f.mbTotal)}</small>`]);
  k.push([gridBack ? 'Empty (circuit still off)' : 'Empty', fmtInt(f.byStatus[S.empty])]);
  k.push(['Silent: tower down', fmtInt(silentT)]);
  k.push([`Silent: check this battery (${f.faultsActual} faulted)`, fmtInt(silentC)]);
  k.push(gridBack ? [`Grid back: ${fmtInt(f.byStatus[S.restoring])} recharging, ${fmtInt(f.byStatus[S.standby])} recharge pending`, fmtInt(f.byStatus[S.restoring] + f.byStatus[S.standby])]
    : outage ? ['Islanded', fmtInt(f.byStatus[S.islanded])]
    : [`Held at 100% (${fmtInt(f.byStatus[S.filling])} filling)`, fmtInt(f.byStatus[S.held])]);
  $('fleetKpis').innerHTML = k.map(([lab, v]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${lab}</div></div>`).join('');
  // status stack
  const order = STATUS_ORDER;
  $('statusStack').innerHTML = order.filter(st => f.byStatus[st]).map(st => `<span style="width:${f.byStatus[st] / N * 100}%;background:${statusColor(st)}" title="${STATUS_LABEL[G.STATUS[st]]}: ${f.byStatus[st]}"></span>`).join('');
  $('statusKeys').innerHTML = order.filter(st => f.byStatus[st]).map(st => `<span><i class="dot" style="background:${statusColor(st)}"></i>${STATUS_LABEL[G.STATUS[st]]} <b>${fmtInt(f.byStatus[st])}</b></span>`).join('') + `<span>fleet soc <b>${f.socPct.toFixed(0)}%</b></span>`;
  const chCol = [T['h-watch'], T['h-filling'], T['h-held'], T['h-silent'], T['h-check'], T.muted];
  $('chanStack').innerHTML = [0, 1, 2, 3, 4].filter(i => f.byChan[i]).map(i => `<span style="width:${f.byChan[i] / N * 100}%;background:${chCol[i]}" title="${CHAN_LABEL[i]}: ${f.byChan[i]}"></span>`).join('');
  $('chanKeys').innerHTML = [0, 1, 2, 3, 4].filter(i => f.byChan[i]).map(i => `<span><i class="dot" style="background:${chCol[i]}"></i>${CHAN_LABEL[i]} <b>${fmtInt(f.byChan[i])}</b></span>`).join('') + (outage ? `<span>tower zones down <b>${f.zonesDown} of 6</b>${P.mesh ? '' : ' (mesh off)'}</span>` : '');
  drawSocChart();
  const pr = [];
  pr.push(['Outage hours protected', `<span style="white-space:nowrap">${fmtInt(f.protectedCum)} home-hours</span>`]);
  pr.push(['Medical Baseline hours', `${fmtInt(f.mbHoursCum)} h`]);
  if (outage) pr.push([f.circuitsOff > 0 ? 'Budget modes (homes still off)' : 'Budget modes', f.circuitsOff > 0 ? `${f.byMode[0]} critical, ${f.byMode[1]} essential, ${f.byMode[2]} normal${f.gridBack ? `; ${fmtInt(f.gridBack)} back on the grid` : ''}` : 'every circuit back; budgets lifted']);
  pr.push(['EV dispatch', `${f.evProposed} proposed, ${f.evApproved} approved, ${fmtInt(f.evHoursBought)} h bought`]);
  $('protectRows').innerHTML = pr.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  const perHome = N ? f.savingsDay / N : 0;
  const mr = [];
  mr.push(['Battery charging cost since Oct 7', `${costMoney(f.chargingCostCum)} fleet · ${fmtInt(f.chargingKwhCum)} kWh bought`]);
  mr.push(['Battery charging cost today', `${costMoney(f.chargingCostDay)}${f.chargingKwhDay === 0 ? ' · no grid charging today so far' : ` · ${fmtInt(f.chargingKwhDay)} kWh bought`}`]);
  mr.push(['Estimated bill savings today', `${costMoney(f.savingsDay)} fleet, $${perHome.toFixed(2)} per home`]);
  mr.push(['Estimated bill savings since Oct 7', costMoney(f.savingsCum)]);
  mr.push(['Missed savings to keep backup today', `${costMoney(f.readinessDay)}${outage ? ' · pre-outage accounting only' : ' · peak-hour estimate'}`]);
  mr.push(['Missed savings since Oct 7', costMoney(f.readinessCum)]);
  mr.push(['What these costs mean', 'Charging cost counts all battery charging, not just extra outage preparation. Missed savings are an opportunity-cost estimate, not another charge. Savings already allow for off-peak energy: do not subtract charging cost again. Initial stored energy, losses, battery wear and fixed fees are not priced.']);
  mr.push(['Rates (assumed)', `on-peak ${pmRange(P.on_peak_hours)}, $${P.on_peak.toFixed(2)} / $${P.off_peak.toFixed(2)} per kWh`]);
  $('moneyRows').innerHTML = mr.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
}

function chartSetup(cv, h) {
  const w = cv.parentElement.getBoundingClientRect().width - 0;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  return { c, w, h };
}
function drawSocChart() {
  const { c, w, h } = chartSetup($('socChart'), 90);
  const L = 30, R = 6, Tp = 6, B = 16;
  const x = hh => L + hh / HOURS * (w - L - R), y = p => Tp + (1 - p / 100) * (h - Tp - B);
  c.strokeStyle = T['chart-grid']; c.lineWidth = 1; c.font = `500 9px ${T['font-mono']}`; c.fillStyle = T.muted; c.textAlign = 'right'; c.textBaseline = 'middle';
  for (const p of [0, 50, 100]) { c.beginPath(); c.moveTo(L, y(p)); c.lineTo(w - R, y(p)); c.stroke(); c.fillText(p + '%', L - 4, y(p)); }
  const seq = ['watch', 'ask', 'fill', 'hold', 'hand'];
  for (let i = 0; i < seq.length; i++) { const a = RUNGS[seq[i]], b = i + 1 < seq.length ? RUNGS[seq[i + 1]] : HOURS; c.fillStyle = T['r-' + seq[i]]; c.globalAlpha = 0.12; c.fillRect(x(a), Tp, x(b) - x(a), h - Tp - B); c.globalAlpha = 1; }
  c.fillStyle = T.fg; c.globalAlpha = 0.06; c.fillRect(x(RUNGS.hand), Tp, x(HOURS) - x(RUNGS.hand), h - Tp - B); c.globalAlpha = 1;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  for (let d = 0; d <= 11; d += 2) { c.fillStyle = T.muted; c.fillText('Oct ' + (7 + d), x(d * 24) + 2, h - 4); }
  c.strokeStyle = T['chart-line']; c.lineWidth = 1.5; c.beginPath();
  for (let hh = 0; hh < HOURS; hh++) { const px = x(hh), py = y(sim.fleet[hh].socPct); if (hh) c.lineTo(px, py); else c.moveTo(px, py); }
  c.stroke();
  // medical baseline with power share (dashed)
  c.strokeStyle = T['h-empty']; c.setLineDash([3, 3]); c.lineWidth = 1.2; c.beginPath();
  for (let hh = 0; hh < HOURS; hh++) { const f = sim.fleet[hh]; const px = x(hh), py = y(f.mbTotal ? f.mbPower / f.mbTotal * 100 : 100); if (hh) c.lineTo(px, py); else c.moveTo(px, py); }
  c.stroke(); c.setLineDash([]);
  c.strokeStyle = T.accent; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x(hour), Tp); c.lineTo(x(hour), h - B); c.stroke();
  $('socCap').innerHTML = `<i style="background:${T['chart-line']}"></i>fleet state of charge <i class="dash" style="color:${T['h-empty']}"></i>Medical Baseline (demo) homes with power. Shaded from the Hand rung (${G.fmtTime(RUNGS.hand, { short: true })}): forecast and planned. After restoration the batteries hold at the ${P.reserve_floor_pct}% floor until the officer approves the recharge.`;
}

function selectCircuit(c, scroll) {
  selectedCircuit = c; needsDraw = true;
  window.dispatchEvent(new CustomEvent('powerup:circuit-change', { detail: { circuit: c } }));
  $('circuitSel').value = c;
  for (const b of $('legendCircuits').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.c === c));
  renderCircuit(); renderMath();
  if (scroll && window.innerWidth < 900) $('circuitPanel').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
}
function renderCircuit() {
  const c = selectedCircuit, info = DATA.circuits[c];
  const facts = [];
  facts.push(['Substation', `${info.substation}, ${info.voltage}`]);
  facts.push(['Customers', info.customers === null ? 'not needed (context only)' : `${fmtInt(info.customers)}${info.customers_assumed ? ' (assumed)' : ''} <span class="muted small">${info.customers_assumed ? info.customers_source : 'SCE PSPS layer'}</span>`]);
  facts.push(['Named this event', info.named_oct_2026 ? `${info.named_on === '2026-10-12' ? 'Mon Oct 12 (SCE to City of Malibu)' : 'Wed Oct 14 (added with Merlin warning)'}` : 'no, neighbour for context']);
  facts.push(['Shutoffs on record', `${info.shutoffs_on_record}${info.longest_hours ? `, longest ${info.longest_hours} h` : ''}`]);
  if (sim.circuits[c]) {
    const st = sim.circuits[c].state[hour];
    facts.push(['Now', st === 1 ? `off since ${G.fmtTime(RUNGS.hold, { short: true })}` : hour >= RUNGS.hold ? `restored ${G.fmtTime(sim.circuits[c].restoreH, { short: true })} (planned)` : hour >= sim.namedH[c] ? 'on, named for shutoff' : 'on']);
  }
  $('circuitFacts').innerHTML = facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  // shutoff bars
  const hist = DATA.shutoff_history.filter(s => s.circuit === c).sort((a, b) => a.start < b.start ? -1 : 1);
  const maxH = Math.max(1, ...hist.map(s => s.hours));
  $('shutoffBars').innerHTML = hist.length ? hist.map(s => `<span class="t">${s.start.slice(0, 10)}</span><span class="b${s.whole ? '' : ' seg'}" style="--c:${circColor(c)};width:${Math.max(2, s.hours / maxH * 100)}%" title="${s.event}: ${s.customers} customers, ${s.hours} h${s.gust ? ', gust ' + s.gust + ' mph' : ''}${s.whole ? '' : ', segment'}"></span><span class="t">${s.hours} h</span>`).join('') : `<span class="muted small" style="grid-column:1/-1">${c === 'Tuna' ? 'None on record (no SCE PSPS record for Tuna; customers assumed).' : 'None on record.'}</span>`;
  if (hist.length) $('shutoffBars').insertAdjacentHTML('beforeend', `<span class="muted small" style="grid-column:1/-1">solid: whole circuit, faded: a segment</span>`);
  drawLoadChart();
  // tier grid
  if (sim.circuits[c]) {
    const cc = sim.circuits[c], base = hour * sim.N;
    const rows = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (const bi of cc.members) {
      const hm = world.batteries[bi], st = sim.status[base + bi], t = hm.tier - 1;
      rows[t][0]++;
      // every home lands in exactly one column: silent, else empty or faulted (or at 0 kWh), else with charge
      if (st === S.silent) rows[t][2]++;
      else if (st === S.empty || st === S.fault || sim.soc[base + bi] <= 0) rows[t][3]++;
      else rows[t][1]++;
    }
    const names = ['Tier 1 Medical Baseline (demo)', 'Tier 2 critical need (assumed)', 'Tier 3 everyone else'];
    $('tierGrid').innerHTML = `<span class="h"></span><span class="h n">homes</span><span class="h n">${hour >= RUNGS.hold ? 'with charge' : 'reporting'}</span><span class="h n">silent</span><span class="h n">empty / fault</span>` +
      rows.map((r, i) => `<span>${names[i]}</span><span class="n">${r[0]}</span><span class="n">${r[1]}</span><span class="n">${r[2]}</span><span class="n">${r[3]}</span>`).join('');
    const K = G.KW_PER_UNIT, hrKW = cc.gridA[hour] * K, capKW = cc.capA * K;
    $('loadNow').innerHTML = cc.state[hour] === 1 ? `Circuit off: no grid load. Cap <b>${mw(capKW)}</b> (October peak ${mw(capKW / (P.cold_load_cap_pct / 100))} x ${P.cold_load_cap_pct}%, ${cc.capA.toFixed(0)} A per phase in SCE's units). ${UNIT_NOTE}` :
      `This hour: <b>${mw(hrKW)}</b> of ${mw(capKW)} cap (${pct(hrKW, capKW)}), of which fleet charging ${mw(cc.chargeKW[hour])}. Headroom left ${mw(Math.max(0, cc.headroomKW[hour] - cc.chargeKW[hour]))}. ${UNIT_NOTE}`;
  } else {
    $('tierGrid').innerHTML = '<span class="muted small" style="grid-column:1/-1">Nicholas is drawn for context and gets no homes.</span>';
    $('loadNow').textContent = 'No load profile is used for Nicholas.';
  }
  const notes = [];
  if (c === 'Serra') notes.push('<b>Serra load data unusable:</b> SCE\'s profile for Serra is near zero. The chart uses Merlin\'s October shape scaled to Serra\'s 285 customers.');
  if (c === 'Tuna') notes.push('<b>Tuna:</b> no SCE line or customer count on record. 500 customers and the coastal band are assumed; homes are placed inside the band.');
  if (c === 'Nicholas') notes.push('Nicholas was not named in this event. It is drawn grey for context.');
  $('circuitNote').innerHTML = notes.join(' ');
}
const UNIT_NOTE = `SCE's units read as amps at 16 kV, 1 A = ${G.KW_PER_UNIT} kW, an inference.`;
const mw = kw => kw >= 950 ? (kw / 1000).toFixed(kw >= 9950 ? 0 : 1) + ' MW' : Math.round(kw) + ' kW';
function drawLoadChart() {
  const { c, w, h } = chartSetup($('loadChart'), 160);
  const name = selectedCircuit, prof = world.prof[name];
  if (!prof) { c.fillStyle = T.muted; c.font = `12px ${T['font-ui']}`; c.fillText('No load profile for Nicholas (context only).', 8, 20); return; }
  const cc = sim.circuits[name], K = G.KW_PER_UNIT;
  const L = 44, R = 8, Tp = 10, B = 18;
  const day = Math.floor(hour / 24);
  // everything in kW: SCE's October low to high, the fleet's charging stacked on the high, the cap, and the grid load after restoration
  const mx = prof.max.map(v => v * K), mn = prof.min.map(v => v * K), capKW = cc.capA * K;
  let chargeDay = day, charging = [];
  const dayCharge = d => { const a = []; for (let k = 0; k < 24; k++) { const hh = d * 24 + k; a.push(hh < HOURS ? cc.chargeKW[hh] : 0); } return a; };
  charging = dayCharge(day);
  // the fleet is often already full by the Fill rung (nightly charging did the work): then show the previous day's charging, labelled
  const capKW0 = cc.capA * K;
  if (day > 0 && day * 24 < RUNGS.hold && Math.max.apply(null, charging) < 0.05 * capKW0) { const prev = dayCharge(day - 1); if (Math.max.apply(null, prev) > Math.max.apply(null, charging)) { chargeDay = day - 1; charging = prev; } }
  const cold = []; for (let k = 0; k < 24; k++) { const hh = day * 24 + k; cold.push(hh < HOURS && cc.state[hh] !== 1 ? cc.gridA[hh] * K : 0); }
  const maxV = Math.max(capKW * 1.08, ...mx.map((v, i) => v + charging[i]), ...cold) * 1.05;
  const x = k => L + k / 23 * (w - L - R), y = v => Tp + (1 - v / maxV) * (h - Tp - B);
  c.strokeStyle = T['chart-grid']; c.lineWidth = 1; c.font = `500 9px ${T['font-mono']}`; c.fillStyle = T.muted; c.textAlign = 'right'; c.textBaseline = 'middle';
  const step = maxV > 8000 ? 2000 : maxV > 4000 ? 1000 : maxV > 1600 ? 500 : maxV > 700 ? 200 : 100;
  for (let v = 0; v <= maxV; v += step) { c.beginPath(); c.moveTo(L, y(v)); c.lineTo(w - R, y(v)); c.stroke(); c.fillText(v === 0 ? '0' : v >= 1000 ? (v / 1000) + ' MW' : v + ' kW', L - 4, y(v)); }
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  for (let k = 0; k < 24; k += 6) c.fillText(`${k}:00`, x(k), h - 5);
  // on-peak window
  const [pk0, pk1] = P.on_peak_hours;
  c.fillStyle = T['r-ask']; c.globalAlpha = 0.12; c.fillRect(x(pk0), Tp, x(pk1) - x(pk0), h - Tp - B); c.globalAlpha = 1;
  c.font = `600 9px ${T['font-cond']}`; c.fillStyle = T.muted; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('ON-PEAK', x(pk0) + 3, Tp + 2);
  // low to high band
  c.fillStyle = T['chart-band']; c.beginPath();
  for (let k = 0; k < 24; k++) { const px = x(k), py = y(mx[k]); if (k) c.lineTo(px, py); else c.moveTo(px, py); }
  for (let k = 23; k >= 0; k--) c.lineTo(x(k), y(mn[k]));
  c.closePath(); c.fill();
  // charging stacked on the high
  c.fillStyle = T['h-filling']; c.globalAlpha = 0.75; c.beginPath();
  for (let k = 0; k < 24; k++) { const px = x(k), py = y(mx[k] + charging[k]); if (k) c.lineTo(px, py); else c.moveTo(px, py); }
  for (let k = 23; k >= 0; k--) c.lineTo(x(k), y(mx[k]));
  c.closePath(); c.fill(); c.globalAlpha = 1;
  // grid load actually modelled this day (cold load pickup after restoration)
  if (day * 24 >= RUNGS.hold) {
    c.strokeStyle = T['h-restoring']; c.lineWidth = 1.5; c.beginPath(); let pen = false;
    for (let k = 0; k < 24; k++) { if (cold[k] <= 0) { pen = false; continue; } const px = x(k), py = y(cold[k]); if (pen) c.lineTo(px, py); else c.moveTo(px, py); pen = true; }
    c.stroke();
  }
  // high line
  c.strokeStyle = T['chart-line']; c.lineWidth = 1.2; c.beginPath();
  for (let k = 0; k < 24; k++) { const px = x(k), py = y(mx[k]); if (k) c.lineTo(px, py); else c.moveTo(px, py); }
  c.stroke();
  // cap
  c.strokeStyle = T['h-empty']; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(L, y(capKW)); c.lineTo(w - R, y(capKW)); c.stroke(); c.setLineDash([]);
  const capNearGrid = Math.abs(y(capKW) - y(Math.round(capKW / step) * step)) < 10;
  c.font = `600 9px ${T['font-cond']}`; c.fillStyle = T['h-empty']; c.textAlign = 'left'; c.textBaseline = capNearGrid ? 'top' : 'bottom'; c.fillText(`CAP ${mw(capKW)}`, L + 3, capNearGrid ? y(capKW) + 2 : y(capKW) - 1);
  // current hour marker
  const k = hour % 24;
  c.strokeStyle = T.accent; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x(k), Tp); c.lineTo(x(k), h - B); c.stroke();
  const dayName = d => G.fmtTime(d * 24, { short: true }).split(',')[0];
  $('loadCap').innerHTML = `<i style="background:${T['chart-band']};height:8px"></i>SCE October low to high${prof.borrowed ? ' (Merlin\'s shape, scaled)' : ''} <i style="background:${T['h-filling']};height:8px"></i>fleet charging on ${dayName(chargeDay)}${chargeDay !== day ? ` (none needed on ${dayName(day)}: the fleet was already full, so the last night with charging is shown)` : ''} ${day * 24 >= RUNGS.hold ? `<i style="background:${T['h-restoring']}"></i>grid load after restoration ` : ''}<i class="dash" style="color:${T['h-empty']}"></i>cap <i style="background:${T['r-ask']};opacity:0.3;height:8px"></i>on-peak ${pmRange([pk0, pk1])}. ${UNIT_NOTE}`;
}

function renderApprovals() {
  const f = sim.fleet[hour];
  const list = $('restoreList');
  if (hour < RUNGS.hand) {
    list.innerHTML = `<p class="note">Proposals appear at the Hand rung, ${G.fmtTime(RUNGS.hand)}, when the Red Flag Warning ends and SCE begins patrols. PoweruP will rank the six circuits with Medical Baseline need first, stagger them ${P.stagger_h} h apart (assumed), and show for each the peak at pickup without PoweruP and with PoweruP against the cap.</p>`;
  } else {
    const plan = sim.proposals.restore;
    const clock = hh => G.fmtTime(hh, { short: true }).split(', ')[1];
    list.innerHTML = plan.map(p => {
      const dec = decisions.restore[p.circuit] || 'pending';
      const restored = hour >= p.startH;
      const scaleKW = Math.max(p.withoutKW, p.capKW) * 1.06;
      const bar = (v, col) => `<span class="b" style="--cap:${(p.capKW / scaleKW * 100).toFixed(1)}%"><i style="width:${(v / scaleKW * 100).toFixed(1)}%;background:${col}"></i></span>`;
      return `<div class="plan restore">
        <div>
          <div class="ttl"><i style="background:${circColor(p.circuit)}"></i>${p.order}. ${p.circuit} <span class="pill ${dec}">${dec}</span>${restored ? '<span class="pill">grid back</span>' : ''}</div>
          <div class="meta">Restore ${G.fmtTime(p.startH)} (planned). ${p.reason}.</div>
          <div class="meta">Peak at pickup, every home at ${P.cold_load_factor}x for ${P.cold_load_hours} h (assumed):</div>
          <div class="pk">
            <span class="l">without PoweruP</span>${bar(p.withoutKW, T.muted)}<span class="v ${p.withoutUnderCap ? '' : 'over'}">${mw(p.withoutKW)}</span>
            <span class="l">with PoweruP</span>${bar(p.withKW, T['h-islanded'])}<span class="v ${p.underCap ? 'ok' : 'over'}">${mw(p.withKW)}</span>
          </div>
          <div class="meta"><span class="pill ${p.underCap ? 'pass' : 'fail'}">${p.underCap ? 'under cap' : 'over cap'}, ${Math.round(p.pctWith * 100)}%</span> with PoweruP ${fmtInt(p.withKW)} kW against a cap of ${fmtInt(p.capKW)} kW (dashed). ${p.riding} of ${fmtInt(p.customers)} homes ride through on their batteries: <b>${mw(p.reductionKW)} off the peak</b>. Recharge from ${clock(p.chargeStartH)}, Medical Baseline first, inside the headroom; until approved the batteries hold at the ${P.reserve_floor_pct}% floor and the grid carries the homes.</div>
        </div>
        <div class="acts">
          <button class="btn sm ok" id="approve-${p.circuit}" data-c="${p.circuit}" data-d="approved" ${dec === 'approved' ? 'disabled' : ''}>Approve</button>
          <button class="btn sm hold" id="hold-${p.circuit}" data-c="${p.circuit}" data-d="hold" ${dec === 'hold' ? 'disabled' : ''}>Hold</button>
        </div>
      </div>`;
    }).join('') + (plan.some(p => !p.underCap) ? `<p class="note">Where the pickup stays over the cap even with PoweruP, the batteries shrink it but ${P.adoption_pct}% adoption is not enough to bring it under the October peak; the recharge waits until the circuit is under the cap. Raise adoption in Assumptions to see every circuit pass.</p>` : '') +
      `<div class="toolbar"><button class="btn sm" id="approveAllRestore">Approve all</button><button class="btn sm" id="holdAllRestore">Hold all</button></div>`;
    list.querySelectorAll('button[data-c]').forEach(b => b.addEventListener('click', () => { decisions.restore[b.dataset.c] = b.dataset.d; resim(); }));
    $('approveAllRestore').addEventListener('click', () => { for (const c of NAMED) decisions.restore[c] = 'approved'; resim(); });
    $('holdAllRestore').addEventListener('click', () => { for (const c of NAMED) decisions.restore[c] = 'hold'; resim(); });
  }
  // EV dispatch
  const evs = sim.proposals.ev.filter(p => p.h <= hour), unmet = sim.proposals.unmet.filter(p => p.h <= hour);
  const sum = $('evSummary'), tb = $('evToolbar'), el = $('evList');
  const tryNote = `At the defaults every Medical Baseline home lasts the planned ${P.planned_outage_h} h on its critical budget (the medical device is inside it). Serra's longest shutoff on record was ${Math.round(DATA.circuits.Serra.longest_hours)} h: set the planned outage to 96 h in Assumptions to see PoweruP ask for EV trips.`;
  if (hour < RUNGS.hold) { sum.textContent = `During the shutoff, when a Medical Baseline home will not last to its planned restoration (under 20% and hours left shorter than hours to restoration), PoweruP proposes a charged EV from a nearby Tier 3 home whose own battery is above ${P.ev_donor_min_pct}%. Nothing to propose yet.`; tb.innerHTML = ''; el.innerHTML = ''; return; }
  const approved = evs.filter(p => decisions.ev[p.id] === 'approved').length;
  sum.innerHTML = `${evs.length} proposed, ${approved} approved, ${fmtInt(evs.filter(p => decisions.ev[p.id] === 'approved').reduce((s, p) => s + p.hoursBought, 0))} h bought. One trip delivers ${P.ev_trip_kwh} kWh from the EV's own pack (assumed); ${P.ev_pct}% of homes have an EV, a donor keeps at least ${P.ev_donor_min_pct}% of its own battery and is sought within ${P.ev_radius_km} km (all assumed).` +
    (unmet.length ? ` <b>${unmet.length} medical homes flagged with no donor</b>: ${unmet[0].reason}.` : '') +
    (!evs.length && !unmet.length && sim.proposals.ev.length === 0 && sim.proposals.unmet.length === 0 ? ` ${tryNote}` : '');
  tb.innerHTML = (evs.length ? `<button class="btn sm" id="approveAllEv">Approve all</button><button class="btn sm" id="holdAllEv">Hold all</button>` : '');
  if (evs.length) {
    $('approveAllEv').addEventListener('click', () => { for (const p of evs) decisions.ev[p.id] = 'approved'; resim(); });
    $('holdAllEv').addEventListener('click', () => { for (const p of evs) decisions.ev[p.id] = 'hold'; resim(); });
  }
  const show = evs.slice().sort((a, b) => b.h - a.h).slice(0, 60);
  el.innerHTML = show.map(p => {
    const dec = decisions.ev[p.id] || 'pending';
    return `<div class="plan">
      <div>
        <div class="ttl">Home ${p.medId} (${p.circuit}) <span class="pill ${dec}">${dec}</span></div>
        <div class="meta">${G.fmtTime(p.h, { short: true })}: ${p.hoursLeft.toFixed(0)} h left, ${p.toRestore} h to planned restoration. Donor home ${p.donorId} (${p.donorCircuit}), ${p.distKm.toFixed(1)} km away, ${p.kwh} kWh buys ${p.hoursBought.toFixed(0)} h${dec === 'approved' ? `, delivered ${G.fmtTime(p.h + 1, { short: true }).split(', ')[1]}` : ''}.</div>
      </div>
      <div class="acts">
        <button class="btn sm ok" id="ev-ok-${p.id}" data-id="${p.id}" data-d="approved" ${dec === 'approved' ? 'disabled' : ''}>Approve</button>
        <button class="btn sm hold" id="ev-hold-${p.id}" data-id="${p.id}" data-d="hold" ${dec === 'hold' ? 'disabled' : ''}>Hold</button>
      </div></div>`;
  }).join('') + (evs.length > 60 ? `<p class="note">${evs.length - 60} more not shown.</p>` : '');
  el.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => { decisions.ev[b.dataset.id] = b.dataset.d; resim(); }));
}

// ---------- how PoweruP decides ----------
function renderMath() {
  const body = $('mathBody');
  if (body.hidden) return;
  const K = G.KW_PER_UNIT, f = sim.fleet[hour], hod = hour % 24, c = selectedCircuit;
  const cc = sim.circuits[c], prof = world.prof[c];
  const clock = hh => G.fmtTime(hh, { short: true }).split(', ')[1];
  const modes = [P.mode_critical, P.mode_essential, P.mode_normal];
  const rows = [];
  // 1. headroom cap
  if (cc) {
    const capKW = cc.capA * K, highKW = prof.max[hod] * K, head = Math.max(0, capKW - highKW), ch = cc.chargeKW[hour];
    const off = cc.state[hour] === 1, pickup = cc.state[hour] === 2;
    rows.push([`1. Headroom cap, ${c}, ${clock(hour)}`,
      `cap = October peak ${mw(prof.peak * K)} x ${P.cold_load_cap_pct}% = <b>${mw(capKW)}</b>. headroom = cap - October high at ${clock(hour)} (${mw(highKW)}) = <b>${mw(head)}</b>${off ? ' (circuit off: 0 usable)' : pickup ? ` (cold-load pickup: ${mw(cc.headroomKW[hour])} usable)` : ''}. Fleet charging this hour ${mw(ch)} <= ${mw(cc.headroomKW[hour])}: <b>${ch <= cc.headroomKW[hour] + 1e-6 ? 'ok' : 'violated'}</b>. Allocated Tier 1 first, then 2, then 3, ${P.charge_kw} kW per home at most, on every day of the replay.${prof.borrowed ? ` Serra uses Merlin's shape x ${prof.scale.toFixed(3)}.` : ''} The cap is a ceiling on total circuit load (peak x ${P.cold_load_cap_pct}%), not a scale on the headroom. ${UNIT_NOTE}`]);
  }
  // 2. ordinary day
  rows.push([`2. Ordinary day, ${f.rung === 'none' ? 'today' : 'before the ladder'}`,
    `off-peak: charge at up to ${P.charge_kw} kW to 100% inside the headroom. on-peak ${P.on_peak_hours[0] - 12} to ${P.on_peak_hours[1] - 12} PM: discharge = min(home load, soc - floor, ${P.power_kw} kW); floor ${P.reserve_floor_pct}% = ${(P.capacity_kwh * P.reserve_floor_pct / 100).toFixed(1)} kWh (${P.ask_floor_pct}% for Tier 3 on a named circuit from Ask). saving = on-peak kWh served x ($${P.on_peak.toFixed(2)} - $${P.off_peak.toFixed(2)}). Today so far: <b>${money(f.savingsDay)}</b> fleet, $${(sim.N ? f.savingsDay / sim.N : 0).toFixed(2)} per home; a held home forfeits that: estimated missed savings today <b>${costMoney(f.readinessDay)}</b> (${fmtInt(f.byStatus[S.held] + f.byStatus[S.filling])} homes held or filling). As Base and Tesla already do.`]);
  // 3. budget mode: the inputs the engine used at the shutoff hour (charge entering it, planned length), then this hour's check
  {
    const ex = pinnedId >= 0 && world.homes[pinnedId].battery ? world.homes[pinnedId] : null;
    const size = ex ? ex.factor : 1, who = ex ? `home ${ex.id}, size ${size.toFixed(2)}` : 'an average home, size 1.00';
    const atHold = hour >= RUNGS.hold;
    // the engine sets the mode at the Hold hour from the charge the battery carried into it and the planned length
    const socAt = ex && atHold ? sim.soc[(RUNGS.hold - 1) * sim.N + ex.bi] : P.capacity_kwh;
    const left = P.planned_outage_h;
    const need = modes.map(m => m * size / 24 * left);
    let pick = 0; for (let k = 2; k >= 0; k--) if (socAt >= need[k]) { pick = k; break; }
    let nowLine = '';
    if (ex && atHold) {
      const exc = sim.circuits[ex.circuit], i = hour * sim.N + ex.bi, mNow = sim.mode[i], socNow = sim.soc[i];
      if (exc.state[hour] === 1) {
        const toR = exc.horizonH[hour] - hour, needNow = modes[mNow] * size / 24 * toR;
        nowLine = ` Now (${clock(hour)}): soc ${socNow.toFixed(1)} kWh, ${toR} h to the ${hour >= RUNGS.hand ? 'planned restoration' : 'estimate'}${exc.replans[hour] ? ' (extended after the planned length passed)' : ''}; ${G.MODES[mNow]} needs ${needNow.toFixed(1)} kWh: ${socNow >= needNow ? 'still sustainable' : mNow === 0 ? 'short, but critical is the floor' : 'short'} => <b>${G.MODES[mNow]}</b>${mNow < pick ? ` (stepped down from ${G.MODES[pick]})` : ''}.`;
      } else nowLine = ` Now (${clock(hour)}): grid back on ${ex.circuit}; the outage budget no longer applies.`;
    }
    rows.push([`3. Outage budget (${who}${atHold && ex ? `, ${socAt.toFixed(1)} kWh entering the shutoff` : ', a full battery at the shutoff'}, ${left} h planned)`,
      `set once at the shutoff: richest mode with soc >= mode x size x planned hours / 24, from ${socAt.toFixed(1)} kWh: normal ${P.mode_normal} -> ${need[2].toFixed(1)} kWh ${socAt >= need[2] ? 'yes' : 'no'}; essential ${P.mode_essential} -> ${need[1].toFixed(1)} ${socAt >= need[1] ? 'yes' : 'no'}; critical ${P.mode_critical} -> ${need[0].toFixed(1)} ${socAt >= need[0] ? 'yes' : 'no'} => <b>${G.MODES[pick]}</b>. Checked every hour after against the hours left: a mode only ever steps down, never up; if the planned length passes with the circuit still off, the estimate is extended ${P.replan_h} h (assumed) and the check repeats.${nowLine} The floor is critical, for Tier 1 too; the medical device is inside the critical budget. Hourly load = budget x the circuit's October shape; thermostat held and EV charger paused with it. A full ${P.capacity_kwh} kWh battery lasts ${(P.capacity_kwh / (P.mode_critical * size) * 24).toFixed(0)} h in critical, ${(P.capacity_kwh / (P.mode_essential * size) * 24).toFixed(0)} h in essential, ${(P.capacity_kwh / (P.mode_normal * size) * 24).toFixed(0)} h in normal.${atHold ? ` Fleet now${f.gridBack ? ', homes still off' : ''}: <b>${f.byMode[0]} critical, ${f.byMode[1]} essential, ${f.byMode[2]} normal</b> (set at the shutoff, stepped down only)${f.gridBack ? `; ${fmtInt(f.gridBack)} back on the grid, no budget` : ''}.` : ''}`]);
  }
  // 4. silent classification
  rows.push([`4. Silent batteries`,
    `channel = home internet while the grid is on; SMS until the zone's tower battery runs out (${P.cell_tower_backup_h} h + 0 to 2 h per zone, assumed); then mesh radio to the zone's Starlink node (${world.zones.filter(z => z.starlink).length} of 6 zones have one${P.mesh ? '' : '; mesh off'}); else silent. A whole zone quiet in the same hour = <b>tower down</b>; one home quiet on its own = <b>check this one</b> (${P.silent_fault_pct}% really faulted, assumed). Silent homes keep the plan signed before the shutoff. Now: <b>${f.byChan[C.silent_tower]}</b> tower down, <b>${f.byChan[C.silent_check]}</b> check this one (${f.faultsActual} faulted), ${f.zonesDown} of 6 zones down.`]);
  // 5. restoration peak check
  {
    const plan = sim.proposals.restore;
    const p = plan ? (plan.find(q => q.circuit === c) || plan[0]) : null;
    if (p) rows.push([`5. Restoration peak check, ${p.circuit} (order ${p.order}, planned)`,
      `pickup for ${P.cold_load_hours} h from ${G.fmtTime(p.startH, { short: true })} = ${P.cold_load_factor} x October high (${P.cold_load_factor}x for ${P.cold_load_hours} h and the ${P.stagger_h} h stagger are assumed). Without PoweruP: ${P.cold_load_factor} x ${mw(p.withoutKW / P.cold_load_factor)} = <b>${mw(p.withoutKW)}</b>. With PoweruP: x (1 - ${p.riding} riding / ${fmtInt(p.customers)} homes) = <b>${mw(p.withKW)}</b> (${Math.round(p.pctWith * 100)}% of cap ${mw(p.capKW)}, ${p.underCap ? 'under' : 'over'}). Reduction <b>${mw(p.reductionKW)}</b>. Recharge starts when the circuit is under the cap: ${G.fmtTime(p.chargeStartH, { short: true })}, Tier 1 first inside the headroom, only once the officer approves. Order: Medical Baseline need first, ${P.stagger_h} h apart from winds ease ${G.fmtTime(RUNGS.hand, { short: true })} + ${P.restore_patrol_h} h patrol${P.planned_outage_h > RUNGS.hand - RUNGS.hold + P.restore_patrol_h ? `, held to the planned ${P.planned_outage_h} h` : ''}.`]);
    else rows.push([`5. Restoration peak check (from the Hand rung, ${G.fmtTime(RUNGS.hand, { short: true })})`,
      `pickup for ${P.cold_load_hours} h = ${P.cold_load_factor} x October high at the start hour (${P.cold_load_factor}x for ${P.cold_load_hours} h and the ${P.stagger_h} h stagger are assumed). Without PoweruP: every home at ${P.cold_load_factor}x. With PoweruP: x (1 - share of homes still on battery), those ride through and draw nothing. Compared with the cap; recharge waits until the circuit is under it. First planned restoration ${G.fmtTime(Math.max(RUNGS.hand + P.restore_patrol_h, RUNGS.hold + P.planned_outage_h))}, circuits ${P.stagger_h} h apart. ${UNIT_NOTE}`]);
  }
  body.innerHTML = rows.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('');
}
$('mathBtn').addEventListener('click', () => { const b = $('mathBody'); b.hidden = !b.hidden; $('mathBtn').textContent = b.hidden ? 'Open' : 'Close'; $('mathBtn').setAttribute('aria-expanded', String(!b.hidden)); renderMath(); });

// ---------- assumptions drawer ----------
const A = DATA.assumptions;
const CONTROLS = [
  { k: 'planned_outage_h', label: 'Planned outage length', unit: ' h', min: 12, max: 168, step: 1, hi: true, note: `PoweruP sizes every outage budget to this at the shutoff, and the simulated restoration waits at least this long. 62 h = Oct 15 16:00 to Oct 18 06:00 (winds ease Oct 17 20:00 plus 10 h patrol). Shorter than that and the estimate passes with the circuits still off: PoweruP then extends it 24 h, steps budgets down and flags medical homes that will not last. Serra's longest shutoff on record was ${Math.round(DATA.circuits.Serra.longest_hours)} h; try 96 h to see PoweruP ask for EV trips.` },
  { k: 'adoption_pct', label: 'Battery adoption', unit: '%', min: A.adoption_pct.min, max: A.adoption_pct.max, step: 1, note: A.adoption_pct.note },
  { k: 'medical_baseline_pct', label: 'Medical Baseline share', unit: '%', min: A.medical_baseline_pct.min, max: A.medical_baseline_pct.max, step: 1, note: A.medical_baseline_pct.note },
  { k: 'tier2_pct', label: 'Tier 2 registered critical need', unit: '%', min: 0, max: 30, step: 1, note: 'Well pumps, infants, elderly. Assumed.' },
  { k: 'daily_use_kwh', label: 'Daily use per home', unit: ' kWh', min: A.daily_use_kwh.min, max: A.daily_use_kwh.max, step: 1, note: A.daily_use_kwh.source },
  { k: 'battery', label: 'Base Core battery', numbers: [['capacity_kwh', 'kWh'], ['power_kw', 'kW out'], ['charge_kw', 'kW grid charge']], note: A.battery.source + '. Grid charge rate capped at 10 kW per home, assumed.' },
  { k: 'reserve_floor_pct', label: 'Reserve floor', unit: '%', min: 5, max: 50, step: 1, note: 'Backup floor kept during everyday arbitrage. Base keeps 20% today.' },
  { k: 'ask_floor_pct', label: 'Raised floor at Ask (Tier 3)', unit: '%', min: 20, max: 90, step: 5, note: 'Gentle, cheap, reversible. Assumed.' },
  { k: 'consent_pct', label: 'Tier 3 consent to pre-fill', unit: '%', min: 0, max: 100, step: 5, note: 'Share consenting within 12 h of being asked. Assumed.' },
  { k: 'budget', label: 'Outage budget modes, kWh/day', numbers: [['mode_critical', 'critical'], ['mode_essential', 'essential'], ['mode_normal', 'normal']], ordered: true, note: A.budget_modes.note + ' For an average home; each home\'s own budget scales with its size factor (0.6 to 1.6, seeded), assumed. The medical device is inside the critical budget.' },
  { k: 'cell_tower_backup_h', label: 'Cell tower backup', unit: ' h', min: A.cell_tower_backup_h.min, max: A.cell_tower_backup_h.max, step: 1, note: A.cell_tower_backup_h.note },
  { k: 'mesh', label: 'Neighbourhood mesh to Starlink', toggle: true, note: 'Mesh radio in each tower zone, one Starlink uplink per zone; 5 of 6 zones have one (seeded). Off shows what the mesh buys.' },
  { k: 'silent_fault_pct', label: 'Silent batteries really faulted', unit: '%', min: 0, max: 10, step: 0.5, note: A.silent_fault_pct.note },
  { k: 'dropout_pct', label: 'Isolated comms dropouts', unit: '%', min: 0, max: 10, step: 0.5, note: 'Homes that lose their own link for a few hours. Assumed.' },
  { k: 'restore_patrol_h', label: 'Patrol before first restoration', unit: ' h', min: 4, max: 24, step: 1, note: A.restore_patrol_h.note },
  { k: 'cold_load_cap_pct', label: 'Load cap, share of October peak', unit: '%', min: 70, max: 100, step: 1, note: A.cold_load_cap_pct.note + ' The cap is a ceiling on total circuit load (October peak x this share); headroom = cap minus the hour\'s October high. Capped at 100% so the fleet never pushes a circuit above its October peak.' },
  { k: 'ev_pct', label: 'Homes with an EV', unit: '%', min: 0, max: 80, step: 5, note: 'Assumed. One trip delivers the kWh below from the EV pack.' },
  { k: 'ev_donor_min_pct', label: 'Donor battery minimum', unit: '%', min: 20, max: 100, step: 5, note: 'A Tier 3 home lends its EV only if its own battery is above this. 55% leaves it more than a day of its own budget. Assumed.' },
  { k: 'ev_trip_kwh', label: 'kWh per EV trip', unit: ' kWh', min: 5, max: 30, step: 1, note: 'Assumed.' },
  { k: 'tou', label: 'TOU rates, $/kWh', numbers: [['on_peak', 'on-peak'], ['off_peak', 'off-peak']], step: 0.01, note: A.tou.note },
  { k: 'fixed', label: 'Fixed assumptions (not in the data pack)', fixed: true, note: () => `Cold load pickup ${P.cold_load_factor}x the October high for ${P.cold_load_hours} h after restoration; circuits restored ${P.stagger_h} h apart; EV donor sought within ${P.ev_radius_km} km; thermostat held at 78\u00b0F in the heat advisory; consent asked within 12 h; tower battery jitter 0 to 2 h per zone; restoration estimate extended ${P.replan_h} h when it passes; on-peak ${pmRange(P.on_peak_hours)}. All assumed.` }
];
function buildDrawer() {
  const d = $('drawer');
  d.innerHTML = `<p class="note" id="drawerDelta" hidden></p>` + CONTROLS.map(c => {
    if (c.fixed) return `<div class="ctl row"><label>${c.label}</label><span class="val"></span><span class="n">${c.note()}</span></div>`;
    if (c.toggle) return `<div class="ctl row"><label for="a-${c.k}">${c.label}</label><label class="switch" for="a-${c.k}"><input type="checkbox" id="a-${c.k}" ${P[c.k] ? 'checked' : ''}><span class="val" id="v-${c.k}">${P[c.k] ? 'on' : 'off'}</span></label><span class="n">${c.note}</span></div>`;
    if (c.numbers) return `<div class="ctl row"><label>${c.label}</label><span class="numbers">${c.numbers.map(([k, u]) => `<label for="a-${k}"><input type="number" id="a-${k}" value="${P[k]}" step="${c.step || 1}" min="0"> ${u}</label>`).join('')}</span><span class="n" id="n-${c.k}">${c.note}</span></div>`;
    return `<div class="ctl${c.hi ? ' hi' : ''}"><label for="a-${c.k}">${c.label}</label><span class="val" id="v-${c.k}">${P[c.k]}${c.unit}</span><input type="range" id="a-${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${P[c.k]}"><span class="n">${c.note}</span></div>`;
  }).join('');
  let timer = null;
  const schedule = k => { clearTimeout(timer); timer = setTimeout(() => { const before = snapshotHour(); run(); renderAll(); reportDelta(before, k); }, 150); };
  for (const c of CONTROLS) {
    if (c.fixed) continue;
    if (c.numbers) {
      for (const [k] of c.numbers) $('a-' + k).addEventListener('change', e => {
        let v = parseFloat(e.target.value); if (!isFinite(v) || v < 0) { e.target.value = P[k]; return; }
        if (c.ordered) {
          // the modes must ascend (critical <= essential <= normal): the edited value is clamped to its neighbours and the note says so
          const keys = c.numbers.map(x => x[0]), i = keys.indexOf(k);
          const lo = i > 0 ? P[keys[i - 1]] : 0, hi = i < keys.length - 1 ? P[keys[i + 1]] : Infinity;
          const w = Math.min(hi, Math.max(lo, v));
          const n = $('n-' + c.k);
          if (w !== v) { n.innerHTML = `${c.note} <b>${c.numbers[i][1]} ${v} kept at ${w}: the modes must stay in order, critical <= essential <= normal.</b>`; v = w; e.target.value = v; }
          else n.textContent = c.note;
        }
        P[k] = v; schedule(k);
      });
      continue;
    }
    const el = $('a-' + c.k);
    if (c.toggle) el.addEventListener('change', e => { P[c.k] = e.target.checked; $('v-' + c.k).textContent = e.target.checked ? 'on' : 'off'; schedule(c.k); });
    else el.addEventListener('input', e => { P[c.k] = parseFloat(e.target.value); $('v-' + c.k).textContent = P[c.k] + c.unit; schedule(c.k); });
  }
}
// a fingerprint of the whole run (every hour's power, states, charge, EV figures, charging per circuit, plans, money), so the drawer can say
// when a control changed nothing anywhere, not only nothing at the current hour
function runFingerprint() {
  let a = 0;
  for (const f of sim.fleet) { a = (a * 31 + f.power + f.socSum * 7 + f.byStatus.reduce((s, v, i) => s + v * (i + 1), 0) * 3 + f.evProposed * 11 + f.unmet * 13) % 1e12; }
  for (const c of NAMED) { const cc = sim.circuits[c]; let s = 0; for (let h = 0; h < HOURS; h++) s += cc.chargeKW[h]; a = (a * 31 + s) % 1e12; }
  const r0 = sim.proposals.restore[0];
  return `${a.toFixed(3)}|${sim.N}|${Math.round(sim.totals.savings)}|${Math.round(sim.totals.readiness)}|${r0 ? r0.startH : -1}|${sim.proposals.ev.length}|${sim.proposals.unmet.length}`;
}
// what a judge sees change at this hour after a re-run, so a slider that changes nothing here says so
function snapshotHour() { const f = sim.fleet[hour]; return { run: runFingerprint(), N: sim.N, power: f.power, mb: f.mbPower, modes: f.byMode.join('/'), st: f.byStatus.join('/'), soc: f.socPct.toFixed(1), ev: f.evProposed, unmet: f.unmet, sav: Math.round(f.savingsCum), rdy: Math.round(f.readinessCum), restore: sim.proposals.restore[0] ? sim.proposals.restore[0].startH : -1 };
}
function reportDelta(before, key) {
  const el = $('drawerDelta'); if (!el) return;
  const after = snapshotHour(), diffs = [];
  if (after.N !== before.N) diffs.push(`battery homes ${fmtInt(before.N)} -> ${fmtInt(after.N)}`);
  if (after.power !== before.power) diffs.push(`with power ${fmtInt(before.power)} -> ${fmtInt(after.power)}`);
  if (after.mb !== before.mb) diffs.push(`Medical Baseline with power ${before.mb} -> ${after.mb}`);
  if (after.modes !== before.modes) diffs.push(`budget modes ${before.modes} -> ${after.modes}`);
  else if (after.st !== before.st) diffs.push('battery states changed');
  if (after.soc !== before.soc) diffs.push(`fleet soc ${before.soc}% -> ${after.soc}%`);
  if (after.ev !== before.ev || after.unmet !== before.unmet) diffs.push(`EV proposals ${before.ev} -> ${after.ev}, unmet ${before.unmet} -> ${after.unmet}`);
  if (after.sav !== before.sav) diffs.push(`savings since Oct 7 ${money(before.sav)} -> ${money(after.sav)}`);
  if (after.rdy !== before.rdy) diffs.push(`readiness cost ${money(before.rdy)} -> ${money(after.rdy)}`);
  if (after.restore !== before.restore) diffs.push(`first restoration ${after.restore < 0 ? 'none' : G.fmtTime(after.restore, { short: true })}`);
  el.hidden = false;
  const evKey = ['ev_pct', 'ev_donor_min_pct', 'ev_trip_kwh'].includes(key);
  el.innerHTML = diffs.length ? `Re-ran ${HOURS} h. At ${G.fmtTime(hour, { short: true })}: ${diffs.join('; ')}.`
    : after.run !== before.run ? `Re-ran ${HOURS} h. No change at ${G.fmtTime(hour, { short: true })}: this number acts at other hours (scrub, or jump to Fill, Hold or Hand), or in the plan and money figures.`
    : `Re-ran ${HOURS} h. No change anywhere in this run with the current settings.${evKey ? ` The EV controls act once a Medical Baseline home will not last to its planned restoration: set the planned outage longer than about 74 h.` : ''}`;
}
function syncDrawer() {
  for (const c of CONTROLS) {
    if (c.fixed) continue;
    if (c.numbers) { for (const [k] of c.numbers) $('a-' + k).value = P[k]; continue; }
    const el = $('a-' + c.k);
    if (c.toggle) { el.checked = !!P[c.k]; $('v-' + c.k).textContent = P[c.k] ? 'on' : 'off'; }
    else { el.value = P[c.k]; $('v-' + c.k).textContent = P[c.k] + c.unit; }
  }
}
$('drawerBtn').addEventListener('click', () => { const d = $('drawer'); d.hidden = !d.hidden; $('drawerBtn').textContent = d.hidden ? 'Open' : 'Close'; $('drawerBtn').setAttribute('aria-expanded', String(!d.hidden)); });
$('resetBtn').addEventListener('click', () => { P = G.defaultParams(DATA); for (const k of Object.keys(decisions.restore)) delete decisions.restore[k]; for (const k of Object.keys(decisions.ev)) delete decisions.ev[k]; syncDrawer(); run(); renderAll(); const d = $('drawerDelta'); if (d) d.hidden = true; });

// ---------- static sections ----------
function buildStatic() {
  const states = [[S.normal, 'ordinary day'], [S.watch, 'watch'], [S.held, 'held at 100%'], [S.filling, 'filling'], [S.islanded, 'islanded'], [S.restoring, 'recharging'], [S.standby, 'grid on, recharge pending'], [S.empty, 'empty'], [S.fault, 'fault']];
  $('legendStates').innerHTML = states.map(([st, n]) => `<li><span class="sw" style="background:${statusColor(st)}"></span>${n}</li>`).join('') +
    `<li><span class="sw ring"></span>silent, tower down</li><li><span class="sw ring check"></span>silent, check</li><li><span class="sw diamond" style="background:${T['h-held']}"></span>Medical Baseline (demo)</li><li><span class="sw plain" style="background:${T['h-plain']}"></span>home, no battery</li>`;
  $('legendCircuits').innerHTML = Object.keys(DATA.circuits).map(c => `<button data-c="${c}" id="leg-${c}" aria-pressed="${c === selectedCircuit}" title="${DATA.circuits[c].named_oct_2026 ? `Select ${c}` : `${c}: not named this event, drawn grey for context (its line lies outside the default view)`}"><i style="background:${circColor(c)}"></i>${c}</button>`).join('');
  $('legendCircuits').querySelectorAll('button').forEach(b => b.addEventListener('click', () => selectCircuit(b.dataset.c, true)));
  $('circuitSel').innerHTML = Object.keys(DATA.circuits).map(c => `<option value="${c}">${c}${DATA.circuits[c].named_oct_2026 ? '' : ' (context)'}</option>`).join('');
  $('circuitSel').value = selectedCircuit;
  const pa = [
    ['Pre-charge before a shutoff, Medical Baseline first', 'Tesla Storm Watch fills Powerwalls on NWS watches and warnings (active in PG&E\'s Oct 2019 shutoffs). Base says its battery holds more charge and pulls back from grid activity before forecast outages. SCE gives Medical Baseline customers in fire areas a free portable battery.', 'From Step 2 the trigger is SCE\'s own circuit list, targeted to those circuits and ordered by medical need; Step 1 uses the NWS signal as Storm Watch does, but only for Medical Baseline homes. Storm Watch treats every home the same.'],
    ['Per-home outage energy budget', 'SPAN sheds "nice to have" circuits when the battery falls below 50%. Base\'s storm guide tells owners to switch off heavy loads.', 'A budget sized to the expected shutoff length for that circuit, with the home told up front what it can run and for how long.'],
    ['Staggered recharge after restoration', 'IEEE 1547-2018 makes inverters wait 300 s and ramp output on reconnection. Cold load pickup with demand response is patented (US 8,600,573). Base says the battery simply resumes VPP operation on restoration.', 'The 1547 rule governs output, not recharge draw. No VPP found staggers a fleet\'s recharge after a shutoff.'],
    ['Utility-approved restoration plan as the human step', 'Not found. Utilities sequence restoration themselves.', 'A battery fleet plan that a shutoff officer signs off before the batteries act.'],
    ['Silent batteries that follow a plan alone', 'California\'s IEEE 2030.5 profile (CSIP 4.4.2): a device on lost comms completes any scheduled event, then reverts to defaults.', 'Pushing the whole shutoff plan down before cell towers fail, then classifying silence as comms-down or broken.'],
    ['Neighbourhood mesh radio with a Starlink uplink', 'Exists, not for batteries: Meshtastic for wildfire crews, Starlink for community brigades.', 'Using that link to carry battery plans and status.'],
    ['Daily time-of-use arbitrage with a backup floor', 'Base keeps a 20% floor during market dispatch. Sunrun runs a 5 MW VPP for SCE. Tesla offers this on every Powerwall.', 'Nothing new. The everyday half of dual-use, credited to Base and Tesla.']
  ];
  $('paRows').innerHTML = `<div class="row head" style="border-top:0;padding-top:0"><div class="lab">PoweruP piece</div><div class="lab">Who does something close today</div><div class="lab">What PoweruP adds</div></div>` +
    pa.map(r => `<div class="row"><div class="piece">${r[0]}</div><div class="today"><span class="lab">Who does something close today</span>${r[1]}</div><div class="adds"><span class="lab">What PoweruP adds</span>${r[2]}</div></div>`).join('');
  $('srcList').innerHTML = DATA.sources.map(s => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a> <span class="muted">${s.used}</span></li>`).join('');
}

function renderAll() {
  resizeTl();
  renderHour();
  needsDraw = true;
}
// desktop: the map takes what is left of the viewport after the header, the ladder and the timeline (measured, with one spare bulletin line)
function fitMap() {
  if (window.innerWidth < 900) {
    // phone: the map takes what is left between the ladder and the sticky timeline, so the whole map shows on the first frame
    const top = mapWrap.getBoundingClientRect().top + window.scrollY;
    mapWrap.style.setProperty('--chrome', (top + $('timeline').offsetHeight + 8) + 'px');
    return;
  }
  const chrome = $('app').querySelector('.hdr').offsetHeight + 12 + $('ladder').offsetHeight + 12 + $('timeline').offsetHeight + 10 + 18;
  mapWrap.style.setProperty('--chrome', chrome + 'px');
  $('bulletin').removeAttribute('title');
}

// ---------- theme ----------
const themeBtn = $('themeBtn');
const themeModes = ['light', 'dark'];
const THEME_ICON = { auto: '\u25d0', dark: '\u263e', light: '\u2600' };
// desktop: "Theme: auto"; phone: the icon alone (the label stays in aria-label and title) so the clock row never wraps
function labelTheme() {
  const cur = document.documentElement.dataset.theme || 'auto';
  themeBtn.textContent = isPhone() ? THEME_ICON[cur] : 'Theme: ' + cur;
  themeBtn.setAttribute('aria-label', 'Theme: ' + cur); themeBtn.title = `Theme: ${cur} (click to change)`;
}
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || 'auto';
  const next = themeModes[(themeModes.indexOf(cur) + 1) % themeModes.length];
  if (next === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
  try { localStorage.setItem('powerup-theme', next); } catch (_) {}
  labelTheme();
});
labelTheme();
function onTheme() { readTokens(); buildStatic(); renderAll(); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
reduceMotion.addEventListener('change', () => { needsDraw = true; });

// ---------- boot ----------
readTokens();
prepGeometry();
run();
buildDrawer();
buildStatic();
$('circuitSel').addEventListener('change', e => selectCircuit(e.target.value, false));
if (window.innerWidth < 900) { $('mathBody').hidden = true; $('mathBtn').textContent = 'Open'; $('mathBtn').setAttribute('aria-expanded', 'false'); $('bulletin').title = 'Tap to expand'; }
const hash = (location.hash || '').slice(1);
if (RUNGS[hash] !== undefined) hour = RUNGS[hash];
else if (hash === 'ordinary') hour = ORDINARY_H;
resize();
renderAll();
fitMap();
// the legend starts closed on phone and wherever the map is under 400 px tall (it would cover a quarter of the homes); the button opens it
if (window.innerWidth < 700 || mapWrap.getBoundingClientRect().height < 400) { $('legend').hidden = true; $('legendBtn').setAttribute('aria-pressed', 'false'); }
new ResizeObserver(() => { resize(); resizeTl(); drawSocChart(); drawLoadChart(); }).observe(mapWrap);
let fitTimer = null;
const refit = new ResizeObserver(() => { cancelAnimationFrame(fitTimer); fitTimer = requestAnimationFrame(fitMap); });
for (const el of [$('app').querySelector('.hdr'), $('ladder'), $('timeline')]) refit.observe(el);
window.addEventListener('resize', () => { labelTheme(); fitMap(); resizeTl(); drawSocChart(); drawLoadChart(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) togglePlay(false); });
requestAnimationFrame(frame);
// small hook for the Playwright checks
window.PowerupReplayUI = { get selectedCircuit() { return selectedCircuit; }, get hour() { return hour; }, get view() { return view; }, get sim() { return sim; }, get world() { return world; }, get P() { return P; }, toPx, decisions, setHour, nearestHome, nearestLine };
})();
