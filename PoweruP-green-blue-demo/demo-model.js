/* PoweruP demo model: offline snapshot routing, headline metrics and twist effects.
   Pure functions (Node-testable). The browser part only installs the ?demo=1 fetch router. */
(function (root) {
  "use strict";
  const P = root.Powerup ?? require("./advanced");
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const SNAPSHOTS = ["sce", "nws", "zcta", "opsd"];

  function isDemo(search) {
    const v = new URLSearchParams(search || "").get("demo");
    return v !== null && v !== "0" && v !== "false";
  }

  // Answer the app's /api/* routes from bundled snapshots. Never touches the network.
  function demoRoute(url, snaps) {
    const path = url.pathname.replace(/^.*?(\/api\/)/, "/api/"),
      q = url.searchParams;
    if (path === "/api/sce") {
      const zip = q.get("zip") || "",
        data = snaps.sce?.zips?.[zip];
      return data
        ? { status: 200, body: data }
        : { status: 404, body: { error: "Demo mode: no bundled SCE snapshot for ZIP " + zip + "." } };
    }
    if (path === "/api/weather") return { status: 200, body: snaps.nws };
    if (path === "/api/geography") {
      const zips = [...new Set((q.get("zips") || "").split(",").filter(Boolean))],
        features = snaps.zcta.features.filter((f) => zips.includes(f.properties.zip));
      return {
        status: 200,
        body: { ...snaps.zcta, features, missing: zips.filter((z) => !features.some((f) => f.properties.zip === z)) },
      };
    }
    if (path === "/api/households/public") return { status: 200, body: snaps.opsd };
    if (path === "/api/households/cached") return { status: 404, body: { error: "Demo mode starts from SCE ZIPs." } };
    if (path === "/api/version") return { status: 200, body: { version: "PoweruP demo snapshots", static: true } };
    return { status: 501, body: { error: "Not available in offline demo mode." } };
  }

  // Everyone plugs in at 4 PM: each online home charges at full rate until it reaches its preparation target.
  function unmanagedCurve(homes, c) {
    const hs = homes
      .filter((h) => h.online)
      .map((h) => {
        const need = P.budget(h, c, h.capacity).requiredKwh;
        return { rate: h.rate, energy: h.energy, target: Math.min(h.capacity, Math.max(h.capacity * c.floor, need)) };
      });
    const out = [];
    for (let t = 0; t < c.lead - 1e-9; t += 0.25) {
      let total = 0;
      for (const h of hs) {
        const kw = Math.max(0, Math.min(h.rate, (h.target - h.energy) / (P.ETA * 0.25)));
        h.energy += kw * P.ETA * 0.25;
        total += kw;
      }
      out.push({ hour: t, total });
    }
    return out;
  }

  // Five headline numbers. Each carries a provenance badge and the inputs behind it.
  function headline(homes, c, prices, plan) {
    const online = homes.filter((h) => h.online),
      D = c.duration,
      energyOf = (h) => plan?.homes.find((x) => x.id === h.id)?.energy ?? h.energy,
      avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0),
      cap = (x) => Math.min(D, x ?? 0);
    const base = online.map((h) => (h.energy * P.ETA) / P.total(h)),
      withPlan = online.map((h) => P.budget(h, c, energyOf(h)).runtime ?? 0),
      keptBase = base.filter((r) => r >= D - 1e-9).length,
      keptPlan = online.filter((h) => P.budget(h, c, energyOf(h)).targetMet).length,
      essential = withPlan.reduce((s, r) => s + cap(r), 0) - base.reduce((s, r) => s + cap(r), 0),
      rush = Math.max(0, ...unmanagedCurve(homes, c).map((x) => x.total)),
      staggered = plan ? Math.max(0, ...plan.trace.map((x) => x.total)) : Math.min(rush, c.headroom),
      value = P.everyday(homes, { ...c, duration: prices.dailyReserve }, prices).margin; // same daily reserve as app.js
    const mixed = "Real: SCE/OPSD load, Base Core 39.2 kWh. Assumed: 30% start charge, load shares, consent.";
    return [
      {
        id: "backup",
        label: "Hours of backup",
        value: avg(withPlan),
        baseline: avg(base),
        unit: "h",
        detail: `avg per home · ${avg(base).toFixed(0)} h unmanaged`,
        provenance: "MIXED",
        sources: mixed,
      },
      {
        id: "kept",
        label: "Households kept powered",
        value: keptPlan,
        baseline: keptBase,
        unit: `/ ${homes.length}`,
        detail: `through ${D} h · ${keptBase} unmanaged`,
        provenance: "MIXED",
        sources: mixed,
      },
      {
        id: "essential",
        label: "Essential-load hours preserved",
        value: Math.max(0, essential),
        unit: "home-h",
        detail: `extra hours essential loads stay on`,
        provenance: "ASSUMED",
        sources: "Assumed: essential share 30% of mean load, consent windows. Real: mean load.",
      },
      {
        id: "headroom",
        label: "Peak headroom freed",
        value: Math.max(0, rush - staggered),
        baseline: rush,
        unit: "kW",
        detail: `4 PM rush ${rush.toFixed(1)} kW vs ${staggered.toFixed(1)} kW staggered`,
        provenance: "ASSUMED",
        sources: "Assumed: 3 kW charge power, feeder headroom. Base Core power is not a published spec here.",
      },
      {
        id: "value",
        label: "Ordinary-day value",
        value,
        unit: "$/event",
        detail: `fleet margin, ${prices.eventHours} h peak · ${prices.dailyReserve} h reserve kept`,
        provenance: "ASSUMED",
        sources: "Assumed: buy/sell prices, resident grid participation.",
      },
    ];
  }

  // Apply one config entry's effects to cloned state. Returns new state plus a human-readable trail.
  function applyEffects(state, effects, label = "effect") {
    const s = clone(state),
      trail = [];
    if (effects.cfg) {
      Object.assign(s.cfg, effects.cfg);
      trail.push(`${label}: planning constraints ${JSON.stringify(effects.cfg)}`);
    }
    if (effects.shield) {
      Object.assign(s.shield, effects.shield);
      trail.push(`${label}: relief inputs ${JSON.stringify(effects.shield)}`);
    }
    for (const [id, k] of Object.entries(effects.loadScale || {})) {
      s.homes.forEach((h) => h.loads.filter((l) => l.id === id).forEach((l) => (l.kw *= k)));
      trail.push(`${label}: ${id} allowance ×${k} in every home`);
    }
    for (const [id, patch] of Object.entries(effects.criticalLoads || {})) {
      const l = s.criticalLoads.find((x) => x.id === id);
      if (l) {
        Object.assign(l, patch);
        trail.push(`${label}: ${l.name} → ${JSON.stringify(patch)}`);
      }
    }
    for (const x of effects.silent || []) {
      const h = s.homes.find((h) => h.id === x.home);
      if (!h) continue;
      h.online = false;
      h.evidence = { ...h.evidence, ...x.evidence };
      trail.push(`${label}: home ${h.id} stopped reporting`);
    }
    for (const id of effects.spoof || []) {
      const h = s.homes.find((h) => h.id === id);
      if (!h) continue;
      h.online = false;
      h.evidence = { ...h.evidence, fresh: true, spoofSuspected: true, reportedSoc: 1 };
      trail.push(`${label}: home ${h.id} reported 100% charge with failed signature; capacity excluded`);
    }
    return { state: s, trail };
  }

  function applyTwists(base, twists, activeIds) {
    let state = clone(base);
    const trail = [];
    for (const t of twists.filter((t) => activeIds.includes(t.id))) {
      const r = applyEffects(state, t.effects, t.name);
      state = r.state;
      trail.push(...r.trail);
    }
    return { state, trail };
  }

  const api = { isDemo, demoRoute, unmanagedCurve, headline, applyEffects, applyTwists, SNAPSHOTS };
  root.PowerupDemoModel = api;
  if (typeof module !== "undefined") module.exports = api;

  // Browser: in ?demo=1, answer /api/* from bundled JSON before the app's first request.
  if (typeof window !== "undefined" && root.location && isDemo(root.location.search)) {
    root.POWERUP_DEMO = true;
    const nativeFetch = root.fetch.bind(root);
    const snaps = Promise.all(
      SNAPSHOTS.map((n) => nativeFetch("data/snapshots/" + n + ".json").then((r) => r.json())),
    ).then((list) => Object.fromEntries(SNAPSHOTS.map((n, i) => [n, list[i]])));
    root.POWERUP_SNAPSHOTS = snaps;
    root.fetch = async function (input, init = {}) {
      const url = new URL(typeof input === "string" ? input : input.url, root.location.href);
      if (url.origin !== root.location.origin || !/\/api\//.test(url.pathname)) return nativeFetch(input, init);
      const r = demoRoute(url, await snaps);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
