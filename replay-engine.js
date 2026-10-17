
/* PoweruP engine: pure functions. Works in the browser (window.PoweruP) and in node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PowerupReplayEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- constants ----------
  const HOURS = 282;                 // 2026-10-07 00:00 .. 2026-10-18 17:00 Pacific (window ends Oct 18 18:00)
  const T0_DAY = 7;                  // October 7
  const KW_PER_UNIT = 27.7;          // assumed: SCE load units read as amps per phase at 16 kV
  const NAMED = ['Galahad', 'Maguire', 'Cuthbert', 'Merlin', 'Serra', 'Tuna'];
  // standby: the circuit is back but the recharge plan is not yet approved; the battery holds at the reserve floor
  // and the grid carries the home (no grid draw for the battery)
  const STATUS = ['normal', 'watch', 'held', 'filling', 'islanded', 'empty', 'silent', 'fault', 'restoring', 'standby'];
  const S = {}; STATUS.forEach((s, i) => { S[s] = i; });
  const CHAN = ['internet', 'sms', 'mesh', 'silent_tower', 'silent_check', 'none'];
  const C = {}; CHAN.forEach((s, i) => { C[s] = i; });
  const MODES = ['critical', 'essential', 'normal'];
  const KM_PER_DEG_LAT = 110.57;
  const LAT0 = 34.09;
  const KM_PER_DEG_LON = 111.32 * Math.cos(LAT0 * Math.PI / 180);

  // ---------- prng ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- time ----------
  // "2026-10-DD HH:MM" -> fractional hour index since Oct 7 00:00
  function hourOf(t) {
    const d = +t.slice(8, 10), hh = +t.slice(11, 13), mm = +t.slice(14, 16);
    return (d - T0_DAY) * 24 + hh + mm / 60;
  }
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dateParts(h) {
    const day = Math.floor(h / 24), hour = h - day * 24;
    const dom = T0_DAY + day;                 // Oct 7 2026 is a Wednesday
    const wd = WD[(3 + day) % 7];
    return { dom, hour, wd, day };
  }
  function fmtTime(h, opts) {
    const p = dateParts(h);
    const hr = Math.floor(p.hour), mn = Math.round((p.hour - hr) * 60);
    const h12 = ((hr + 11) % 12) + 1, ap = hr < 12 ? 'AM' : 'PM';
    const t = mn ? `${h12}:${String(mn).padStart(2, '0')} ${ap}` : `${h12}:00 ${ap}`;
    if (opts && opts.short) return `${p.wd} ${p.dom}, ${t}`;
    return `${p.wd} Oct ${p.dom}, ${t}`;
  }
  function fmt24(h) {
    const p = dateParts(h);
    const hr = Math.floor(p.hour), mn = Math.round((p.hour - hr) * 60);
    return `Oct ${p.dom} ${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
  }

  // ---------- geometry ----------
  function toKm(lon, lat, bbox) {
    return [(lon - bbox[0]) * KM_PER_DEG_LON, (bbox[3] - lat) * KM_PER_DEG_LAT];
  }
  function coastLatAt(coast, lon) {
    if (lon <= coast[0][0]) return coast[0][1];
    for (let i = 1; i < coast.length; i++) {
      if (lon <= coast[i][0]) {
        const a = coast[i - 1], b = coast[i], f = (lon - a[0]) / (b[0] - a[0] || 1e-9);
        return a[1] + (b[1] - a[1]) * f;
      }
    }
    return coast[coast.length - 1][1];
  }
  // polygon in lon/lat for an approximate band from near to far miles inland of the coast
  function bandPolygon(area, coast, n) {
    n = n || 12;
    const [w, e] = area.lon, [near, far] = area.inland_mi;
    const mi2deg = 1.609344 / KM_PER_DEG_LAT;
    const top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const lon = w + (e - w) * i / n, cl = coastLatAt(coast, lon);
      bot.push([lon, cl + near * mi2deg]);
      top.push([lon, cl + far * mi2deg]);
    }
    return bot.concat(top.reverse());
  }
  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // ---------- defaults from the data pack ----------
  function defaultParams(DATA) {
    const a = DATA.assumptions;
    return {
      capacity_kwh: a.battery.capacity_kwh,
      power_kw: a.battery.power_kw,
      charge_kw: 10,
      reserve_floor_pct: a.battery.reserve_floor_pct,
      adoption_pct: a.adoption_pct.default,
      medical_baseline_pct: a.medical_baseline_pct.default,
      tier2_pct: 10,
      daily_use_kwh: a.daily_use_kwh.default,
      mode_critical: a.budget_modes.critical,
      mode_essential: a.budget_modes.essential,
      mode_normal: a.budget_modes.normal,
      cell_tower_backup_h: a.cell_tower_backup_h.default,
      silent_fault_pct: a.silent_fault_pct.default,
      dropout_pct: 2,
      restore_patrol_h: a.restore_patrol_h.default,
      cold_load_cap_pct: a.cold_load_cap_pct.default,
      on_peak: a.tou.on_peak,
      off_peak: a.tou.off_peak,
      on_peak_hours: a.tou.on_peak_hours.slice(),
      planned_outage_h: 62,
      mesh: true,
      ev_pct: 25,
      ev_donor_min_pct: 55,
      ev_trip_kwh: 10,
      ev_radius_km: 6,                // assumed: a donor EV is sought within this distance
      replan_h: 24,                   // assumed: when a planned restoration passes with the circuit still off, extend the estimate by this
      consent_pct: 90,
      ask_floor_pct: 50,
      cold_load_factor: 1.5,
      cold_load_hours: 2,
      stagger_h: 1,
      seed: 20261015
    };
  }

  // rung hours from the timeline (first hour step at or after the event)
  function rungHours(DATA) {
    const r = {};
    for (const ev of DATA.timeline) if (ev.rung) r[ev.rung] = Math.ceil(hourOf(ev.t));
    return r;
  }

  // October max shape per circuit, Serra borrows Merlin's
  function circuitProfiles(DATA) {
    const prof = {};
    for (const c of NAMED) {
      const src = DATA.circuits[c].load_usable ? c : 'Merlin';
      const max = DATA.load[src].max[9].slice(), min = DATA.load[src].min[9].slice();
      let scale = 1;
      if (src !== c) scale = DATA.circuits[c].customers / DATA.circuits[src].customers;
      const mx = max.map(v => v * scale), mn = min.map(v => v * scale);
      const sum = mx.reduce((a, b) => a + b, 0);
      prof[c] = { max: mx, min: mn, peak: Math.max.apply(null, mx), shape: mx.map(v => v / sum), borrowed: src !== c ? src : null, scale };
    }
    return prof;
  }

  // hours a charge lasts when the hourly budget follows the circuit's shape: walk forward from the next hour
  // (hourOfDay is the hour just served) until the charge is spent; fractional in the last hour. Beyond maxH the
  // walk continues at the flat daily rate.
  function hoursLeftWalk(socKwh, perDayKwh, shape, hourOfDay, maxH) {
    maxH = maxH || 240;
    if (!(socKwh > 0)) return 0;
    if (!(perDayKwh > 0)) return Infinity;
    let s = socKwh;
    for (let k = 1; k <= maxH; k++) {
      const need = perDayKwh * shape[(hourOfDay + k) % 24];
      if (s < need) return k - 1 + (need > 0 ? s / need : 1);
      s -= need;
    }
    return maxH + s / (perDayKwh / 24);
  }

  // ---------- homes ----------
  function buildHomes(DATA, P) {
    const rng = mulberry32(P.seed);
    const bbox = DATA.meta.bbox;
    const homes = [];
    const prof = circuitProfiles(DATA);
    const jitterKm = 0.04;
    for (const c of NAMED) {
      const n = DATA.circuits[c].customers;
      const lines = DATA.lines[c];
      if (lines && lines.length) {
        // cumulative segment lengths
        const segs = [];
        let total = 0;
        for (const pl of lines) for (let i = 1; i < pl.length; i++) {
          const a = toKm(pl[i - 1][0], pl[i - 1][1], bbox), b = toKm(pl[i][0], pl[i][1], bbox);
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L > 0) { total += L; segs.push({ a, b, cum: total }); }
        }
        for (let k = 0; k < n; k++) {
          const r = rng() * total;
          let lo = 0, hi = segs.length - 1;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].cum < r) lo = mid + 1; else hi = mid; }
          const s = segs[lo], f = rng();
          const x = s.a[0] + (s.b[0] - s.a[0]) * f + (rng() * 2 - 1) * jitterKm;
          const y = s.a[1] + (s.b[1] - s.a[1]) * f + (rng() * 2 - 1) * jitterKm;
          homes.push({ id: homes.length, circuit: c, x, y });
        }
      } else {
        const poly = bandPolygon(DATA.approx_areas[c], DATA.coast, 16);
        const lons = poly.map(p => p[0]), lats = poly.map(p => p[1]);
        const w = Math.min.apply(null, lons), e = Math.max.apply(null, lons), s0 = Math.min.apply(null, lats), n0 = Math.max.apply(null, lats);
        let k = 0, guard = 0;
        while (k < n && guard < n * 50) {
          guard++;
          const lon = w + rng() * (e - w), lat = s0 + rng() * (n0 - s0);
          if (pointInPoly([lon, lat], poly)) {
            const p = toKm(lon, lat, bbox);
            homes.push({ id: homes.length, circuit: c, x: p[0], y: p[1] });
            k++;
          }
        }
      }
    }
    // zones: 6 equal-count bands by longitude (x)
    const order = homes.map((h, i) => i).sort((i, j) => homes[i].x - homes[j].x);
    const zoneEdges = [];
    for (let z = 1; z < 6; z++) zoneEdges.push(homes[order[Math.floor(order.length * z / 6)]].x);
    for (let i = 0; i < order.length; i++) homes[order[i]].zone = Math.min(5, Math.floor(i * 6 / order.length));
    // batteries, tiers, factors
    const rng2 = mulberry32(P.seed + 1);
    const nBat = [];
    for (const h of homes) {
      h.battery = rng2() * 100 < P.adoption_pct;
      h.lon = bbox[0] + h.x / KM_PER_DEG_LON;
      h.lat = bbox[3] - h.y / KM_PER_DEG_LAT;
      if (!h.battery) continue;
      const u = rng2() * 100;
      h.tier = u < P.medical_baseline_pct ? 1 : (u < P.medical_baseline_pct + P.tier2_pct ? 2 : 3);
      // lognormal-ish factor in 0.6..1.6
      const g = (rng2() + rng2() + rng2()) / 3;          // 0..1, bell-shaped
      h.factor = 0.6 + Math.pow(g, 1.3) * 1.0;
      h.ev = rng2() * 100 < P.ev_pct;
      const consents = rng2() * 100 < P.consent_pct;
      h.consentDelay = consents ? rng2() * 12 : Infinity;
      h.faulty = rng2() * 100 < P.silent_fault_pct;
      h.faultAfter = 1 + Math.floor(rng2() * 24);          // hours after shutoff
      h.dropout = rng2() * 100 < P.dropout_pct;
      h.dropStart = 4 + Math.floor(rng2() * 36);
      h.dropLen = 4 + Math.floor(rng2() * 12);
      h.bi = nBat.length;
      nBat.push(h);
    }
    // zone facts: starlink in 5 of 6 (seeded), tower jitter, main circuit per zone
    const rng3 = mulberry32(P.seed + 2);
    const noStarlink = Math.floor(rng3() * 6);
    const zones = [];
    for (let z = 0; z < 6; z++) {
      const members = homes.filter(h => h.zone === z);
      const byC = {};
      for (const h of members) byC[h.circuit] = (byC[h.circuit] || 0) + 1;
      let main = NAMED[0], best = -1;
      for (const c of NAMED) if ((byC[c] || 0) > best) { best = byC[c] || 0; main = c; }
      const xs = members.map(h => h.x);
      zones.push({
        id: z, starlink: z !== noStarlink, jitter: Math.floor(rng3() * 3), mainCircuit: main,
        count: members.length, batteries: members.filter(h => h.battery).length,
        x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), byCircuit: byC
      });
    }
    return { homes, batteries: nBat, zones, zoneEdges, prof, bbox };
  }

  // ---------- simulation ----------
  // decisions: { restore: {circuit: 'approved'|'hold'}, ev: {id: 'approved'|'hold'} }
  function simulate(DATA, world, P, decisions) {
    decisions = decisions || { restore: {}, ev: {} };
    const R = rungHours(DATA);
    const watchH = R.watch, askH = R.ask, fillH = R.fill, holdH = R.hold, handH = R.hand;
    const bat = world.batteries, N = bat.length, prof = world.prof, zones = world.zones;
    const cap = P.capacity_kwh, floorKwh = cap * P.reserve_floor_pct / 100, askFloor = cap * P.ask_floor_pct / 100;
    const modes = [P.mode_critical, P.mode_essential, P.mode_normal];
    const onPk = P.on_peak_hours, dPrice = P.on_peak - P.off_peak;
    const namedH = {};
    for (const c of NAMED) namedH[c] = DATA.circuits[c].named_on === '2026-10-12' ? askH : fillH;

    const soc = new Float32Array(HOURS * N), status = new Uint8Array(HOURS * N), mode = new Uint8Array(HOURS * N), chan = new Uint8Array(HOURS * N);
    const flags = new Uint8Array(HOURS * N); // bit1 thermostat hold, bit2 EV paused, bit4 consented, bit8 grid power at home
    const cur = new Float32Array(N); for (let i = 0; i < N; i++) cur[i] = cap * 0.9;  // start the window at 90%
    const curMode = new Uint8Array(N);
    const curStatus = new Uint8Array(N);
    const evCredit = new Float32Array(N);    // kWh arriving next hour
    const lastProposal = new Int16Array(N).fill(-1000);
    const donorBusyUntil = new Int16Array(N).fill(-1);

    const circ = {};
    for (const c of NAMED) circ[c] = {
      name: c, restoreH: Infinity, plannedRestoreH: holdH + P.planned_outage_h,
      chargeKW: new Float32Array(HOURS), gridA: new Float32Array(HOURS), baseA: new Float32Array(HOURS), state: new Uint8Array(HOURS), // 0 on 1 off 2 restoring
      capA: prof[c].peak * P.cold_load_cap_pct / 100, customers: DATA.circuits[c].customers,
      members: [], headroomKW: new Float32Array(HOURS),
      // the restoration estimate PoweruP budgeted to at each hour, and how many times the estimate has been extended
      horizonH: new Int16Array(HOURS), replans: new Uint8Array(HOURS), replanAt: []
    };
    for (const h of bat) circ[h.circuit].members.push(h.bi);
    const byCircuitTier = {};
    for (const c of NAMED) byCircuitTier[c] = [[], [], []];
    for (const h of bat) byCircuitTier[h.circuit][h.tier - 1].push(h.bi);

    const fleet = [];
    const proposals = { restore: [], ev: [], unmet: [] };
    let restorePlan = null;
    const totals = { savings: 0, readiness: 0, protectedHours: 0, mbHours: 0, evProposed: 0, evApproved: 0, evHoursBought: 0, unmet: 0 };
    const zoneTowerDown = new Uint8Array(6);
    const dayAgg = { day: -1, savings: 0, readiness: 0 };
    const narrative = new Array(HOURS);

    const perHomeLoad = (bi, hour) => P.daily_use_kwh * bat[bi].factor * prof[bat[bi].circuit].shape[hour];
    // outage budget in kWh/day for this home: the mode for an average home times the home's size factor (0.6 to 1.6),
    // so the budget follows the home's own hourly shape scaled to the mode
    const budgetKwhDay = (bi, m) => modes[m] * bat[bi].factor;

    // richest budget mode the battery can sustain for hoursLeft; the floor is critical (which holds the medical device)
    function richestMode(bi, socKwh, hoursLeft) {
      let m = 0;
      for (let k = 2; k >= 0; k--) { if (socKwh >= budgetKwhDay(bi, k) / 24 * hoursLeft) { m = k; break; } }
      return m;
    }
    // the mode is set when the circuit goes off and only steps down later if it stops being sustainable.
    // Tier 1 homes are never budgeted below critical; critical is the floor for everyone, so the floor binds only
    // when even critical will not last.
    function budgetMode(bi, socKwh, hoursLeft, first) {
      const rich = richestMode(bi, socKwh, hoursLeft);
      if (first) return rich;
      return Math.min(curMode[bi], Math.max(rich, 0));
    }
    // first restoration: winds ease + patrol, and never earlier than the planned outage length (SCE's own estimate)
    const firstRestoreH = Math.max(handH + P.restore_patrol_h, holdH + P.planned_outage_h);

    for (let h = 0; h < HOURS; h++) {
      const hour = h % 24, day = Math.floor(h / 24);
      const onPeak = hour >= onPk[0] && hour < onPk[1];
      if (dayAgg.day !== day) { dayAgg.day = day; dayAgg.savings = 0; dayAgg.readiness = 0; }
      const rung = h >= handH ? 'hand' : h >= holdH ? 'hold' : h >= fillH ? 'fill' : h >= askH ? 'ask' : h >= watchH ? 'watch' : 'none';

      // restoration plan at the hand rung
      if (h === handH) {
        const rows = NAMED.map(c => {
          const t1 = byCircuitTier[c][0];
          let low = 0, dark = 0;
          for (const bi of t1) { if (cur[bi] <= 0) dark++; else if (cur[bi] < cap * 0.2) low++; }
          return { circuit: c, t1: t1.length, low, dark, customers: circ[c].customers };
        });
        rows.sort((a, b) => (b.dark + b.low) - (a.dark + a.low) || b.t1 - a.t1 || b.customers - a.customers);
        restorePlan = rows.map((r, i) => {
          const c = r.circuit, cc = circ[c];
          const s = firstRestoreH + i * P.stagger_h;
          // battery homes expected to still hold charge at hour s ride through the cold-load window on their batteries
          // (a faulted battery keeps its frozen charge but its home is dark, so it does not ride)
          const riding = cc.members.filter(bi => cur[bi] - (s - handH) * budgetKwhDay(bi, curMode[bi]) / 24 > 0 && !(bat[bi].faulty && s >= holdH + bat[bi].faultAfter)).length;
          const share = riding / cc.customers;
          // peak at pickup: every home at cold_load_factor x the October high for cold_load_hours
          let withoutA = 0;
          for (let k = 0; k < P.cold_load_hours; k++) withoutA = Math.max(withoutA, prof[c].max[(s + k) % 24] * P.cold_load_factor);
          const withA = withoutA * (1 - share);
          // recharge waits until the circuit is under the cap after the pickup window
          let chargeStartH = s + P.cold_load_hours;
          for (let k = 0; k < 24; k++) { if (prof[c].max[(s + P.cold_load_hours + k) % 24] < cc.capA) { chargeStartH = s + P.cold_load_hours + k; break; } }
          cc.restoreH = s; cc.plannedRestoreH = s;
          // name only the non-zero parts: "2 under 20%", "1 dark", or both
          const parts = [];
          if (r.dark) parts.push(`${r.dark} dark`);
          if (r.low) parts.push(`${r.low} under 20%`);
          const reason = parts.length
            ? `${plural(r.t1, 'Medical Baseline home')}, ${parts.join(' and ')}`
            : `${plural(r.t1, 'Medical Baseline home')}, ${r.customers.toLocaleString()} customers`;
          return {
            circuit: c, order: i + 1, startH: s, reason, t1: r.t1, low: r.low, dark: r.dark, customers: cc.customers,
            withoutA, withA, capA: cc.capA, withoutKW: withoutA * KW_PER_UNIT, withKW: withA * KW_PER_UNIT, capKW: cc.capA * KW_PER_UNIT,
            reductionKW: (withoutA - withA) * KW_PER_UNIT, riding, share, underCap: withA <= cc.capA + 1e-9, withoutUnderCap: withoutA <= cc.capA + 1e-9,
            pctWithout: withoutA / cc.capA, pctWith: withA / cc.capA, chargeStartH, decision: decisions.restore[c] || 'pending'
          };
        });
        proposals.restore = restorePlan;
      }

      // circuit states and base load
      for (const c of NAMED) {
        const cc = circ[c];
        let st = 0;
        if (h >= holdH) st = h >= cc.restoreH ? (h < cc.restoreH + P.cold_load_hours ? 2 : 0) : 1;
        cc.state[h] = st;
        cc.baseA[h] = prof[c].max[hour];
        // the restoration estimate passed with the circuit still off and no plan yet (before the Hand rung):
        // extend it by replan_h so budgets step down and rule 7 keeps a real horizon, and record the re-plan
        if (st === 1 && h < handH && h >= cc.plannedRestoreH) { cc.plannedRestoreH += P.replan_h; cc.replanAt.push(h); }
        cc.horizonH[h] = h >= holdH ? Math.min(32000, cc.plannedRestoreH) : 0;
        cc.replans[h] = cc.replanAt.length;
      }
      // tower status per zone (fails backup_h + jitter after shutoff; back when the zone's main circuit is on)
      for (const z of zones) {
        const mainOn = circ[z.mainCircuit].state[h] !== 1;
        zoneTowerDown[z.id] = (h >= holdH && !mainOn && (h - holdH) >= P.cell_tower_backup_h + z.jitter) ? 1 : 0;
      }

      // per-circuit allocation of charging within headroom
      for (const c of NAMED) {
        const cc = circ[c], st = cc.state[h];
        const tiers = byCircuitTier[c];
        // riding-through battery homes reduce the grid's cold-load pickup
        let gridBase = cc.baseA[h];
        if (st === 2) {
          let riding = 0;
          for (const bi of cc.members) if (cur[bi] > 0 && !(bat[bi].faulty && h >= holdH + bat[bi].faultAfter)) riding++;
          gridBase = cc.baseA[h] * P.cold_load_factor * (1 - riding / cc.customers);
        }
        let headroomKW = st === 1 ? 0 : Math.max(0, (cc.capA - gridBase) * KW_PER_UNIT);
        cc.headroomKW[h] = headroomKW;
        let chargeKW = 0;
        const dec = decisions.restore[c];
        const approved = dec === 'approved';

        for (let t = 0; t < 3; t++) {
          const list = tiers[t], tier = t + 1;
          for (let ii = 0; ii < list.length; ii++) {
            const bi = list[ii], hm = bat[bi];
            const idx = h * N + bi;
            let s = cur[bi], stt = S.normal, fl = 0;
            const load = perHomeLoad(bi, hour);
            const faulted = hm.faulty && h >= holdH + hm.faultAfter;
            const consented = h >= namedH[c] + hm.consentDelay;
            if (consented) fl |= 4;

            if (st === 1) {
              // ---- islanded: no export, ever ----
              if (faulted) { stt = S.fault; }
              else {
                const hoursLeft = Math.max(1, cc.plannedRestoreH - h);
                const m = budgetMode(bi, s, hoursLeft, h === holdH);
                curMode[bi] = m;
                if (evCredit[bi] > 0) { s = Math.min(cap, s + evCredit[bi]); evCredit[bi] = 0; }
                const outLoad = budgetKwhDay(bi, m) * prof[c].shape[hour];
                if (s > 0) {
                  const d = Math.min(outLoad, s, P.power_kw);
                  s -= d; if (s < 1e-6) s = 0;
                  stt = s > 0 || d > 0 ? S.islanded : S.empty;
                  if (s <= 0 && d < outLoad) stt = S.empty;
                  fl |= 1 | 2; // thermostat hold, EV charger paused
                  totals.protectedHours += 1; if (hm.tier === 1) totals.mbHours += 1;
                } else stt = S.empty;
                // rule 7: medical home will not last to restoration. Hours left follow the home's hourly shape
                // (low overnight), walked forward from this hour, not a flat daily rate.
                if (hm.tier === 1 && s > 0 && s < cap * 0.2) {
                  const perDay = budgetKwhDay(bi, m), perH = perDay / 24, toRestore = cc.plannedRestoreH - h;
                  const left = hoursLeftWalk(s, perDay, prof[c].shape, hour, Math.max(24, toRestore + 24));
                  // half an hour of tolerance so a budget sized exactly to the horizon does not trip on rounding
                  if (left < toRestore - 0.5 && h - lastProposal[bi] >= 24) {
                    lastProposal[bi] = h;
                    // nearest tier 3 EV home above threshold, reporting, not busy
                    let best = -1, bd = Infinity;
                    for (let k = 0; k < N; k++) {
                      const d = bat[k];
                      if (d.tier !== 3 || !d.ev || cur[k] < cap * P.ev_donor_min_pct / 100 || donorBusyUntil[k] > h) continue;
                      if (curStatus[k] === S.silent || curStatus[k] === S.fault || curStatus[k] === S.empty) continue;
                      const dist = Math.hypot(d.x - hm.x, d.y - hm.y);
                      if (dist < bd) { bd = dist; best = k; }
                    }
                    if (best >= 0 && bd < P.ev_radius_km) {
                      const id = `ev-${hm.id}-${h}`;
                      const decision = decisions.ev[id] || 'pending';
                      const hoursBought = P.ev_trip_kwh / perH;
                      proposals.ev.push({ id, h, medId: hm.id, medBi: bi, donorId: bat[best].id, donorBi: best, kwh: P.ev_trip_kwh, hoursBought, distKm: bd, circuit: c, donorCircuit: bat[best].circuit, status: decision, hoursLeft: left, toRestore });
                      totals.evProposed++;
                      // an approved trip takes the donor out of the pool for a day; a pending or held one only for a short hold
                      donorBusyUntil[best] = decision === 'approved' ? h + 24 : h + 3;
                      if (decision === 'approved') { evCredit[bi] = P.ev_trip_kwh; totals.evApproved++; totals.evHoursBought += hoursBought; }
                    } else {
                      proposals.unmet.push({ id: `unmet-${hm.id}-${h}`, h, medId: hm.id, circuit: c, hoursLeft: left, toRestore, reason: best < 0 ? `no Tier 3 EV home above ${P.ev_donor_min_pct}% reporting` : `nearest donor over ${P.ev_radius_km} km (assumed radius)` });
                      totals.unmet++;
                    }
                  }
                }
              }
            } else if (h >= holdH) {
              // ---- grid back (planned restoration) ----
              fl |= 8;
              if (faulted) stt = S.fault;
              else if (approved && h >= cc.restoreH + P.cold_load_hours) {
                if (s < cap - 1e-6) {
                  const want = Math.min(P.charge_kw, cap - s, headroomKW / 1);
                  const take = Math.max(0, Math.min(want, headroomKW));
                  s += take; headroomKW -= take; chargeKW += take;
                  stt = S.restoring;
                } else stt = S.normal;
              } else if (h < cc.restoreH + P.cold_load_hours) {
                // riding through the cold-load window on the battery: the home draws nothing from the grid;
                // once the battery is spent within the hour the home is on the grid (standby), not islanded at 0 kWh
                if (s > 0) {
                  const d = Math.min(load, s, P.power_kw); s -= d; if (s < 1e-6) s = 0;
                  stt = s > 0 ? S.islanded : S.standby;
                } else stt = S.standby;
              } else {
                // grid back, plan not yet approved (or on hold): the battery serves the home only down to the
                // reserve floor, as on an ordinary day, and draws nothing from the grid; the grid carries the rest
                const d = Math.max(0, Math.min(load, s - floorKwh, P.power_kw)); s -= d; if (s < 1e-6) s = 0;
                stt = S.standby;
              }
              curMode[bi] = 2;
            } else {
              // ---- pre-shutoff ladder ----
              const holdT1 = hm.tier === 1 && h >= watchH;
              const holdT2 = hm.tier === 2 && h >= namedH[c];
              const holdT3 = hm.tier === 3 && h >= fillH && consented;
              // the raised floor at Ask never lowers the reserve floor: the higher of the two applies
              const floorNow = (hm.tier === 3 && h >= namedH[c]) ? Math.max(askFloor, floorKwh) : floorKwh;
              if (holdT1 || holdT2 || holdT3) {
                const offPeakOnly = hm.tier === 1 && h < askH;
                if (s < cap - 1e-6 && !(offPeakOnly && onPeak)) {
                  const want = Math.min(P.charge_kw, cap - s);
                  const take = Math.max(0, Math.min(want, headroomKW));
                  s += take; headroomKW -= take; chargeKW += take;
                }
                stt = s >= cap - 0.05 ? S.held : S.filling;
                if (onPeak) { const forfeited = Math.min(load, P.power_kw) * dPrice; totals.readiness += forfeited; dayAgg.readiness += forfeited; }
              } else {
                if (onPeak) {
                  const d = Math.max(0, Math.min(load, s - floorNow, P.power_kw));
                  s -= d; totals.savings += d * dPrice; dayAgg.savings += d * dPrice;
                } else if (s < cap - 1e-6) {
                  const want = Math.min(P.charge_kw, cap - s);
                  const take = Math.max(0, Math.min(want, headroomKW));
                  s += take; headroomKW -= take; chargeKW += take;
                }
                stt = h >= watchH ? S.watch : S.normal;
              }
              curMode[bi] = 2;
            }

            // ---- comms channel ----
            let ch;
            if (st !== 1) ch = C.internet;
            else if (!zoneTowerDown[hm.zone]) ch = C.sms;
            else if (P.mesh && zones[hm.zone].starlink) ch = C.mesh;
            else ch = C.silent_tower;
            const since = h - holdH;
            if (st === 1 && hm.dropout && since >= hm.dropStart && since < hm.dropStart + hm.dropLen) ch = C.silent_check;
            if (faulted && st === 1) ch = C.silent_check;
            if (ch === C.silent_tower || ch === C.silent_check) { if (stt !== S.fault) stt = S.silent; }
            if (ch === C.silent_check && faulted) stt = S.fault;

            cur[bi] = s; curStatus[bi] = stt;
            soc[idx] = s; status[idx] = stt; mode[idx] = curMode[bi]; chan[idx] = ch; flags[idx] = fl;
          }
        }
        cc.chargeKW[h] = chargeKW;
        cc.gridA[h] = st === 1 ? 0 : gridBase + chargeKW / KW_PER_UNIT;
      }

      // ---- fleet summary ----
      // byMode counts only homes whose circuit is still off (an outage budget applies to nobody else); gridBack counts the rest after the shutoff
      const f = { h, rung, byStatus: new Array(STATUS.length).fill(0), byChan: new Array(CHAN.length).fill(0), byMode: [0, 0, 0], gridBack: 0, stillOff: 0,
        power: 0, mbPower: 0, mbTotal: 0, mbEmpty: 0, socSum: 0, savingsDay: dayAgg.savings, readinessDay: dayAgg.readiness,
        savingsCum: totals.savings, readinessCum: totals.readiness, protectedCum: totals.protectedHours, mbHoursCum: totals.mbHours,
        faultsActual: 0, faults: 0, zonesDown: 0, zonesSilent: 0, towerDown: Array.from(zoneTowerDown), heldCount: 0, evProposed: totals.evProposed, evApproved: totals.evApproved, evHoursBought: totals.evHoursBought, unmet: totals.unmet,
        held: 0, filling: 0, full: 0, circuitsOff: 0, replanned: 0 };
      for (let bi = 0; bi < N; bi++) {
        const idx = h * N + bi, stt = status[idx], hm = bat[bi];
        f.byStatus[stt]++; f.byChan[chan[idx]]++; f.socSum += soc[idx];
        const gridOn = circ[hm.circuit].state[h] !== 1;
        const hasPower = gridOn || (soc[idx] > 0 && stt !== S.fault && stt !== S.empty);
        if (hasPower) f.power++;
        if (hm.tier === 1) { f.mbTotal++; if (hasPower) f.mbPower++; else f.mbEmpty++; }
        // faults among the silent "check this one" homes (a faulted battery whose circuit is back reports again)
        if (stt === S.fault && chan[idx] === C.silent_check) f.faultsActual++;
        if (stt === S.fault) f.faults++;
        if (h >= holdH) { if (gridOn) f.gridBack++; else { f.byMode[mode[idx]]++; f.stillOff++; } }
        if (stt === S.held) f.held++;
        if (stt === S.filling) f.filling++;
        if (soc[idx] >= cap - 0.05) f.full++;
      }
      for (const z of zones) if (zoneTowerDown[z.id]) { f.zonesDown++; if (!(P.mesh && z.starlink)) f.zonesSilent++; }
      for (const c of NAMED) { if (circ[c].state[h] === 1) f.circuitsOff++; if (circ[c].replans[h] > 0) f.replanned++; }
      f.socPct = N ? f.socSum / (N * cap) * 100 : 0;
      fleet.push(f);
    }

    // narrative lines
    for (let h = 0; h < HOURS; h++) narrative[h] = narrate(h, fleet[h], circ, byCircuitTier, bat, cap, P, R, zones, restorePlan, decisions, proposals);

    return { N, HOURS, soc, status, mode, chan, flags, fleet, circuits: circ, proposals, totals, narrative, rungs: R, namedH, STATUS, CHAN, MODES, S, C, params: P };
  }

  function money(x) { return '$' + Math.round(x).toLocaleString(); }
  function plural(n, word, pluralWord) { return `${n.toLocaleString()} ${n === 1 ? word : (pluralWord || word + 's')}`; }

  function narrate(h, f, circ, byCT, bat, cap, P, R, zones, plan, decisions, proposals) {
    const N = bat.length;
    if (!N) return 'No battery homes at this adoption rate.';
    // kW under 950 print as kW so small figures are not rounded to "0.0 MW"
    const mw = kw => kw >= 950 ? (kw / 1000).toFixed(kw >= 9950 ? 0 : 1) + ' MW' : Math.round(kw) + ' kW';
    if (f.rung === 'none') {
      const hour = h % 24;
      const onPeak = hour >= P.on_peak_hours[0] && hour < P.on_peak_hours[1];
      return `Ordinary day: ${N.toLocaleString()} batteries ${onPeak ? 'covering on-peak load' : 'charging off-peak'} above the ${P.reserve_floor_pct}% floor. Saving about ${money(f.savingsDay)} so far today, as Base and Tesla already do.`;
    }
    if (f.rung === 'watch') {
      let t1 = 0, full = 0;
      for (const c of NAMED) for (const bi of byCT[c][0]) { t1++; }
      full = f.byStatus[S.held];
      return `Watch: Medical Baseline homes fill off-peak and hold on six circuits (standing consent from enrolment, notice sent): ${full} of ${t1} at 100%. Everyone else keeps the ordinary day. Readiness cost today ${money(f.readinessDay)}.`;
    }
    if (f.rung === 'ask') {
      let t2 = 0, consented = 0, t3 = 0;
      for (const c of NAMED) if (circ[c] && h >= (R.ask) && ['Galahad', 'Maguire', 'Cuthbert', 'Merlin'].includes(c)) {
        t2 += byCT[c][1].length;
        for (const bi of byCT[c][2]) { t3++; if (h >= R.ask + bat[bi].consentDelay) consented++; }
      }
      return `Ask: SCE named Cuthbert, Galahad, Maguire, Merlin. Tier 2 critical-need homes there fill and hold: ${f.held} Tier 1 and 2 held, ${f.filling} filling. Tier 3 floor raised to ${P.ask_floor_pct}%; ${consented} of ${t3} consented to pre-fill.`;
    }
    if (f.rung === 'fill') {
      let bestC = 'Galahad', bestFilling = -1;
      for (const c of NAMED) { const kw = circ[c].chargeKW[h]; if (kw > bestFilling) { bestFilling = kw; bestC = c; } }
      // headroom left is what remains after this hour's charging was allocated (headroomKW is the pre-allocation figure)
      const c = bestC, kw = circ[c].chargeKW[h], head = Math.max(0, circ[c].headroomKW[h] - kw);
      const lead = `Fill: six circuits named, shutoff definite. Consenting Tier 3 homes hold at 100%: `;
      if (kw <= 0) {
        // nothing to fill this hour: the nightly off-peak charge already did it; the step changes what is held, not the charge
        return lead + `${f.full.toLocaleString()} of ${N.toLocaleString()} batteries already full from last night's off-peak charge, ${plural(f.held, 'home')} now held at 100% instead of arbitraging tonight. ${c}: ${mw(head)} headroom unused this hour.`;
      }
      return lead + `${f.full.toLocaleString()} of ${N.toLocaleString()} batteries full, ${f.filling.toLocaleString()} filling under the circuit caps. ${c}: ${mw(kw)} charging, ${mw(head)} headroom left.`;
    }
    const evLine = () => (f.unmet > 0 || f.evProposed > 0) ? ` EV dispatch: ${f.evProposed} proposed, ${f.evApproved} approved${f.unmet ? `, ${f.unmet} with no donor` : ''}.` : '';
    if (f.rung === 'hold') {
      const since = h - R.hold;
      let s = `Hour ${since + 1} of the shutoff: ${f.power.toLocaleString()} of ${N.toLocaleString()} battery homes have power, ${f.mbPower} of ${f.mbTotal} Medical Baseline. `;
      if (f.zonesDown === 0) s += `Towers up, homes report over SMS.`;
      else if (P.mesh) s += `${f.zonesDown} of 6 tower zones down; ${f.byChan[C.mesh]} homes report over mesh to Starlink, ${f.byChan[C.silent_tower]} silent in the zone without an uplink.`;
      else s += `${f.zonesDown} of 6 tower zones down, ${f.byChan[C.silent_tower]} homes silent and running their last signed plan.`;
      if (f.replanned > 0) s += ` The planned ${P.planned_outage_h} h passed with circuits still off: estimate extended ${P.replan_h} h, budgets stepped down where needed.`;
      s += evLine();
      s += ' PoweruP proposes; the officer decides at Step 5.';
      return s;
    }
    // hand
    if (!plan) return 'Hand to a person.';
    const first = plan[0];
    const anyRestored = plan.filter(p => h >= p.startH);
    if (anyRestored.length === 0) {
      return `Hand: winds eased. PoweruP proposes recharge plans for 6 circuits, ${first.circuit} first (${first.reason}). Waiting for the shutoff officer; first planned restoration ${fmtTime(first.startH)}.` + evLine();
    }
    const last = anyRestored[anyRestored.length - 1];
    const standby = f.byStatus[S.standby], restoring = f.byStatus[S.restoring], islanded = f.byStatus[S.islanded];
    const stillOff = plan.length - anyRestored.length;
    // circuits restored, approved and past their pickup window: the fleet's charging against the sum of their headroom
    // (headroomKW is the pre-allocation headroom, so charging is never added to it)
    const charging = anyRestored.filter(p => decisions.restore[p.circuit] === 'approved' && h >= p.startH + P.cold_load_hours);
    let chargeSum = 0, headSum = 0;
    for (const p of charging) { chargeSum += circ[p.circuit].chargeKW[h]; headSum += circ[p.circuit].headroomKW[h]; }
    // riding through the cold-load pickup window: the battery carries the home while the grid picks up the rest of the circuit
    const riding = anyRestored.filter(p => h < p.startH + P.cold_load_hours);
    const ridingNote = riding.length ? ` ${plural(islanded, 'battery', 'batteries')} on ${riding.map(p => p.circuit).join(', ')} ride through the ${P.cold_load_hours} h pickup window on battery.` : '';
    const waitNote = standby ? ` ${plural(standby, 'battery', 'batteries')}${charging.length ? ' on other circuits' : ''} hold at the ${P.reserve_floor_pct}% floor and draw nothing from the grid${charging.length ? '' : '; the grid carries the homes'}.` : '';
    const offNote = stillOff ? ` ${plural(stillOff, 'circuit')} still off.` : '';
    const restoredLine = `Planned: ${last.circuit} restored ${fmtTime(last.startH, { short: true })}${anyRestored.length > 1 ? ` (${anyRestored.length} of 6 back)` : ''}.`;
    if (charging.length) {
      const names = charging.map(p => p.circuit).join(', ');
      return `${restoredLine} ${charging.length === anyRestored.length ? 'Plans approved' : 'Approved plans'}: ${plural(restoring, 'battery', 'batteries')} recharging, ${mw(chargeSum)} inside ${mw(headSum)} headroom on ${names}, Medical Baseline first.${ridingNote}${waitNote}${offNote}` + evLine();
    }
    const dec = decisions.restore[last.circuit];
    const decWord = dec === 'approved' ? 'approved, recharge starts after the pickup window' : dec === 'hold' ? 'on hold' : 'not yet approved';
    return `${restoredLine} Recharge plan ${decWord}.${ridingNote}${waitNote}${offNote}` + evLine();
  }

  return {
    HOURS, NAMED, STATUS, S, CHAN, C, MODES, KW_PER_UNIT, KM_PER_DEG_LAT, KM_PER_DEG_LON,
    mulberry32, hourOf, dateParts, fmtTime, fmt24, toKm, coastLatAt, bandPolygon, pointInPoly, hoursLeftWalk,
    defaultParams, rungHours, circuitProfiles, buildHomes, simulate
  };
});
