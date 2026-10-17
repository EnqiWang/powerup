/* PoweruP demo layer: headline metrics bar, twist toggles, decision-trail export and the
   one-click narrated "Run demo" timeline. Drives the existing app through its own functions;
   all planning stays in engine.js / advanced.js. Nothing here sends real commands or messages. */
(function (root) {
  "use strict";
  const M = root.PowerupDemoModel,
    V = root.PowerupVisual;
  let C = null,
    active = [],
    twistBase = null,
    trail = [],
    frozen = null;
  const demo = { i: -1, playing: false, t: 0, last: 0, timer: null, done: {} };

  // ---------- shared helpers ----------
  const el = (tag, attrs = {}, html = "") => Object.assign(document.createElement(tag), attrs, { innerHTML: html });
  function download(name, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })),
      a = el("a", { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  function safeHeadline(hs, c, pl) {
    try {
      return hs.length ? M.headline(hs, c, prices, pl) : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- headline metrics bar (always visible) ----------
  function renderHeadline() {
    const bar = $("headline");
    if (!bar) return;
    let m = safeHeadline(homes, cfg, plan);
    const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "—");
    // During an outage the planning numbers freeze at outage start; "kept powered" goes live and counts
    // only verified (talking) batteries that have not run short.
    if (!outage) frozen = null;
    else if (m) {
      frozen = frozen || m;
      const silent = homes.filter((h) => !P.classifySilent(h, homes).verified).length,
        live = homes.filter(
          (h) => P.classifySilent(h, homes).verified && outage.devices.find((d) => d.id === h.id).unservedKwh < 1e-6,
        ).length;
      m = frozen.map((x) =>
        x.id === "kept"
          ? { ...x, value: live, detail: `verified at hour ${f(outage.elapsed)} · ${silent} silent` }
          : x,
      );
    }
    if (!m) {
      bar.innerHTML =
        '<div class="hl-empty">Headline metrics appear once a fleet is loaded. Press <b>▶ Run demo</b> for the 3-minute story.</div>';
      return;
    }
    bar.innerHTML = m
      .map((x) => {
        const value = x.id === "value" ? "$" + f(x.value, 2) : f(x.value, x.id === "headroom" ? 1 : 0);
        return `<div class="hl" title="${safe(x.sources)}"><span class="hl-label">${safe(x.label)} <i class="prov ${x.provenance.toLowerCase()}">${x.provenance}</i></span><strong>${value}<small> ${safe(x.unit)}</small></strong><span class="hl-detail">${safe(x.detail)}</span></div>`;
      })
      .join("");
  }

  // ---------- twists ----------
  function renderTwists() {
    const box = $("twistBar");
    if (!box || !C) return;
    const alerts = (root.weatherSnapshot || weatherSnapshot)?.alerts || [];
    box.innerHTML =
      '<span class="twist-title">TWISTS <i class="prov assumed">ASSUMED</i></span>' +
      C.twists
        .map((t) => {
          const on = active.includes(t.id),
            ev = t.evidenceAlert && alerts.find((a) => a.event === t.evidenceAlert);
          return `<label class="twist ${on ? "on" : ""}" title="${safe(t.summary)}"><input type="checkbox" data-twist="${t.id}" ${on ? "checked" : ""}> ${safe(t.name)}${ev ? ' <i class="prov real" title="Bundled/loaded NWS response">NWS: ' + safe(ev.event) + "</i>" : ""}${on ? `<button class="trail" data-trail="${t.id}" title="Export decision trail for this twist">⇩ trail</button>` : ""}</label>`;
        })
        .join("");
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
      $("banner").textContent = "Load a fleet first (Run demo or Use saved SCE usage), then apply twists.";
      renderTwists();
      return;
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
    const relief = (() => {
      try {
        return P.relief(
          homes.map((h) => ({ ...h, energy: projectedEnergy(h) })),
          cfg,
          shieldInputs(),
        );
      } catch (e) {
        return { error: e.message };
      }
    })();
    return {
      homes: homes.map((h) => {
        const b = viewBudget(h);
        return {
          id: h.id,
          name: h.name,
          classification: P.classifySilent(h, homes),
          budget: { budgetKw: b.budgetKw, plannedKw: b.plannedKw, runtimeH: b.runtime, targetMet: b.targetMet, shortfallKwh: b.shortfallKwh },
        };
      }),
      relief,
      handoff: handoffItems(),
    };
  }
  function exportTrail(id) {
    const t = C.twists.find((t) => t.id === id);
    let before = null;
    try {
      before = twistBase && M.headline(twistBase.homes, twistBase.cfg, prices, P.prepare(twistBase.homes, twistBase.cfg));
    } catch (e) {}
    download(`PoweruP-trail-${id}.json`, {
      schema: "powerup.decision-trail.v1",
      simulation: true,
      exportedAt: new Date().toISOString(),
      twist: t,
      activeTwists: active,
      demoMode: !!root.POWERUP_DEMO,
      dataSource: source && { kind: source.kind, source: source.source, location: source.location },
      battery: C.battery,
      inputs: { cfg, prices, shield: shieldValues(), criticalLoads: C.criticalLoads },
      effectsApplied: trail,
      metricsBefore: before,
      metricsAfter: safeHeadline(homes, cfg, plan),
      decisions: decisions(),
      approved,
      events,
    });
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
          detail: `${n.kw} kW, ${n.graceHours} h grace. Needs utility or mobile generation; home batteries cannot feed it through a de-energized feeder.`,
        });
    return items;
  }

  // ---------- figures shown above the caption bar ----------
  function figure(html) {
    const f = $("demoFigure");
    f.innerHTML = html || "";
    f.hidden = !html;
  }
  function headroomFigure() {
    const rush = M.unmanagedCurve(homes, cfg),
      stag = plan?.trace || [],
      top = Math.max(cfg.headroom * 1.2, ...rush.map((x) => x.total), 1),
      W = 420,
      H = 130,
      line = (pts) =>
        pts.map((p, i) => `${i ? "L" : "M"}${((p.hour / cfg.lead) * W).toFixed(1)},${(H - (p.total / top) * H).toFixed(1)}`).join(""),
      y = H - (cfg.headroom / top) * H;
    return `<div class="fig-title">Shared feeder headroom · ${cfg.lead} h before shutoff <i class="prov assumed">ASSUMED</i></div>
      <svg viewBox="-2 -6 ${W + 4} ${H + 22}" class="fig-chart" role="img" aria-label="Charging demand: everyone at 4 PM versus staggered">
        <line x1="0" x2="${W}" y1="${y}" y2="${y}" class="fig-limit"/><text x="${W}" y="${y - 4}" text-anchor="end" class="fig-limit-t">feeder headroom ${cfg.headroom} kW</text>
        <path d="${line(rush)}" class="fig-rush"/><path d="${line(stag)}" class="fig-stag"/>
        <text x="0" y="${H + 14}" class="fig-axis">4 PM</text><text x="${W}" y="${H + 14}" text-anchor="end" class="fig-axis">+${cfg.lead} h</text></svg>
      <div class="fig-legend"><span class="k rush"></span>Everyone charges at 4 PM · peak ${fmt(Math.max(...rush.map((x) => x.total)))} kW <span class="k stag"></span>PoweruP staggered · peak ${fmt(Math.max(0, ...stag.map((x) => x.total)))} kW</div>`;
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
    return `<div class="fig-title">Silent-battery classifier <i class="prov assumed">SCENARIO EVIDENCE</i></div><table class="fig-table">${rows || "<tr><td>All batteries reporting.</td></tr>"}</table>`;
  }
  function handoffFigure() {
    const items = handoffItems();
    return `<div class="fig-title">Operator handoff · ${items.length} items</div><table class="fig-table">${items
      .map((x) => `<tr><td><b>${safe(x.kind)}</b></td><td>${safe(x.who)}</td><td class="small">${safe(x.detail)}</td></tr>`)
      .join("")}</table><button id="handoffExport" class="primary">⇩ Export decision trail</button>`;
  }
  function weatherFigure() {
    const w = weatherSnapshot,
      list = (w?.alerts || []).map((a) => `<li><b>${safe(a.event)}</b> · ${safe(a.headline || "")}</li>`).join("");
    return `<div class="fig-title">National Weather Service ${w?.snapshot ? "snapshot" : "response"} <i class="prov real">REAL</i></div>
      <div class="small">${safe(w?.location || "LA point")} · fetched ${w ? new Date(w.fetchedAt).toLocaleString() : "—"}</div>
      <ul class="fig-list">${list || "<li>No active alerts in this response.</li>"}</ul>
      <div class="small">Fire-weather shutoff warning in this story: <i class="prov assumed">SCENARIO</i> — not claimed from NWS.</div>`;
  }

  // ---------- demo timeline ----------
  function setupFleet() {
    outage = null;
    active = [];
    twistBase = null;
    trail = [];
    V.offline(); // fresh six-ZIP fleet from the saved SCE snapshot (no network)
    const b = C.baseCase;
    Object.assign(cfg, b.cfg);
    Object.assign(prices, b.prices);
    for (const k of Object.keys(b.prices)) $(k).value = b.prices[k];
    writeInputs({ cfg, shield: b.shield, criticalLoads: P.clone(C.originalCriticalLoads) });
    homes.forEach((h) => {
      h.gridParticipation = b.residentsOptIn;
      h.loads.forEach((l) => {
        if (l.id === "essential") return;
        l.consent = "accepted";
        l.consentHours = cfg.duration;
        l.gridAccepted = true;
      });
    });
    changed("Demo fleet: six LA ZIP homes, residents enrolled (scenario consent), 72 h planning horizon.");
    renderTwists();
  }
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
    if (outage.elapsed < hour) advance(hour - outage.elapsed);
  }
  const STEPS = {
    tuesday: {
      enter() {
        setupFleet();
        V.view("operations");
        setMode("everyday");
        figure("");
      },
    },
    dispatcher: {
      enter() {
        V.view("operations");
        setMode("shield");
        figure("");
      },
    },
    fire: {
      enter() {
        fetch("/api/weather?lat=34.025&lon=-118.3")
          .then((r) => (r.ok ? r.json() : null))
          .then((w) => {
            if (w) weatherSnapshot = w;
            if (demo.i >= 0 && order()[demo.i] === "fire") figure(weatherFigure());
            renderTwists();
          })
          .catch(() => {});
        V.view("residents");
        $("seedContacts").click();
        $("notifyLevel").value = "prepare";
        $("reviewNotify").click();
        figure(weatherFigure());
      },
      tick(t) {
        if (t >= 4 && !demo.done.alert && $("notifyReview").open) {
          demo.done.alert = true;
          $("confirmNotify").click();
        }
      },
      leave() {
        if ($("notifyReview").open) $("confirmNotify").click();
      },
    },
    prepare: {
      enter() {
        V.view("operations");
        mode = "prepare";
        build();
        figure(headroomFigure());
      },
    },
    approve: {
      enter() {
        ensurePlan();
        $("approve").onclick();
        figure("");
      },
      tick(t) {
        if (t >= 5 && $("review").open) $("confirm").onclick();
      },
      leave() {
        if (!approved) $("confirm").onclick();
      },
    },
    outage: {
      enter() {
        ensureApproved();
        mode = "outage";
        if (!outage) $("startOutage").onclick();
        figure("");
      },
      tick(t) {
        // 6 PM → 3 AM: one simulated hour every 2 seconds.
        if (outage && outage.elapsed < 9 && t >= 2 * (outage.elapsed + 1)) advance(1);
      },
    },
    silent: {
      enter() {
        mode = "outage";
        ensureOutage(9);
        for (const x of C.demoSilent) {
          const h = homes.find((h) => h.id === x.home);
          if (h) {
            h.online = false;
            h.evidence = { ...h.evidence, ...x.evidence };
          }
        }
        log("3 AM: four batteries stopped reporting. Devices continue their local plan; capacity marked unverified.");
        render();
        figure(silentFigure());
      },
      tick(t) {
        // Remaining outage hours (3 AM → hour 72) run in 9-hour jumps while the classifier is on screen.
        if (outage && outage.elapsed < outage.duration && t >= (demo.done.nextAt ?? 3)) {
          advance(9);
          demo.done.nextAt = t + 2.5;
        }
      },
    },
    handoff: {
      enter() {
        mode = "outage";
        ensureOutage(cfg.duration);
        render();
        log(`Operator handoff: ${handoffItems().length} items the fleet cannot cover.`);
        figure(handoffFigure());
        $("handoffExport").onclick = () =>
          download("PoweruP-trail-demo.json", {
            schema: "powerup.decision-trail.v1",
            simulation: true,
            exportedAt: new Date().toISOString(),
            twist: { id: "demo", name: "Run demo timeline" },
            battery: C.battery,
            inputs: { cfg, prices, shield: shieldValues(), criticalLoads: C.criticalLoads },
            metrics: safeHeadline(homes, cfg, plan),
            decisions: decisions(),
            events,
          });
      },
    },
  };
  const order = () => C.demoScript.map((s) => s.id);
  function caption() {
    const s = C.demoScript[demo.i],
      bar = $("captionBar");
    bar.hidden = false;
    $("capStep").textContent = `${demo.i + 1} / ${C.demoScript.length}`;
    $("capTitle").textContent = s.title;
    $("capText").textContent = s.caption;
    $("capPause").textContent = demo.playing ? "❚❚ Pause" : "▶ Play";
    $("capNext").textContent = demo.i === C.demoScript.length - 1 ? "Finish" : "Next →";
  }
  function go(i) {
    const prev = C.demoScript[demo.i];
    if (prev) STEPS[prev.id]?.leave?.();
    if (i >= C.demoScript.length) return stop(true);
    demo.i = i;
    demo.t = 0;
    try {
      STEPS[C.demoScript[i].id].enter();
    } catch (e) {
      log("Demo step error: " + e.message);
    }
    caption();
  }
  function tick() {
    if (!demo.playing || demo.i < 0) return;
    const now = performance.now(),
      dt = (now - demo.last) / 1000;
    demo.last = now;
    demo.t += dt;
    const s = C.demoScript[demo.i];
    try {
      STEPS[s.id].tick?.(demo.t);
    } catch (e) {
      log("Demo step error: " + e.message);
    }
    $("capProgress").style.width = Math.min(100, (demo.t / s.seconds) * 100) + "%";
    if (demo.t >= s.seconds) go(demo.i + 1);
  }
  function start() {
    if (!C) return ready.then(() => C && start());
    demo.done = {};
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
    else log("Demo finished. Explore any panel, toggle a twist, or export the decision trail.");
  }

  // ---------- mount ----------
  function mount() {
    document.querySelector(".topbar").after(el("div", { id: "headline", className: "headline", role: "status" }));
    document.querySelector(".pagehead").after(el("div", { id: "twistBar", className: "twistbar" }));
    const actions = document.querySelector(".global-actions");
    const run = el("button", { id: "runDemo", className: "primary run" }, "▶ Run demo");
    const toggle = el("button", { id: "demoToggle", title: "Bundled snapshots; no network calls" }, root.POWERUP_DEMO ? "Demo mode: ON" : "Offline demo mode");
    actions.prepend(run, toggle);
    document.body.append(
      el("div", { id: "demoFigure", className: "demofigure", hidden: true }),
      el(
        "div",
        { id: "captionBar", className: "captionbar", hidden: true, role: "region", ariaLabel: "Demo narration" },
        '<div class="cap-progress"><span id="capProgress"></span></div><div class="cap-body"><span id="capStep" class="cap-step"></span><div><b id="capTitle"></b><p id="capText"></p></div><div class="cap-controls"><button id="capPause">❚❚ Pause</button><button id="capNext" class="primary">Next →</button><button id="capStop" title="Stop demo">✕</button></div></div>',
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
    if (root.POWERUP_DEMO) {
      $("dataBadge").textContent = "DEMO MODE · BUNDLED SNAPSHOTS · NO NETWORK";
      document.body.classList.add("demo-mode");
    }
  }
  const baseRender = render;
  render = function () {
    baseRender.apply(this, arguments);
    renderHeadline();
    const badge = $("dataBadge");
    if (root.POWERUP_DEMO && !badge.textContent.startsWith("DEMO")) badge.textContent = "DEMO SNAPSHOTS · " + badge.textContent;
  };
  mount();
  renderHeadline();
  const ready = fetch("data/twists.json")
    .then((r) => {
      if (!r.ok) throw Error("HTTP " + r.status);
      return r.json();
    })
    .then((config) => {
      C = root.PowerupConfig = config;
      C.originalCriticalLoads = P.clone(C.criticalLoads);
      writeInputs({ cfg, shield: shieldValues(), criticalLoads: P.clone(C.criticalLoads) });
      renderTwists();
      if (root.POWERUP_DEMO && !homes.length) {
        V.offline();
        if (new URLSearchParams(location.search).has("autoplay")) start();
      }
      render();
    })
    .catch((e) => {
      $("runDemo").disabled = true;
      $("banner").textContent =
        "Demo config not loaded (" + e.message + "). Open through start-windows.bat / start-mac.sh, not by double-clicking the file.";
    });
  root.PowerupDemo = { start, pause, stop, go, handoffItems, decisions, toggleTwist, state: demo };
})(globalThis);
