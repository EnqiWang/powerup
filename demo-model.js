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

  // Headline numbers. Each carries a provenance badge and the inputs behind it.
  // opts: { medicalLabel, currency: { symbol } }. Baseline backup = a full battery with no budget.
  function headline(homes, c, prices, plan, opts = {}) {
    const online = homes.filter((h) => h.online),
      D = c.duration,
      energyOf = (h) => plan?.homes.find((x) => x.id === h.id)?.energy ?? h.energy,
      avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    const base = online.map((h) => (h.capacity * P.ETA) / P.total(h)),
      withPlan = online.map((h) => P.budget(h, c, energyOf(h)).runtime ?? 0),
      keptBase = base.filter((r) => r >= D - 1e-9).length,
      kept = (hs) => hs.filter((h) => h.online && P.budget(h, c, energyOf(h)).targetMet),
      medical = homes.filter((h) => h.medicalBaseline),
      rush = Math.max(0, ...unmanagedCurve(homes, c).map((x) => x.total)),
      staggered = plan ? Math.max(0, ...plan.trace.map((x) => x.total)) : Math.min(rush, c.headroom),
      // Ordinary-day value: homes whose export is only paused for a shutoff still count (same daily reserve as app.js).
      value = P.everyday(
        homes.map((h) => (h.exportPaused ? { ...h, gridParticipation: true } : h)),
        { ...c, duration: prices.dailyReserve },
        prices,
      ).margin;
    const mixed = "Real: utility ZIP load, Base Core 39.2 kWh. Assumed: starting charge, load shares, consent.";
    return [
      {
        id: "backup",
        label: "Hours of backup",
        value: avg(withPlan),
        baseline: avg(base),
        unit: "h",
        detail: `with budget · ${avg(base).toFixed(0)} h full battery, no plan`,
        provenance: "MIXED",
        sources: mixed,
      },
      {
        id: "kept",
        label: "Homes kept on",
        value: kept(homes).length,
        baseline: keptBase,
        unit: `/ ${homes.length}`,
        detail: `through ${D} h · ${keptBase} without a plan`,
        provenance: "MIXED",
        sources: mixed,
      },
      {
        id: "medical",
        label: opts.medicalLabel || "Medical Baseline homes protected",
        value: kept(medical).length,
        unit: `/ ${medical.length}`,
        detail: "charged first, held to 100% with consent",
        provenance: "ASSUMED",
        sources: "Assumed: which homes are enrolled and that they consent to holding 100%.",
      },
      {
        id: "headroom",
        label: "Peak headroom freed",
        value: Math.max(0, rush - staggered),
        baseline: rush,
        unit: "kW",
        detail: `all at once ${rush.toFixed(1)} kW vs ${staggered.toFixed(1)} kW staggered`,
        provenance: "ASSUMED",
        sources: "Assumed: charge power and spare circuit headroom. Base Core power is not a published spec here.",
      },
      {
        id: "value",
        label: "Ordinary-day value",
        value: value * (opts.currency?.engineScale || 1),
        unit: "/event",
        symbol: opts.currency?.symbol ?? "$",
        detail: `fleet margin, ${prices.eventHours} h peak · ${prices.dailyReserve} h reserve kept`,
        provenance: "ASSUMED",
        sources: "Assumed: buy/sell prices, resident grid participation.",
      },
    ];
  }

  // ---------- scenarios and regions: config only, the engine is unchanged ----------
  function validateScenario(s) {
    const errs = [];
    if (s?.schema !== "powerup.scenario.v1") errs.push("schema must be powerup.scenario.v1");
    if (!Array.isArray(s?.events) || !s.events.length) errs.push("events required");
    for (const e of s?.events || []) {
      if (!e.id || !e.label) errs.push("event needs id and label");
      if (!e.source) errs.push(`event ${e.id}: source label required`);
      if (!["REAL", "ASSUMED", "SYNTHETIC"].includes(e.provenance)) errs.push(`event ${e.id}: provenance`);
      if (e.at && Number.isNaN(Date.parse(e.at))) errs.push(`event ${e.id}: bad time`);
      if (e.grace && e.grace.provenance !== "INFERRED") errs.push(`event ${e.id}: Grace actions must be INFERRED`);
    }
    const dated = (s?.events || []).filter((e) => e.at).map((e) => Date.parse(e.at));
    if (dated.some((t, i) => i && t < dated[i - 1])) errs.push("events must be in time order");
    if (!s?.fleet?.homes?.length) errs.push("fleet.homes required");
    if (!s?.cfg || !s?.prices) errs.push("cfg and prices required");
    const ids = new Set((s?.events || []).map((e) => e.id));
    for (const d of s?.demo || []) if (d.event && !ids.has(d.event)) errs.push(`demo step ${d.id}: unknown event ${d.event}`);
    if (errs.length) throw Error("Invalid scenario: " + errs.join("; "));
    return s;
  }
  function validateRegion(r) {
    const need = ["id", "name", "provenance", "hazardFeed", "shutoffRules", "units", "currency", "criticalLoads", "scenario"];
    const missing = need.filter((k) => r?.[k] == null);
    if (missing.length) throw Error("Invalid region: missing " + missing.join(", "));
    if (r.id !== "la-wildfire" && r.provenance !== "SYNTHETIC") throw Error("Non-LA regions must be labeled SYNTHETIC");
    return r;
  }
  // Representative fleet. Load comes from the bundled utility ZIP average when the scenario names a
  // ZIP (REAL); otherwise from the region's own SYNTHETIC per-site meanKw.
  function buildFleet(scenario, snaps) {
    const z = scenario.zip ? snaps?.sce?.zips?.[scenario.zip] : null;
    if (scenario.zip && !z?.latest?.usable) throw Error("No usable usage snapshot for ZIP " + scenario.zip);
    return scenario.fleet.homes.map((spec, i) => {
      const meanKw = z ? z.latest.meanKw : spec.meanKw,
        name = spec.name || `${spec.circuit} circuit · rep. home`,
        measurement = z
          ? {
              kind: "zip-benchmark",
              zip: scenario.zip,
              location: "SCE residential account average · ZIP " + scenario.zip,
              source: z.source,
              first: `${z.latest.year}-${String(z.latest.month).padStart(2, "0")}`,
              last: `${z.latest.year}-${String(z.latest.month).padStart(2, "0")}`,
              monthlyKwh: z.latest.averagekwh,
              accounts: z.latest.totalaccounts,
            }
          : { kind: "synthetic", location: "SYNTHETIC region profile", source: "SYNTHETIC" };
      const h = P.makeHome(i + 1, name, meanKw, measurement);
      if (scenario.fleet.capacityKwh) h.capacity = scenario.fleet.capacityKwh; // config-defined site battery
      if (scenario.fleet.rateKw) h.rate = scenario.fleet.rateKw;
      h.energy = h.capacity * (spec.startSoc ?? 0.3);
      h.fixedName = name;
      h.circuit = spec.circuit || null;
      h.medicalBaseline = !!spec.medicalBaseline;
      h.priority = spec.medicalBaseline ? 3 : 2;
      h.provider = "Scenario Network " + (h.id % 2 ? "A" : "B");
      h.evidence = { fresh: false, voltage: 120, breaker: "unknown", fault: false };
      h.gridParticipation = true;
      h.exportCap = scenario.fleet.rateKw || 3;
      return h;
    });
  }
  function acceptConsent(homes, hours) {
    homes.forEach((h) =>
      h.loads.forEach((l) => {
        if (l.id !== "essential") Object.assign(l, { consent: "accepted", consentHours: hours, gridAccepted: true });
      }),
    );
    return homes;
  }
  // After restoration: everyone recharging at once (cold-start surge) vs a staggered plan under headroom.
  // Both include the homes' own restored load.
  function recharge(homes, energies, c, r) {
    const hs = homes.map((h) => ({ ...P.clone(h), online: true, energy: Math.max(0, energies[h.id] ?? h.energy) })),
      rc = { ...c, lead: r.lead, headroom: r.headroom },
      surge = unmanagedCurve(hs, rc),
      plan = P.prepare(hs, rc),
      loadKw = hs.reduce((s, h) => s + P.total(h), 0);
    return {
      surgeKw: Math.max(0, ...surge.map((x) => x.total)) + loadKw,
      staggeredKw: Math.max(0, ...plan.trace.map((x) => x.total)) + loadKw,
      loadKw,
      surge,
      trace: plan.trace,
      lead: r.lead,
      headroom: r.headroom,
    };
  }
  // Whole replay without a browser (poster, tests): prepare, outage to the horizon, recharge proposal.
  // Local prices to engine units (the engine caps prices at 10 per kWh; e.g. JPY uses engineScale 100).
  function enginePrices(prices, currency) {
    const k = currency?.engineScale || 1;
    return { ...prices, buy: prices.buy / k, sell: prices.sell / k };
  }
  function runScenario(scenario, snaps, opts = {}) {
    const homes = acceptConsent(buildFleet(scenario, snaps), scenario.cfg.duration),
      c = { ...scenario.cfg },
      plan = P.prepare(homes, c),
      metrics = headline(homes, c, enginePrices(scenario.prices, opts.currency), plan, opts);
    let outage = P.startOutage(homes, c, plan);
    while (outage.elapsed < outage.duration) outage = P.advance(outage, Math.min(24, outage.duration - outage.elapsed));
    const energies = Object.fromEntries(outage.devices.map((d) => [d.id, d.energy]));
    return {
      homes,
      cfg: c,
      plan,
      metrics,
      outage,
      recharge: recharge(homes, energies, c, scenario.recharge || { lead: 8, headroom: c.headroom }),
    };
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

  const api = {
    isDemo, demoRoute, unmanagedCurve, headline, applyEffects, applyTwists,
    validateScenario, validateRegion, buildFleet, acceptConsent, recharge, runScenario, enginePrices, SNAPSHOTS,
  };
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
