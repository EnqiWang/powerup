/* PoweruP demo layer: headline metrics bar, region picker, twist toggles, Pilot & Funding tab,
   decision-trail export and the one-click narrated "Run demo" replay (Bryson Fire by default).
   Drives the existing app through its own functions; planning stays in engine.js / advanced.js.
   Nothing here sends real commands or messages. */
(function (root) {
  "use strict";
  const M = root.PowerupDemoModel,
    V = root.PowerupVisual;
  let C = null, // data/twists.json
    R = {}, // config/regions/*.json by id
    region = null,
    scenario = null,
    snaps = null,
    funding = null,
    active = [],
    twistBase = null,
    trail = [],
    frozen = null;
  const demo = { i: -1, playing: false, t: 0, last: 0, timer: null, done: {} };
  const steps = () => scenario?.demo || [];

  // ---------- helpers ----------
  const el = (tag, attrs = {}, html = "") => Object.assign(document.createElement(tag), attrs, { innerHTML: html });
  const getJSON = (u) =>
    fetch(u).then((r) => {
      if (!r.ok) throw Error(u + " HTTP " + r.status);
      return r.json();
    });
  const synthetic = () => region?.provenance === "SYNTHETIC";
  const badge = (p) => `<i class="prov ${String(p).toLowerCase().split(/[ ;]/)[0]}">${safe(p)}</i>`;
  function download(name, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })),
      a = el("a", { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function money(x) {
    const cur = region?.currency || { symbol: "$" };
    return cur.symbol + (Number.isFinite(x) ? x.toFixed(cur.code === "JPY" ? 0 : 2) : "—");
  }
  function when(e) {
    if (!e?.at) return e?.when || "";
    const o = { month: "short", day: "numeric", timeZone: "America/Los_Angeles" };
    if (!e.dateOnly) Object.assign(o, { hour: "numeric", minute: "2-digit" });
    return new Date(e.at).toLocaleString("en-US", o);
  }
  function shieldValues() {
    return { feederCapacity: +$("feederCapacity").value, reliefHours: +$("reliefHours").value };
  }
  function writeInputs(state) {
    for (const k of ["duration", "lead", "headroom"]) $(k).value = state.cfg[k];
    $("floor").value = Math.round(state.cfg.floor * 100);
    $("feederCapacity").value = state.shield.feederCapacity;
    $("reliefHours").value = state.shield.reliefHours;
    for (const l of state.criticalLoads) $(l.inputId).value = l.kw;
    C.criticalLoads = state.criticalLoads;
  }
  function snapshotState() {
    return P.clone({ homes, cfg, shield: shieldValues(), criticalLoads: C.criticalLoads });
  }
  function metrics(hs = homes, c = cfg, pl = plan) {
    try {
      return hs.length ? M.headline(hs, c, prices, pl, { medicalLabel: region?.medicalLabel, currency: region?.currency }) : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- regions (config only; the engine is unchanged) ----------
  function loadRegion(id) {
    region = R[id];
    scenario = region.scenarioData;
    outage = null;
    approved = false;
    active = [];
    twistBase = null;
    trail = [];
    homes = M.acceptConsent(
      M.buildFleet(scenario, snaps).map((h) => decorate(h)),
      scenario.cfg.duration,
    );
    selected = homes[0].id;
    cfg = { ...scenario.cfg };
    prices = M.enginePrices(scenario.prices, region.currency);
    for (const k of ["buy", "sell", "eventHours", "dailyReserve"]) $(k).value = prices[k];
    writeInputs({ cfg, shield: C.baseCase.shield, criticalLoads: P.clone(region.criticalLoads) });
    source = {
      kind: scenario.zip ? "zip-benchmark" : "synthetic-region",
      source: scenario.zip ? scenario.usage?.source : "SYNTHETIC region config",
      location: region.name,
      method: scenario.fleet.note || "SYNTHETIC per-site loads from config/regions/" + id + ".json",
      region: id,
    };
    $("source").textContent = scenario.zip
      ? `${homes.length} representative Base Core homes, one per de-energized circuit, sized from real SCE ZIP ${scenario.zip} usage. Battery state, Medical Baseline enrollment and consent are assumptions.`
      : `${region.name}: SYNTHETIC sites and loads from config. Same engine; no real data claimed.`;
    $("sourceMini").textContent = `${homes.length} ${region.siteLabel || "home"}s · ${region.name}`;
    $("dataBadge").textContent = synthetic()
      ? "SYNTHETIC REGION · SAME ENGINE"
      : `REAL ZIP ${scenario.zip} USAGE · SIMULATED BATTERIES`;
    document.body.classList.toggle("region-synthetic", synthetic());
    changed(`Region: ${region.name} (${region.provenance}). Scenario: ${scenario.title}.`);
    renderRegionPicker();
    renderTwists();
    renderFunding();
  }
  function renderRegionPicker() {
    const box = $("regionPicker");
    if (!box || !region) return;
    box.innerHTML =
      `<label>REGION <select id="regionSelect">${Object.values(R)
        .map((r) => `<option value="${r.id}" ${r.id === region.id ? "selected" : ""}>${safe(r.name)}</option>`)
        .join("")}</select></label>${badge(region.provenance)}` +
      `<span class="small region-note" title="${safe(region.provenanceNote)}">${safe(region.hazardFeed.name)} · ${safe(region.shutoffRules.name)} · ${safe(region.currency.code)} · ${safe(region.units.temperature)}</span>`;
    $("regionSelect").onchange = (e) => {
      stop(false);
      loadRegion(e.target.value);
    };
  }

  // ---------- headline metrics bar (always visible) ----------
  function renderHeadline() {
    const bar = $("headline");
    if (!bar) return;
    let m = metrics();
    const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "—");
    if (!m) {
      bar.innerHTML =
        '<div class="hl-empty">Metrics appear once a fleet is loaded. Press <b>▶ Run demo</b> for the 3-minute Bryson Fire replay.</div>';
      return;
    }
    // During an outage planning numbers freeze at outage start; "kept on" goes live and counts only
    // verified (talking) batteries that have not run short.
    if (!outage) frozen = null;
    else {
      frozen = frozen || m;
      const silent = homes.filter((h) => !P.classifySilent(h, homes).verified).length,
        live = homes.filter(
          (h) => P.classifySilent(h, homes).verified && outage.devices.find((d) => d.id === h.id).unservedKwh < 1e-6,
        ).length;
      m = frozen.map((x) =>
        x.id === "kept" ? { ...x, value: live, detail: `verified at hour ${f(outage.elapsed)} · ${silent} silent` } : x,
      );
    }
    bar.innerHTML = m
      .map((x) => {
        const value = x.id === "value" ? money(x.value) : f(x.value, x.id === "headroom" ? 1 : 0),
          prov = synthetic() ? "SYNTHETIC" : x.provenance,
          sourceLabel = { REAL: "Recorded data", ASSUMED: "Estimate", MIXED: "Data + estimates", SYNTHETIC: "Synthetic estimate" }[prov];
        return `<div class="hl" title="${safe(x.sources)}"><span class="hl-label">${safe(x.label)} ${badge(prov)}</span><strong>${value}<small> ${safe(x.unit)}</small></strong><span class="hl-detail">${safe(x.detail)}</span></div>`;
      })
      .join("");
  }

  // ---------- twists ----------
  function renderTwists() {
    const box = $("twistBar");
    if (!box || !C) return;
    const alerts = (weatherSnapshot || snaps?.nws)?.alerts || [];
    box.innerHTML =
      '<span class="twist-title">TRY A SCENARIO</span>' +
      C.twists
        .map((t) => {
          const on = active.includes(t.id),
            ev = !synthetic() && t.evidenceAlert && alerts.find((a) => a.event === t.evidenceAlert);
          return `<label class="twist ${on ? "on" : ""}" title="${safe(t.summary)}"><input type="checkbox" data-twist="${t.id}" ${on ? "checked" : ""}> ${safe(t.name)}${ev ? ' <i class="prov real" title="Bundled NWS response">NWS: ' + safe(ev.event) + "</i>" : ""}${on ? `<button class="trail" data-trail="${t.id}" title="Export decision trail for this twist">⇩ trail</button>` : ""}</label>`;
        })
        .join("") +
      '<details class="scenario-help"><summary>What do these scenarios change?</summary><p>Try an example problem and see how the plan changes. Check a scenario to turn it on; uncheck it to undo its effects. These are demo events.</p>' +
      C.twists.map((t) => `<p><b>${safe(t.name)}:</b> ${safe(t.summary)}</p>`).join("") + '</details>';
    box.querySelectorAll("[data-twist]").forEach((x) => (x.onchange = () => toggleTwist(x.dataset.twist, x.checked)));
    box.querySelectorAll("[data-trail]").forEach(
      (b) =>
        (b.onclick = (e) => {
          e.preventDefault();
          exportTrail(b.dataset.trail);
        }),
    );
  }
  function toggleTwist(id, on) {
    if (!homes.length) {
      loadRegion(region.id); // auto-load the region's fleet so scenarios work from a cold start
    }
    if (!active.length) twistBase = snapshotState();
    active = on ? [...active, id] : active.filter((x) => x !== id);
    const r = M.applyTwists(twistBase, C.twists, active);
    homes = r.state.homes;
    cfg = r.state.cfg;
    writeInputs(r.state);
    trail = r.trail;
    if (!active.length) twistBase = null;
    const t = C.twists.find((t) => t.id === id);
    changed(`Twist ${on ? "ON" : "OFF"}: ${t.name}. ${r.trail.join("; ") || "Base case restored."}`);
    renderTwists();
  }
  function decisions() {
    let relief;
    try {
      relief = P.relief(
        homes.map((h) => ({ ...h, energy: projectedEnergy(h) })),
        cfg,
        shieldInputs(),
      );
    } catch (e) {
      relief = { error: e.message };
    }
    return {
      homes: homes.map((h) => {
        const b = viewBudget(h);
        return {
          id: h.id,
          name: h.name,
          medicalBaseline: !!h.medicalBaseline,
          classification: P.classifySilent(h, homes),
          budget: {
            budgetKw: b.budgetKw,
            plannedKw: b.plannedKw,
            runtimeH: b.runtime,
            targetMet: b.targetMet,
            shortfallKwh: b.shortfallKwh,
          },
        };
      }),
      relief,
      handoff: handoffItems(),
    };
  }
  function trailDoc(twist) {
    return {
      schema: "powerup.decision-trail.v1",
      simulation: true,
      exportedAt: new Date().toISOString(),
      region: region && { id: region.id, name: region.name, provenance: region.provenance },
      scenario: scenario && { id: scenario.id, title: scenario.title, provenance: scenario.provenance },
      twist,
      activeTwists: active,
      demoMode: !!root.POWERUP_DEMO,
      battery: C.battery,
      inputs: { cfg, prices, shield: shieldValues(), criticalLoads: C.criticalLoads },
      effectsApplied: trail,
      metrics: metrics(),
      decisions: decisions(),
      approved,
      events,
    };
  }
  function exportTrail(id) {
    const t = C.twists.find((t) => t.id === id);
    let before = null;
    try {
      before = twistBase && metrics(twistBase.homes, twistBase.cfg, P.prepare(twistBase.homes, twistBase.cfg));
    } catch (e) {}
    download(`PoweruP-trail-${id}.json`, { ...trailDoc(t), metricsBefore: before });
    log(`Decision trail exported for twist “${t.name}”.`);
  }

  // ---------- operator handoff ----------
  function handoffItems() {
    const items = [];
    for (const h of homes) {
      const c = P.classifySilent(h, homes),
        b = viewBudget(h);
      if (!c.verified) items.push({ kind: "Silent battery", who: h.name, detail: `${c.label}. ${c.next}` });
      else if (!b.targetMet)
        items.push({ kind: "Home shortfall", who: h.name, detail: `${fmt(b.shortfallKwh)} kWh short of the ${cfg.duration} h essential plan` });
    }
    for (const n of shieldInputs().neighbors)
      if (n.graceHours < cfg.duration)
        items.push({
          kind: "Critical load",
          who: n.name,
          detail: `${n.kw} kW, ${n.graceHours} h grace. Needs utility or mobile generation; home batteries cannot feed it through a de-energized circuit.`,
        });
    return items;
  }

  // ---------- figures (card above the caption bar) ----------
  function figure(html) {
    const f = $("demoFigure");
    f.innerHTML = html || "";
    f.hidden = !html;
  }
  function lineChart(series, lead, limit, title, legend) {
    const top = Math.max(limit * 1.2, ...series.flatMap((s) => s.pts.map((p) => p.total)), 1),
      W = 420,
      H = 120,
      line = (pts) =>
        pts.map((p, i) => `${i ? "L" : "M"}${((p.hour / lead) * W).toFixed(1)},${(H - (p.total / top) * H).toFixed(1)}`).join(""),
      y = H - (limit / top) * H;
    return `<div class="fig-title">${title}</div>
      <svg viewBox="-2 -6 ${W + 4} ${H + 22}" class="fig-chart" role="img" aria-label="${safe(title)}">
        <line x1="0" x2="${W}" y1="${y}" y2="${y}" class="fig-limit"/><text x="${W}" y="${y - 4}" text-anchor="end" class="fig-limit-t">spare capacity ${fmt(limit)} kW</text>
        ${series.map((s) => `<path d="${line(s.pts)}" class="${s.cls}"/>`).join("")}
        <text x="0" y="${H + 14}" class="fig-axis">start</text><text x="${W}" y="${H + 14}" text-anchor="end" class="fig-axis">+${lead} h</text></svg>
      <div class="fig-legend">${legend}</div>`;
  }
  function fillFigure() {
    const rush = M.unmanagedCurve(homes, cfg),
      stag = plan?.trace || [],
      first = homes
        .map((h) => ({ h, at: stag.find((s) => (s.allocations[h.id] || 0) > 0)?.hour }))
        .filter((x) => x.at != null)
        .sort((a, b) => a.at - b.at)
        .map((x) => `<li>${x.h.medicalBaseline ? "<b>Medical Baseline</b> · " : ""}${safe(x.h.name)} <span class="small">starts +${fmt(x.at)} h</span></li>`)
        .join("");
    return (
      lineChart(
        [
          { pts: rush, cls: "fig-rush" },
          { pts: stag, cls: "fig-stag" },
        ],
        cfg.lead,
        cfg.headroom,
        `FILL · ${cfg.lead} h before shutoff ${badge("INFERRED")} ${badge("ASSUMED")}`,
        `<span class="k rush"></span>Everyone charges at once · ${fmt(Math.max(0, ...rush.map((x) => x.total)))} kW <span class="k stag"></span>Staggered · ${fmt(Math.max(0, ...stag.map((x) => x.total)))} kW`,
      ) + `<div class="small">Charging order (export paused):</div><ol class="fig-list">${first}</ol>`
    );
  }
  function eventCard(id) {
    const e = scenario.events.find((x) => x.id === id);
    if (!e) return "";
    return `<div class="fig-event"><span class="small">${safe(when(e))} · ${safe(e.source)}</span> ${badge(e.provenance)}<div>${safe(e.label)}</div>${
      e.grace ? `<div class="grace"><b>Grace ${safe(e.grace.phase)}</b> ${badge("INFERRED")} ${safe(e.grace.action)}</div>` : ""
    }</div>`;
  }
  function watchFigure() {
    const talking = homes.filter((h) => P.classifySilent(h, homes).verified).length,
      circuits = scenario.circuits || [],
      total = circuits.reduce((s, c) => s + (c.customers || 0), 0),
      alerts = (snaps?.nws?.alerts || []).map((a) => safe(a.event)).join(", ");
    return (
      eventCard(steps()[demo.i]?.event) +
      (circuits.length
        ? `<table class="fig-table">${circuits
            .map(
              (c) =>
                `<tr><td><b>${safe(c.name)}</b></td><td>${c.customers ? c.customers.toLocaleString() + " customers" : "no record"}</td><td><span class="cat tripped">HIGH RISK</span></td></tr>`,
            )
            .join("")}<tr><td colspan="3" class="small">≈${total.toLocaleString()} customers on circuits with a public count ${badge("REAL")}</td></tr></table>`
        : `<div class="small">Hazard feed: ${safe(region.hazardFeed.name)} · levels ${safe(region.hazardFeed.levels.join(" → "))} ${badge("SYNTHETIC")}</div>`) +
      `<div class="fig-stat"><b>${talking}/${homes.length}</b> batteries reporting in</div>` +
      (!synthetic() && alerts ? `<div class="small">Bundled NWS snapshot today: ${alerts} ${badge("REAL")}</div>` : "")
    );
  }
  function askFigure() {
    const mb = homes.filter((h) => h.medicalBaseline);
    return (
      eventCard(steps()[demo.i]?.event) +
      `<div class="fig-title">Consent requests (simulated, nothing sent)</div><table class="fig-table">${mb
        .map((h) => `<tr><td>${safe(h.name)}</td><td><b>${safe(region.medicalLabel.split(" ")[0])}</b></td><td>Hold battery at 100% · consented ${badge("ASSUMED")}</td></tr>`)
        .join("")}</table>`
    );
  }
  function holdFigure() {
    const rows = homes
      .map((h) => {
        const b = viewBudget(h);
        return `<tr><td>${h.medicalBaseline ? "<b>MB</b> " : ""}${safe(h.name)}</td><td>${fmt(b.plannedKw)} kW budget</td><td>${b.runtime == null ? "—" : fmt(Math.min(b.runtime, 999))} h left</td></tr>`;
      })
      .join("");
    return eventCard(steps()[demo.i]?.event) + `<div class="fig-title">Hours budget per home${outage ? " · hour " + fmt(outage.elapsed) : ""}</div><table class="fig-table">${rows}</table>`;
  }
  function silentFigure() {
    const rows = homes
      .map((h) => ({ h, c: P.classifySilent(h, homes) }))
      .filter((x) => x.c.category !== "talking")
      .map(
        ({ h, c }) =>
          `<tr><td>${safe(h.name)}</td><td><span class="cat ${c.category}">${safe(c.label)}</span></td><td class="small">${safe(c.localPlan)}</td></tr>`,
      )
      .join("");
    return (
      eventCard("network-loss") +
      `<div class="fig-title">Silent-battery classifier ${badge("ASSUMED")}</div><table class="fig-table">${rows || "<tr><td>All batteries reporting.</td></tr>"}</table>` +
      eventCard("sce-69746")
    );
  }
  function handoffFigure(rc) {
    const items = handoffItems(),
      shift = (pts) => pts.map((p) => ({ hour: p.hour, total: p.total + rc.loadKw }));
    return (
      eventCard(steps()[demo.i]?.event) +
      lineChart(
        [
          { pts: shift(rc.surge), cls: "fig-rush" },
          { pts: shift(rc.trace), cls: "fig-stag" },
        ],
        rc.lead,
        rc.loadKw + rc.headroom,
        `Restoration recharge proposal ${badge("INFERRED")}`,
        `<span class="k rush"></span>Cold-start surge ${fmt(rc.surgeKw)} kW <span class="k stag"></span>Staggered ${fmt(rc.staggeredKw)} kW`,
      ) +
      `<div class="fig-proposal">Proposed to the utility shutoff officer: staggered recharge over ${rc.lead} h. <b>Awaiting human approval</b> (simulated).</div>` +
      `<div class="fig-title">Operator handoff · ${items.length} items</div><table class="fig-table">${items
        .map((x) => `<tr><td><b>${safe(x.kind)}</b></td><td>${safe(x.who)}</td><td class="small">${safe(x.detail)}</td></tr>`)
        .join("")}</table><button id="handoffExport" class="primary">⇩ Export decision trail</button>`
    );
  }
  function tuesdayFigure() {
    const m = metrics(),
      v = m?.find((x) => x.id === "value");
    return `<div class="fig-title">Customer 1 · ${synthetic() ? "local utility" : "SCE"} peak relief</div><div class="fig-stat"><b>${money(v?.value)}</b> per 2 h peak event for this ${homes.length}-${safe(region.siteLabel || "home")} fleet ${badge(synthetic() ? "SYNTHETIC" : "ASSUMED")}</div><div class="small">Only energy above each protected reserve is sold. Customer 2, the utility demand-response dispatcher, uses the same fleet in the Neighborhood shield view.</div>`;
  }

  // ---------- timeline strip ----------
  function renderStrip() {
    const box = $("timeline");
    if (!box || !scenario) return;
    const cur = steps()[demo.i]?.event,
      idx = scenario.events.findIndex((e) => e.id === cur);
    box.innerHTML =
      `<div class="tl-pitch">${safe(scenario.pitch)} ${badge(scenario.provenance)}</div><ol class="tl">` +
      scenario.events
        .map(
          (e, i) =>
            `<li class="${i === idx ? "now" : i < idx ? "done" : ""}" title="${safe(e.label)} · ${safe(e.source)}"><span class="tl-when">${safe(when(e))}</span>${e.grace ? `<span class="tl-phase">${safe(e.grace.phase)}</span>` : ""}</li>`,
        )
        .join("") +
      "</ol>";
  }

  // ---------- demo timeline ----------
  function setMode(m) {
    mode = m;
    render();
  }
  function ensurePlan() {
    if (!plan) build();
  }
  function ensureApproved() {
    ensurePlan();
    if (!approved) $("confirm").onclick();
  }
  function ensureOutage(hour) {
    ensureApproved();
    if (!outage) $("startOutage").onclick();
    if (outage.elapsed < hour) advance(Math.min(hour, outage.duration) - outage.elapsed);
  }
  function silenceBatteries() {
    for (const x of C.demoSilent) {
      const h = homes.find((h) => h.id === x.home);
      if (h && h.online) {
        h.online = false;
        h.evidence = { ...h.evidence, ...x.evidence };
      }
    }
  }
  const STEPS = {
    tuesday: {
      enter() {
        loadRegion(region.id);
        V.view("operations");
        setMode("everyday");
        figure(tuesdayFigure());
      },
    },
    watch: {
      enter() {
        V.view("operations");
        setMode("prepare");
        figure(watchFigure());
      },
    },
    ask: {
      enter() {
        if (scenario.zip) {
          V.view("residents");
          $("sceZips").value = scenario.zip;
          $("seedContacts").click();
          $("notifyLevel").value = "prepare";
          $("reviewNotify").click();
        }
        figure(askFigure());
      },
      tick(t) {
        if (t >= 3 && $("notifyReview").open) $("confirmNotify").click();
      },
      leave() {
        if ($("notifyReview").open) $("confirmNotify").click();
      },
    },
    fill: {
      enter() {
        V.view("operations");
        homes.forEach((h) => Object.assign(h, { gridParticipation: false, exportPaused: true })); // export paused while filling
        mode = "prepare";
        build();
        log("FILL: export paused; staggered charging inside spare circuit capacity, medical-priority homes first.");
        figure(fillFigure());
      },
    },
    hold: {
      enter() {
        V.view("operations");
        ensurePlan();
        $("approve").onclick();
        mode = "outage";
        figure(holdFigure());
      },
      tick(t) {
        if (t >= 3 && $("review").open) $("confirm").onclick();
        if (t >= 4 && !outage) {
          ensureApproved();
          $("startOutage").onclick();
        }
        // 5 PM onward: one simulated hour every 2 seconds, up to 10 PM.
        if (outage && outage.elapsed < 5 && t >= 4 + 2 * (outage.elapsed + 1)) {
          advance(1);
          figure(holdFigure());
        }
      },
      leave() {
        if ($("review").open) $("confirm").onclick();
      },
    },
    silent: {
      enter() {
        V.view("operations");
        mode = "outage";
        ensureOutage(10); // 5 PM + 10 h = 3 AM
        silenceBatteries();
        log("3 AM: four batteries stopped reporting. Each keeps its local rule; capacity marked unverified.");
        render();
        figure(silentFigure());
      },
      tick(t) {
        if (outage && outage.elapsed < 14 && t >= (demo.done.nextAt ?? 4)) {
          advance(2); // toward 7 AM
          demo.done.nextAt = t + 2.5;
        }
      },
    },
    handoff: {
      enter() {
        V.view("operations");
        mode = "outage";
        ensureOutage(cfg.duration);
        silenceBatteries();
        render();
        const energies = Object.fromEntries(outage.devices.map((d) => [d.id, d.energy])),
          rc = M.recharge(homes, energies, cfg, scenario.recharge || { lead: 8, headroom: cfg.headroom });
        log(`HAND OFF: staggered recharge proposed (${fmt(rc.surgeKw)} → ${fmt(rc.staggeredKw)} kW peak); ${handoffItems().length} items to the operator.`);
        figure(handoffFigure(rc));
        $("handoffExport").onclick = () => download("PoweruP-trail-" + scenario.id + ".json", { ...trailDoc({ id: "demo", name: "Run demo replay" }), recharge: rc });
      },
    },
  };
  function caption() {
    const s = steps()[demo.i];
    $("captionBar").hidden = false;
    $("capStep").textContent = `${demo.i + 1} / ${steps().length}`;
    $("capTitle").textContent = s.title;
    $("capText").textContent = s.caption;
    $("capPause").textContent = demo.playing ? "❚❚ Pause" : "▶ Play";
    $("capNext").textContent = demo.i === steps().length - 1 ? "Finish" : "Next →";
    renderStrip();
  }
  function go(i) {
    const prev = steps()[demo.i];
    if (prev) STEPS[prev.id]?.leave?.();
    if (i >= steps().length) return stop(true);
    demo.i = i;
    demo.t = 0;
    demo.done = {};
    try {
      STEPS[steps()[i].id].enter();
    } catch (e) {
      log("Demo step error: " + e.message);
    }
    caption();
  }
  function tick() {
    if (!demo.playing || demo.i < 0) return;
    const now = performance.now();
    demo.t += (now - demo.last) / 1000;
    demo.last = now;
    const s = steps()[demo.i];
    try {
      STEPS[s.id].tick?.(demo.t);
    } catch (e) {
      log("Demo step error: " + e.message);
    }
    $("capProgress").style.width = Math.min(100, (demo.t / s.seconds) * 100) + "%";
    if (demo.t >= s.seconds) go(demo.i + 1);
  }
  function start() {
    if (!C || !region) return ready.then(() => C && region && start());
    demo.playing = true;
    demo.last = performance.now();
    clearInterval(demo.timer);
    demo.timer = setInterval(tick, 200);
    go(0);
  }
  function pause() {
    demo.playing = !demo.playing;
    demo.last = performance.now();
    caption();
  }
  function stop(finished) {
    clearInterval(demo.timer);
    demo.playing = false;
    demo.i = -1;
    $("captionBar").hidden = true;
    if (!finished) figure("");
    else log("Demo finished. Switch region, toggle a twist, open Pilot & Funding, or export the decision trail.");
  }

  // ---------- Pilot & Funding tab ----------
  function renderFunding() {
    const box = $("fundingBody");
    if (!box || !funding) return;
    const m = metrics(),
      by = Object.fromEntries((m || []).map((x) => [x.id, x])),
      n = homes.length || 1,
      line = (id, N) => {
        const x = by[id];
        if (!x) return "—";
        if (id === "kept") return `≈${Math.round((x.value / n) * N).toLocaleString()} of ${N.toLocaleString()} homes kept on through ${cfg.duration} h`;
        if (id === "backup") return `${fmt(x.value)} h backup per home vs ${fmt(x.baseline)} h without a plan`;
        if (id === "medical") {
          const total = parseInt(x.unit.replace("/", ""), 10) || 0;
          return `${x.value} of ${total} medical-priority homes protected in the model (${total ? Math.round((x.value / total) * 100) : 0}%)`;
        }
        if (id === "headroom") return `≈${fmt(((x.value / n) * N) / 1000, 2)} MW of peak headroom freed`;
        if (id === "value") return `≈${money((x.value / n) * N)} per peak event`;
        return "";
      };
    box.innerHTML =
      `<p class="small">${safe(funding.note)} Current model: ${safe(region?.name || "—")} ${badge(region?.provenance || "")}</p>` +
      funding.programs
        .map(
          (p) => `<div class="fund-card"><div class="eyebrow">${safe(p.role.toUpperCase())}</div><h3>${safe(p.name)}</h3><p>${safe(p.detail)} <span class="small">${safe(p.provenance)}</span></p>
          <table class="fig-table">${p.phases
            .map(
              (ph) =>
                `<tr><td><b>${safe(ph.phase)}</b></td><td>${safe(ph.goal)}</td><td>${ph.metrics.map((id) => `<div>${safe(line(id, ph.homes))} ${badge("ASSUMED")}</div>`).join("")}</td></tr>`,
            )
            .join("")}</table></div>`,
        )
        .join("");
  }

  // ---------- mount ----------
  function mount() {
    document.querySelector(".topbar").after(el("div", { id: "headline", className: "headline", role: "status" }));
    const bar = el("div", { className: "controlbar" });
    bar.append(el("div", { id: "regionPicker", className: "regionpicker" }), el("div", { id: "twistBar", className: "twistbar" }));
    document.querySelector(".pagehead").after(bar);
    const actions = document.querySelector(".global-actions");
    const run = el("button", { id: "runDemo", className: "primary run" }, "▶ Run demo"),
      toggle = el("button", { id: "demoToggle", title: "Bundled snapshots; no network calls" }, root.POWERUP_DEMO ? "Offline mode: ON" : "Offline demo mode"),
      poster = el("a", { href: "poster.html", target: "_blank", className: "button-link", title: "Print-ready 24×36 poster" }, "Poster ↗");
    actions.prepend(run, toggle, poster);
    // Pilot & Funding tab (rail button + view), driven by config/funding.json.
    const nav = document.querySelector(".rail-nav"),
      fbtn = el(
        "button",
        { className: "rail-button", title: "Pilot & Funding", ariaLabel: "Pilot & Funding" },
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M7 7h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8"/></svg><span>Pilot &amp; Funding</span>',
      );
    fbtn.dataset.view = "funding";
    nav.append(fbtn);
    const sec = el("section", { className: "app-view", hidden: true }, '<div class="panel fund"><div class="eyebrow">PILOT & FUNDING / EACH PHASE MAPS TO A METRIC THE APP COMPUTES</div><h2>Pilot &amp; Funding</h2><div id="fundingBody"></div></div>');
    sec.dataset.appView = "funding";
    document.querySelector('[data-app-view="residents"]').after(sec);
    fbtn.onclick = () => {
      V.view("funding");
      document.querySelector(".pagehead .eyebrow").textContent = "PILOT & FUNDING";
      renderFunding();
    };
    document.body.append(
      el("div", { id: "demoFigure", className: "demofigure", hidden: true }),
      el(
        "div",
        { id: "captionBar", className: "captionbar", hidden: true, role: "region", ariaLabel: "Demo narration" },
        '<div id="timeline" class="timeline"></div><div class="cap-progress"><span id="capProgress"></span></div><div class="cap-body"><span id="capStep" class="cap-step"></span><div><b id="capTitle"></b><p id="capText"></p></div><div class="cap-controls"><button id="capPause">❚❚ Pause</button><button id="capNext" class="primary">Next →</button><button id="capStop" title="Stop demo">✕</button></div></div>',
      ),
    );
    run.onclick = start;
    toggle.onclick = () => {
      const u = new URL(location.href);
      if (root.POWERUP_DEMO) u.searchParams.delete("demo");
      else u.searchParams.set("demo", "1");
      location.href = u.href;
    };
    $("capPause").onclick = pause;
    $("capNext").onclick = () => go(demo.i + 1);
    $("capStop").onclick = () => stop(false);
    document.addEventListener("keydown", (e) => {
      if (demo.i < 0 || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        pause();
      } else if (e.key === "ArrowRight") go(demo.i + 1);
      else if (e.key === "Escape") stop(false);
    });
    if (root.POWERUP_DEMO) document.body.classList.add("demo-mode");
  }
  const baseRender = render;
  render = function () {
    baseRender.apply(this, arguments);
    renderHeadline();
    const b = $("dataBadge");
    if (root.POWERUP_DEMO && !b.textContent.startsWith("OFFLINE")) b.textContent = "OFFLINE SNAPSHOTS · " + b.textContent;
  };
  mount();
  renderHeadline();
  const ready = Promise.all([
    getJSON("data/twists.json"),
    getJSON("config/regions/index.json"),
    getJSON("config/funding.json"),
    getJSON("data/snapshots/sce.json"),
    getJSON("data/snapshots/nws.json"),
  ])
    .then(async ([twists, index, fund, sce, nws]) => {
      C = root.PowerupConfig = twists;
      C.originalCriticalLoads = P.clone(C.criticalLoads);
      funding = fund;
      snaps = { sce, nws };
      for (const id of index.regions) {
        const r = M.validateRegion(await getJSON(`config/regions/${id}.json`));
        r.scenarioData = M.validateScenario(typeof r.scenario === "string" ? await getJSON(r.scenario) : r.scenario);
        R[id] = r;
      }
      writeInputs({ cfg, shield: shieldValues(), criticalLoads: P.clone(C.criticalLoads) });
      renderTwists();
      if (root.POWERUP_DEMO && !homes.length) {
        V.offline();
        if (new URLSearchParams(location.search).has("autoplay")) start();
      }
      const q = new URLSearchParams(location.search);
      region = R[q.get("region")] || R[index.default];
      }
      const q = new URLSearchParams(location.search);
      region = R[q.get("region")] || R[index.default];
      scenario = region.scenarioData;
      C.criticalLoads = P.clone(region.criticalLoads);
      renderRegionPicker();
      renderTwists();
      if (root.POWERUP_DEMO || q.has("region")) loadRegion(region.id);
      if (q.has("autoplay")) start();
      render();
    })
    .catch((e) => {
      $("runDemo").disabled = true;
      $("banner").textContent =
        "Demo config not loaded (" + e.message + "). Open through start-windows.bat / start-mac.sh, not by double-clicking the file.";
    });
  root.PowerupDemo = { start, pause, stop, go, loadRegion, handoffItems, decisions, toggleTwist, metrics, state: demo, ready };
})(globalThis);
