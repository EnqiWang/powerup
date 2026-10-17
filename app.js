"use strict";
const $ = (id) => document.getElementById(id),
  P = Powerup,
  fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : "—");
const safe = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
function labelProfile(h) {
  // Scenario fleets (demo-model.js buildFleet) carry their own circuit/site names.
  if (h.fixedName) {
    h.name = h.fixedName;
    return h;
  }
  const m = h.measurement;
  const zip =
    m?.kind === "zip-benchmark"
      ? [h.zip, m.zip, m.zipCode, m.location, h.name]
          .map((v) => String(v ?? ""))
          .join(" ")
          .match(/\b\d{5}\b/)?.[0]
      : null;
  h.name = zip
    ? `ZIP ${zip} · Usage scenario`
    : h.measurement
      ? String(h.name || `Measured profile ${h.id}`)
      : `Unconfigured profile ${h.id}`;
  return h;
}
function decorate(h) {
  labelProfile(h);
  h.gridParticipation = !!h.gridParticipation;
  h.provider = h.provider || "Scenario Network " + (h.id % 2 ? "A" : "B");
  h.evidence = h.evidence || { fresh: false, voltage: 120, breaker: "unknown", fault: false };
  h.exportCap = h.exportCap || 3;
  h.prepTasks = h.prepTasks || [
    { id: "ev", name: "EV top-up", kwh: 2, rate: 1, enabled: false, accepted: false },
    { id: "precool", name: "Preconditioning", kwh: 0.5, rate: 0.5, enabled: false, accepted: false },
  ];
  return h;
}
let weatherSnapshot = null;
let homes = [],
  selected = null,
  mode = "prepare",
  cfg = { duration: 24, lead: 6, headroom: 8, floor: 0.2 },
  prices = { buy: 0.15, sell: 0.4, eventHours: 2, dailyReserve: 6 },
  plan = null,
  approved = false,
  outage = null,
  source = null,
  events = [];
function log(message) {
  events.unshift({ time: new Date().toLocaleTimeString(), message });
  events = events.slice(0, 50);
  $("log").innerHTML = events
    .map((e) => `<div class="event"><time>${safe(e.time)}</time>${safe(e.message)}</div>`)
    .join("");
}
function changed(reason) {
  plan = null;
  approved = false;
  outage = null;
  try {
    if (homes.length) {
      plan = P.prepare(homes, cfg);
      $("projected").checked = true;
    }
    log(reason + " Preview recalculated automatically; approval cleared.");
  } catch (error) {
    log("Preview could not update: " + error.message);
  }
  render();
}
function bindAutomaticInputs() {
  const bind = (el, find) => {
    if (!el || typeof el.onchange !== "function") return;
    const change = el.onchange;
    el.oninput = () => {
      if (el.value === "" || (typeof el.checkValidity === "function" && !el.checkValidity())) return;
      const value = el.value,
        focused = document.activeElement === el,
        scroll = $("detail").scrollTop;
      change({ target: el });
      // Detail controls are redrawn; preserve typing focus and the resident's raw entry.
      const next = find();
      if (focused && next) {
        next.value = value;
        next.focus({ preventScroll: true });
        $("detail").scrollTop = scroll;
      }
    };
  };
  for (const id of [
    "duration",
    "lead",
    "headroom",
    "floor",
    "soc",
    "rate",
    "buy",
    "sell",
    "eventHours",
    "dailyReserve",
    "feederCapacity",
    "reliefHours",
    "coldKw",
    "commsKw",
    "portKw",
  ]) {
    const el = document.getElementById(id);
    bind(el, () => document.getElementById(id));
  }
  for (const attr of ["load", "window", "taskenergy", "taskrate"])
    document.querySelectorAll("[data-" + attr + "]").forEach((el) => {
      const key = el.dataset[attr];
      bind(el, () =>
        Array.from(document.querySelectorAll("[data-" + attr + "]")).find((n) => n.dataset[attr] === key),
      );
    });
}
function projectedEnergy(h) {
  if (outage) return outage.devices.find((d) => d.id === h.id).energy;
  return $("projected").checked && plan ? plan.homes.find((x) => x.id === h.id).energy : h.energy;
}
function viewBudget(h) {
  if (outage)
    return P.outageBudget(
      outage.devices.find((d) => d.id === h.id),
      outage.elapsed,
      cfg.duration,
    );
  return P.budget(h, cfg, projectedEnergy(h));
}

function renderEmpty() {
  $("fleetTitle").textContent = "ZIP readiness scenarios";
  $("metrics").innerHTML =
    '<div class="metric"><span class="small">DATA STATUS</span><strong>Awaiting ZIP data</strong><span class="small">No invented households</span></div><div class="metric"><span class="small">PLANNING</span><strong>Not started</strong><span class="small">Load SCE records above</span></div><div class="metric"><span class="small">BATTERIES</span><strong>Scenario only</strong><span class="small">No enrolled devices connected</span></div>';
  $("map").innerHTML =
    '<div class="empty-message">Load real SCE ZIP benchmarks to begin.<br><span class="small">Each card will show the selected ZIP, its historical monthly average and a clearly labeled battery scenario. No individual houses are invented.</span></div>';
  $("selectedName").textContent = "Select a ZIP after loading";
  $("selectedStatus").textContent = "NO DATA";
  $("detail").innerHTML =
    '<div class="padding"><p>ZIP consumption records appear after the API loads.</p><p class="small">Public SCE records cannot identify individual homes. Actual household measurements can also be imported separately.</p></div>';
  $("chartTitle").textContent = "Preparation charging";
  $("chartLabel").textContent = "Awaiting demand inputs";
  $("chart").innerHTML =
    '<p class="small">Calculations appear automatically after loading ZIP records or measured profiles.</p>';
  $("banner").textContent =
    "Load SCE API above to create ZIP-based usage scenarios. No household loads or readiness scores have been invented.";
  for (const id of ["plan", "approve", "projected", "startOutage", "advance", "finish", "simulatePeerLoss"])
    $(id).disabled = true;
  $("outageControls").hidden = mode !== "outage";
  $("shieldControls").hidden = mode !== "shield";
  $("priceControls").hidden = mode !== "everyday";
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("ladder").innerHTML =
    '<div><span class="eyebrow">START WITH EVIDENCE</span><p>Awaiting ZIP or household demand data.</p></div>';
  if (typeof renderReadiness === "function") renderReadiness();
  if (typeof PowerupScene !== "undefined")
    PowerupScene.render($("map"), {
      homes: [],
      selected: null,
      viewBudget,
      projectedEnergy,
      select: () => {},
    });
}
function render() {
  if (!homes.length) {
    renderEmpty();
    return;
  }
  $("simulatePeerLoss").disabled = false;
  homes.forEach(labelProfile);
  $("fleetTitle").textContent = homes.some((h) => h.measurement?.kind === "zip-benchmark")
    ? "ZIP readiness scenarios"
    : "Measured profile readiness";
  const known = homes.filter((h) => h.online),
    budgets = known.map((h) => viewBudget(h)),
    ready = budgets.filter((b) => b.targetMet).length,
    coverage = budgets.reduce(
      (s, b) =>
        s +
        Math.min(
          outage ? Math.max(0, cfg.duration - outage.elapsed) : cfg.duration,
          b.runtime ?? cfg.duration,
        ),
      0,
    ),
    peak = plan ? Math.max(0, ...plan.trace.map((t) => t.total)) : null;
  let metrics = [
    [
      "MODELED PROFILES MEETING TARGET",
      ready + " / " + homes.length,
      `${homes.length - known.length} unknown · ${known.length - ready} known shortfalls`,
    ],
    [
      "ESSENTIAL & RETAINED LOAD COVERAGE",
      fmt(coverage) + " h",
      "Sum of modeled profile-hours, capped at target",
    ],
    [
      "PREVIEW STATUS",
      approved ? "Approved" : plan ? "Updated" : "Awaiting data",
      outage ? `${fmt(outage.elapsed)} / ${cfg.duration} hours replayed` : "No real commands sent",
    ],
  ];
  if (mode === "everyday") {
    const day = P.everyday(homes, { ...cfg, duration: prices.dailyReserve }, prices);
    metrics = [
      [
        "INDICATIVE GRID EXPORT",
        fmt(day.exportKwh) + " kWh",
        "After household reserve protection; energy-only estimate",
      ],
      [
        "MODELED CONTRIBUTION",
        "$" + day.margin.toFixed(2),
        "Export credit less future recharge cost; illustrative prices",
      ],
      [
        "PROTECTED PROFILES",
        known.length + " / " + homes.length,
        "Unknown capacity excluded · no actual utility dispatch",
      ],
    ];
  }
  $("metrics").innerHTML = metrics
    .map(
      (m) =>
        `<div class="metric"><span class="small">${m[0]}</span><strong>${m[1]}</strong><span class="small">${m[2]}</span></div>`,
    )
    .join("");
  $("modeTitle").textContent = {
    shield: "Find the gentlest relief.",
    prepare: "Prepare before disruption.",
    outage: "Make stored energy last.",
    everyday: "Support the grid with care.",
  }[mode];
  $("modeDescription").textContent = {
    shield:
      "Fleet dispatcher: reduce a modeled neighborhood constraint without touching external critical loads.",
    prepare: "Fleet dispatcher: allocate limited charging headroom and verify household readiness.",
    outage: "Fleet dispatcher: set a duration target, apply accepted reductions, and escalate shortfalls.",
    everyday:
      "Second customer: utility demand-response dispatcher evaluating peak relief on an ordinary Tuesday.",
  }[mode];
  $("shieldControls").hidden = mode !== "shield";
  $("outageControls").hidden = mode !== "outage";
  $("priceControls").hidden = mode !== "everyday";
  $("approve").disabled = !plan || approved || !!outage;
  $("plan").disabled = !!outage;
  $("projected").disabled = !!outage;
  $("startOutage").disabled = !!outage;
  $("advance").disabled = !outage || outage.elapsed >= cfg.duration;
  $("finish").disabled = $("advance").disabled;
  $("banner").textContent =
    mode === "everyday"
      ? "Ordinary Tuesday scenario: estimated export uses only stored energy above the modeled household reserve. Prices and market access are assumptions. Household service during the event and inverter power constraints require separate validation."
      : outage
        ? `OUTAGE SIMULATOR · ${fmt(outage.elapsed)} hours elapsed. ${ready} known profiles can cover the remaining target; ${known.length - ready} need follow-up. Unknown devices remain unverified to the dispatcher. Local simulator state is shown separately.`
        : `${cfg.duration}-hour target, ${cfg.lead}-hour preparation window, ${cfg.headroom} kW charging headroom. Resident load shares and battery state are scenario inputs. ${approved ? "Preparation approved for simulation." : plan ? "Preview updated automatically; ready for review." : "Valid input changes recalculate the preview automatically."}`;
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  renderMap();
  renderDetail();
  renderChart();
  if (typeof renderAdvanced === "function") renderAdvanced();
  if (typeof PowerupVisual !== "undefined") PowerupVisual.sync();
  bindAutomaticInputs();
}
function renderMap() {
  if (typeof PowerupScene !== "undefined") {
    PowerupScene.render($("map"), {
      homes,
      selected,
      viewBudget,
      projectedEnergy,
      select: (id) => {
        selected = id;
        renderMap();
        renderDetail();
      },
    });
    return;
  }
  if (!document.getElementById("profileCardStyles")) {
    const style = document.createElement("style");
    style.id = "profileCardStyles";
    style.textContent =
      '#map{padding:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}#map .profile-card{display:flex;flex-direction:column;gap:10px;text-align:left;background:#fff;border:1px solid #dce3d5;border-radius:12px;padding:16px;min-width:0;color:#25372a}#map .profile-card[aria-pressed="true"]{border:2px solid #2672c7;padding:15px;background:#f3f8ff}#map .profile-card:focus-visible{outline:3px solid #2672c7;outline-offset:3px}#map .profile-runtime{font-size:28px;font-weight:700}#map .profile-status{font-size:12px;font-weight:700}#map .profile-note{font-size:12px;line-height:1.5;color:#596451}';
    document.head.appendChild(style);
  }
  $("map").innerHTML = homes
    .map((h) => {
      labelProfile(h);
      const b = viewBudget(h),
        color = !h.online ? "#697367" : b.targetMet ? "#168366" : "#b45c14";
      const target = outage ? Math.max(0, cfg.duration - outage.elapsed) : cfg.duration;
      const status = !h.online ? "Unknown" : b.targetMet ? "Target met" : "Shortfall";
      return `<button type="button" class="profile-card" data-home="${safe(h.id)}" aria-pressed="${h.id === selected}" aria-label="${safe(h.name)}: ${status}. Select profile"><strong>${safe(h.name)}</strong>${h.measurement?.kind === "zip-benchmark" ? `<span class="profile-note">${Number(h.measurement.monthlyKwh).toFixed(1)} kWh/account/month · ${safe(h.measurement.first)}<br>${safe(h.measurement.accounts ?? "Unreported")} SCE accounts in source</span>` : ""}<span class="profile-note">${h.measurement?.kind === "zip-benchmark" ? "Historical SCE ZIP average" : h.measurement ? "Historical household measurement" : "Unconfigured profile"} · simulated battery</span><span class="profile-runtime">${h.online ? fmt(b.runtime) + " h" : "Unverified"}</span><span class="profile-status" style="color:${color}">${status} · ${fmt(target)} h target</span><span class="profile-note">${h.online ? fmt(b.shortfallKwh) + " kWh stored-energy shortfall" : "Connection unknown; capacity excluded"}<br>${outage ? "Remaining simulated backup" : $("projected").checked && plan ? "Projected preparation backup" : "Backup from scenario inputs"}</span></button>`;
    })
    .join("");
  $("map")
    .querySelectorAll("[data-home]")
    .forEach((el) => {
      el.onclick = () => {
        selected = +el.dataset.home;
        renderMap();
        renderDetail();
        $("map").querySelector(`[data-home="${selected}"]`)?.focus();
      };
    });
}
function renderDetail() {
  const h = homes.find((h) => h.id === selected),
    b = viewBudget(h),
    energy = projectedEnergy(h),
    d = outage?.devices.find((d) => d.id === h.id),
    disabled = outage ? "disabled" : "";
  $("selectedName").textContent = h.name;
  $("selectedStatus").textContent = h.online ? "ONLINE (SIM)" : "UNKNOWN";
  $("selectedStatus").className = "status" + (h.online ? "" : " unknown");
  const actions = b.actions.length
    ? b.actions
        .map(
          (a) =>
            `${safe(a.name)}: reduce ${Math.round(a.reduction * 100)}% (−${fmt(a.savedKw)} kW) until hour ${fmt(a.untilHours)}`,
        )
        .join("<br>")
    : "No accepted reductions selected.";
  const measured = h.measurement
    ? `<div class="insight">${h.measurement.kind === "zip-benchmark" ? "Representative scenario from ZIP monthly average" : "Historical measured proxy"}: ${fmt(h.meanKw)} kW.<br>${safe(h.measurement.location)}<br>${safe(h.measurement.first)} → ${safe(h.measurement.last)}<br>Appliance shares below are editable assumptions, not inferred essential needs.</div>`
    : '<div class="insight">Demo profile. All loads and battery readings are simulated; this does not represent an enrolled household.</div>';
  const header = `${measured}<div class="small">${outage ? "REMAINING SIMULATED BACKUP" : $("projected").checked && plan ? "PROJECTED PREPARATION BACKUP" : "SCENARIO BACKUP"}</div><div class="number">${h.online ? fmt(b.runtime) + " h" : "Unverified"}</div><div class="small">${fmt(b.baseKw)} kW baseline → ${fmt(b.plannedKw)} kW with accepted changes</div><div class="bar"><div style="width:${Math.min(100, (energy / h.capacity) * 100)}%"></div></div><div class="subrow"><span>${fmt(energy)} / ${h.capacity} kWh</span><span>${fmt(b.budgetKw)} kW budget</span></div><div class="insight ${b.targetMet ? "" : "red"}">${b.targetMet ? "Target feasible in this constant-load model." : `Target unmet: ${fmt(b.shortfallKwh)} additional stored kWh needed. Operator assistance required.`}<br>${actions}</div>${!h.online ? '<div class="insight red">Dispatcher cannot confirm battery operation. Recheck status and exclude unverified capacity from new dispatch.</div>' : ""}${d && !h.online ? `<details><summary>Local simulator observer (not telemetry)</summary><p class="small">Stored policy continues at ${fmt(d.plannedKw)} kW in this simulator. Remaining simulated energy: ${fmt(d.energy)} kWh. This does not establish actual offline firmware operation.</p></details>` : ""}${d ? `<div class="small">Unserved energy during replay: ${fmt(d.unservedKwh)} kWh. Required loads are never deliberately curtailed, but depletion can still interrupt them.</div>` : ""}
 <div class="fields"><label>Starting charge (%)<input id="soc" type="number" min="0" max="100" step="1" value="${Math.round((h.energy / h.capacity) * 100)}" ${disabled}></label><label>Charge cap (kW)<input id="rate" type="number" min="0.1" max="100" step="0.1" value="${h.rate}" ${disabled}></label></div><label>Operator priority<select id="priority" ${disabled}><option value="3">High</option><option value="2">Medium</option><option value="1">Standard</option></select></label><button id="disconnect" class="wide">${h.online ? "Simulate lost connection" : "Restore simulated connection"}</button>`;
  const loads = `<div><h3>Resident flexibility</h3><p class="small">Record a simulated resident response for each allowance. Essential loads stay protected. A missing response grants no permission.</p>${h.loads.map((l) => `<div class="load"><h3>${safe(l.name)}</h3><div class="loadgrid"><label>Average kW<input data-load="${l.id}" type="number" min="0" max="100" step="0.001" value="${l.kw.toFixed(3)}" ${disabled}></label><label>${l.id === "essential" ? "Required service" : "Simulated resident response"}<select data-consent="${l.id}" ${disabled || l.id === "essential" ? "disabled" : ""}><option value="required">Required · preserve</option><option value="unasked">No response</option><option value="accepted">Accept for window below</option><option value="declined">Decline reduction</option></select></label></div><div class="small">${l.id === "essential" ? "Never intentionally reduced." : `Available reduction: ${Math.round(l.reduction * 100)}% of this average allowance.`}</div>${l.id !== "essential" ? `<label>Consent window (hours from outage start)<input data-window="${l.id}" type="number" min="0.25" max="168" step="0.25" value="${l.consentHours || 6}" ${disabled}></label><label class="toggle"><input data-gridconsent="${l.id}" type="checkbox" ${l.gridAccepted ? "checked" : ""} ${disabled}> Also permit this reduction for grid support</label>` : ""}</div>`).join("")}<button id="requestFlex" class="wide" ${disabled}>Create flexibility request (demo)</button><p class="small">No messages sent. No thermostat, EV or smart-panel integration.</p></div>`;
  $("detail").innerHTML = "<div>" + header + "</div>" + loads;
  $("priority").value = h.priority;
  $("soc").onchange = (e) => {
    if (e.target.reportValidity()) {
      h.energy = (h.capacity * +e.target.value) / 100;
      changed(h.name + ": starting charge updated.");
    }
  };
  $("rate").onchange = (e) => {
    if (e.target.reportValidity()) {
      h.rate = +e.target.value;
      changed(h.name + ": scenario charge cap updated.");
    }
  };
  $("priority").onchange = (e) => {
    h.priority = +e.target.value;
    changed(h.name + ": priority changed.");
  };
  $("disconnect").onclick = () => {
    h.online = !h.online;
    approved = false;
    plan = null;
    if (outage) {
      outage.devices.find((d) => d.id === h.id).offline = !h.online;
      log(
        h.name +
          ": " +
          (h.online
            ? "simulated reconnection."
            : "connection lost. Dispatcher state unknown; local simulator policy remains in effect."),
      );
      render();
    } else
      changed(
        h.name +
          ": " +
          (h.online ? "simulated connection restored." : "connection lost; unknown capacity excluded."),
      );
  };
  document.querySelectorAll("[data-consent]").forEach((el) => {
    el.value = h.loads.find((l) => l.id === el.dataset.consent).consent;
    el.onchange = (e) => {
      const l = h.loads.find((l) => l.id === el.dataset.consent);
      if (l.id === "essential") return;
      l.consent = e.target.value;
      l.consentHours = l.consent === "accepted" ? l.consentHours || 6 : 0;
      changed(h.name + ": simulated resident " + l.consent + " " + l.name + " reduction.");
    };
  });
  document.querySelectorAll("[data-load]").forEach(
    (el) =>
      (el.onchange = (e) => {
        if (!el.reportValidity()) return;
        const l = h.loads.find((l) => l.id === el.dataset.load);
        l.kw = +el.value;
        if (l.id !== "essential") {
          l.consent = "unasked";
          l.consentHours = 0;
        }
        changed(h.name + ": load estimate changed; flexible-load permission must be reconfirmed.");
      }),
  );
  $("requestFlex").onclick = () => {
    log(h.name + ": flexibility request created in demo. Waiting for explicit responses; no message sent.");
    if (typeof showRequestPreview === "function") showRequestPreview(h);
  };
  document.querySelectorAll("[data-window]").forEach(
    (el) =>
      (el.onchange = () => {
        if (!el.reportValidity()) return;
        h.loads.find((l) => l.id === el.dataset.window).consentHours = +el.value;
        changed(h.name + ": resident consent window updated.");
      }),
  );
  document.querySelectorAll("[data-gridconsent]").forEach(
    (el) =>
      (el.onchange = () => {
        h.loads.find((l) => l.id === el.dataset.gridconsent).gridAccepted = el.checked;
        changed(h.name + ": grid-support reduction permission updated.");
      }),
  );
  if (typeof renderExtraDetail === "function") renderExtraDetail(h);
  bindAutomaticInputs();
}
function renderChart() {
  if (mode === "shield") {
    renderShield();
    return;
  }
  if (mode === "everyday") {
    const day = P.everyday(homes, { ...cfg, duration: prices.dailyReserve }, prices);
    $("chartTitle").textContent = "Grid support above protected reserves";
    $("chartLabel").textContent = "Illustrative economics · not an export commitment";
    $("chart").innerHTML = day.homes
      .map(
        (row) =>
          `<div class="listitem"><b>${safe(homes.find((h) => h.id === row.id).name)}</b> · ${row.online ? fmt(row.exportKwh) + " kWh indicative export · $" + row.margin.toFixed(2) + " contribution" : "Unknown; excluded"}<div class="small">Protected stored reserve: ${fmt(row.reserveKwh)} kWh</div></div>`,
      )
      .join("");
    return;
  }
  if (mode === "outage") {
    $("chartTitle").textContent = "Runtime and target";
    $("chartLabel").textContent = outage ? "Local simulation replay" : "Before outage simulation";
    $("chart").innerHTML = homes
      .map((h) => {
        const b = viewBudget(h),
          width = Math.min(100, (100 * (b.runtime ?? cfg.duration)) / cfg.duration);
        return `<div class="listitem"><b>${safe(h.name)}</b> · ${h.online ? fmt(b.runtime) + " hours · target " + (outage ? fmt(Math.max(0, cfg.duration - outage.elapsed)) : cfg.duration) + "h" : "Unknown to dispatcher"}<div class="bar"><div style="width:${width}%;background:${b.targetMet ? "#168366" : "#2672c7"}"></div></div></div>`;
      })
      .join("");
    return;
  }
  $("chartTitle").textContent = "Stagger preparation, avoid a new peak";
  $("chartLabel").textContent = plan
    ? `${fmt(Math.max(0, ...plan.trace.map((t) => t.total)))} kW peak / ${cfg.headroom} kW headroom`
    : "Updates automatically";
  if (!plan) {
    $("chart").innerHTML =
      '<p class="small">Waiting for valid demand inputs and settings. Calculations update automatically.</p>';
    return;
  }
  const energy = homes.map((h) => h.energy),
    taskEnergy = Object.fromEntries(
      homes.flatMap((h) => (h.prepTasks || []).map((task) => [h.id + ":" + task.id, task.kwh])),
    ),
    baseline = plan.trace.map((t) => {
      let sum = 0;
      homes.forEach((h, i) => {
        if (!h.online) return;
        const target = plan.homes.find((x) => x.id === h.id).target,
          kw = Math.max(0, Math.min(h.rate, (target - energy[i]) / (P.ETA * t.dt)));
        sum += kw;
        energy[i] += kw * P.ETA * t.dt;
        for (const task of (h.prepTasks || []).filter((t) => t.enabled && t.accepted)) {
          const key = h.id + ":" + task.id,
            kw = Math.min(task.rate, taskEnergy[key] / t.dt);
          sum += kw;
          taskEnergy[key] -= kw * t.dt;
        }
      });
      return sum;
    });
  const coordinated = plan.trace.map((t) => t.total),
    max = Math.max(1, cfg.headroom, ...baseline),
    x = (i) => 40 + (650 * i) / Math.max(1, baseline.length - 1),
    y = (v) => 140 - (v / max) * 120,
    path = (values) =>
      values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  $("chart").innerHTML =
    `<svg viewBox="0 0 730 175" role="img" aria-label="Uncoordinated versus coordinated charging power"><path d="M40 140H710M40 80H710M40 20H710" stroke="#e5e9df"/><path d="M40 ${y(cfg.headroom)}H710" stroke="#9ba58e" stroke-dasharray="4 4"/><path d="${path(baseline)}" fill="none" stroke="#bdafa0" stroke-width="2.5"/><path d="${path(coordinated)}" fill="none" stroke="#2672c7" stroke-width="3"/><text x="0" y="25" font-size="10" fill="#7a8574">${fmt(max)}</text><text x="40" y="166" font-size="10" fill="#7a8574">Now</text><text x="650" y="166" font-size="10" fill="#7a8574">+${cfg.lead}h</text></svg><div class="small">Blue: coordinated · gray: all-at-once. Both include the same batteries and optional preparation tasks. The gray strategy can exceed available charging headroom.</div>`;
}
function build() {
  if (!homes.length) {
    $("banner").textContent = "Load real demand records first.";
    return;
  }
  if (!["duration", "lead", "headroom", "floor"].every((id) => $(id).reportValidity())) return;
  try {
    plan = P.prepare(homes, cfg);
    approved = false;
    $("projected").checked = true;
    log(
      "Preparation calculated. Only accepted flexibility influences reductions. Shortfalls require follow-up.",
    );
    render();
  } catch (e) {
    $("banner").textContent = e.message;
  }
}
$("plan").hidden = true;
$("plan").onclick = build;
$("projected").onchange = render;
$("approve").onclick = () => {
  const online = plan.homes.filter((h) => h.online),
    unmet = online.filter((h) => !h.budget.targetMet).length;
  $("reviewText").textContent =
    `${online.length - unmet} known profiles meet the target; ${unmet} have unmet needs; ${homes.length - online.length} are unknown. Proposed load reductions require the recorded simulated resident permissions. Approve for replay?`;
  $("review").showModal();
};
$("confirm").onclick = () => {
  approved = true;
  $("review").close();
  log("Dispatcher approved the simulated preparation and consent-aware load plan. No real commands sent.");
  render();
};
$("cancel").onclick = () => $("review").close();
document.querySelectorAll("[data-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      mode = b.dataset.mode;
      render();
    }),
);
for (const key of ["duration", "lead", "headroom", "floor"])
  $(key).onchange = () => {
    if (!$(key).reportValidity()) return;
    cfg[key] = +$(key).value / (key === "floor" ? 100 : 1);
    if (key === "duration")
      homes.forEach((h) =>
        h.loads.forEach((l) => {
          if (l.consent === "accepted") {
            l.consent = "unasked";
            l.consentHours = 0;
          }
        }),
      );
    changed("Planning constraints changed.");
  };
for (const key of ["buy", "sell", "eventHours", "dailyReserve"])
  $(key).onchange = () => {
    if ($(key).reportValidity()) {
      prices[key] = +$(key).value;
      render();
    }
  };
$("stress").onclick = () => {
  cfg.duration = 43;
  $("duration").value = 43;
  homes.forEach((h) =>
    h.loads.forEach((l) => {
      if (l.consent === "accepted") {
        l.consent = "unasked";
        l.consentHours = 0;
      }
    }),
  );
  changed(
    "Historical LA stress test: rounded 43-hour ACROBAT circuit outage in January 2025. Not a current prediction.",
  );
};
$("startOutage").onclick = () => {
  outage = P.startOutage(homes, cfg, approved ? plan : null);
  log(
    "Outage replay started from " +
      (approved
        ? "approved projected preparation energy."
        : "original scenario battery energy; preparation was not approved."),
  );
  render();
};
function advance(hours) {
  while (hours > 0 && outage.elapsed < outage.duration) {
    const step = Math.min(24, hours);
    outage = P.advance(outage, step);
    hours -= step;
  }
  log(
    "Outage simulator advanced to " +
      fmt(outage.elapsed) +
      " hours. Required loads remain selected; depletion is reported as unserved energy.",
  );
  render();
}
$("advance").onclick = () => advance(1);
$("finish").onclick = () => advance(Math.max(0, outage.duration - outage.elapsed));
function importProfiles(data) {
  if (
    data.schema !== "powerup.measured-loads.v1" ||
    !Array.isArray(data.homes) ||
    data.homes.length < 1 ||
    data.homes.length > 30
  )
    throw Error("Expected PoweruP measured profile JSON with 1–30 households.");
  const next = data.homes.map((raw, i) => {
    if (!Number.isFinite(raw.meanKw) || raw.meanKw <= 0 || raw.meanKw > 100 || !raw.measurement)
      throw Error("Invalid demand or missing measurement provenance.");
    return decorate(
      P.makeHome(i + 1, String(raw.name || "Household " + (i + 1)).slice(0, 60), raw.meanKw, raw.measurement),
    );
  });
  homes = next;
  selected = homes[0].id;
  source = { source: data.source, location: data.location, method: data.method };
  $("source").textContent =
    `Loaded ${homes.length} historical measured profiles. ${data.location}. Source: ${data.source}. Battery state, appliance shares, essential needs and consent are assumptions.`;
  $("sourceMini").textContent = homes.length + " measured profiles · scenario batteries";
  $("dataBadge").textContent = "MEASURED LOAD PROXIES / SIMULATED BATTERIES";
  changed("Measured profiles loaded; resident response and battery assumptions reset.");
}
$("loadData").onclick = async () => {
  if (location.protocol === "file:") {
    $("source").textContent = "Run start-windows.bat or start-mac.sh, then open http://localhost:8004.";
    return;
  }
  const button = $("loadData");
  button.disabled = true;
  $("source").textContent =
    "Loading six OPSD residential profiles. First download is about 15 MB; allow up to 90 seconds.";
  try {
    const res = await fetch("/api/households/public", { signal: AbortSignal.timeout(90000) }),
      data = await res.json();
    if (!res.ok) throw Error(data.error || "Dataset unavailable");
    importProfiles(data);
  } catch (e) {
    $("source").textContent = "Measured records NOT loaded: " + e.message + " Existing scenario retained.";
  } finally {
    button.disabled = false;
  }
};
$("importButton").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2000000) throw Error("Import a converted JSON summary under 2 MB.");
    importProfiles(JSON.parse(await file.text()));
  } catch (error) {
    $("source").textContent = "Import failed: " + error.message;
  }
  e.target.value = "";
};
$("weather").onclick = async () => {
  if (!$("lat").reportValidity() || !$("lon").reportValidity()) return;
  if (location.protocol === "file:") {
    $("weatherStatus").textContent = "Run start-windows.bat or start-mac.sh, then open http://localhost:8004.";
    return;
  }
  const button = $("weather");
  button.disabled = true;
  $("weatherStatus").textContent = "Loading NWS forecast and location-specific alerts…";
  $("alerts").replaceChildren();
  try {
    const res = await fetch(
        `/api/weather?lat=${encodeURIComponent($("lat").value)}&lon=${encodeURIComponent($("lon").value)}`,
        { signal: AbortSignal.timeout(40000) },
      ),
      data = await res.json();
    if (!res.ok) throw Error(data.error || "NWS unavailable");
    weatherSnapshot = data;
    renderReadiness();
    $("weatherStatus").textContent =
      `${data.stale ? "STALE — refresh failed" : data.cached ? "Cached NWS response" : "NWS response"} · ${data.location || "selected point"} · fetched ${new Date(data.fetchedAt).toLocaleString()} · forecast issued ${data.forecastUpdated || "not supplied"}. Weather does not establish outage timing.`;
    data.periods.slice(0, 3).forEach((p) => {
      const el = document.createElement("p");
      el.className = "small";
      el.textContent = `${new Date(p.startTime).toLocaleString()}: ${p.temperature}°${p.temperatureUnit}, ${p.windSpeed} ${p.windDirection}. ${p.shortForecast}`;
      $("alerts").appendChild(el);
    });
    if (!data.alerts.length) {
      const el = document.createElement("p");
      el.className = "small";
      el.textContent = data.stale
        ? "No alerts in saved data; current status is unknown."
        : "No active alerts returned for this point; this does not establish low outage risk.";
      $("alerts").appendChild(el);
    }
    data.alerts.forEach((a) => {
      const el = document.createElement("p");
      el.className = "small";
      el.textContent = `${a.event}: ${a.headline || ""} Expires ${a.expires || "unspecified"}.`;
      $("alerts").appendChild(el);
    });
  } catch (e) {
    $("weatherStatus").textContent = "Weather unavailable: " + e.message + ". Current conditions unknown.";
  } finally {
    button.disabled = false;
  }
};
$("export").onclick = () => {
  const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 4,
            simulation: true,
            source,
            weatherSnapshot,
            mode,
            cfg,
            prices,
            homes,
            preparation: plan,
            approved,
            outage,
            events,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "PoweruP-scenario.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("reset").onclick = () => location.reload();
render();
log("PoweruP ready. Load SCE ZIP benchmarks or import household measurements. No starter houses are loaded.");

// Restore only already-downloaded public summaries; never silently fetch a new dataset.
if (location.protocol !== "file:")
  fetch("/api/households/cached")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && source === null) importProfiles(data);
    })
    .catch(() => {});
