"use strict";
let tourStep = 0;
function showRequestPreview(h) {
  $("requestText").textContent =
    `PoweruP preparation request for ${h.name}: can any optional charging, conditioning or discretionary use wait? Please specify how many hours each reduction is acceptable. Essential loads stay protected. Proposed outage target: ${cfg.duration} hours. Replying or declining is represented locally in this demo.`;
  $("requestPreview").showModal();
}
$("closeRequest").onclick = () => $("requestPreview").close();
function renderReadiness() {
  const el = $("readiness");
  if (!weatherSnapshot) {
    el.textContent = "Load weather to check for warnings";
    el.className = "readiness";
    return;
  }
  const w = weatherSnapshot;
  if (w.stale) {
    el.textContent = "SAVED WEATHER · refresh to check current conditions";
    el.className = "readiness caution";
    return;
  }
  const events = w.alerts.map((a) => a.event || ""),
    severe = events.some((x) =>
      /Red Flag Warning|High Wind Warning|Extreme Heat Warning|Excessive Heat Warning/i.test(x),
    ),
    elevated = events.some((x) => /Fire Weather Watch|Wind Advisory|Heat Advisory/i.test(x));
  el.textContent =
    (severe
      ? "Serious weather warning: review the plan"
      : elevated
        ? "Weather watch or advisory: check the plan"
        : "No matching wind, fire or heat alert returned") + " · weather alone does not confirm a power outage";
  el.className = "readiness" + (severe || elevated ? " caution" : "");
}
function renderExtraDetail(h) {
  const wrapper = document.createElement("div");
  wrapper.className = "extra-detail";
  const diag = P.diagnose(h, homes),
    d = plan?.homes.find((x) => x.id === h.id);
  wrapper.innerHTML = `<h3>Grid participation</h3><label class="toggle"><input id="gridEnrollment" type="checkbox" ${h.gridParticipation ? "checked" : ""} ${outage ? "disabled" : ""}> Resident allows spare battery energy to help the grid</label><p class="small">This is a demo choice. Backup energy is kept for the home.</p><h3>Before-outage preparation</h3><p class="small">These tasks share the power available for charging. The demo does not control devices or assume that pre-cooling will save energy later.</p>${h.prepTasks.map((t) => `<div class="load"><label class="toggle"><input data-task="${t.id}" type="checkbox" ${t.enabled && t.accepted ? "checked" : ""} ${outage ? "disabled" : ""}> Resident accepts ${safe(t.name)}</label><div class="fields"><label>Energy needed (kWh)<input data-taskenergy="${t.id}" type="number" min="0" max="100" step="0.1" value="${t.kwh}" ${outage ? "disabled" : ""}></label><label>Maximum power (kW)<input data-taskrate="${t.id}" type="number" min="0.1" max="20" step="0.1" value="${t.rate}" ${outage ? "disabled" : ""}></label></div><div class="small">${d ? fmt(d.tasks.find((x) => x.id === t.id)?.delivered || 0) + " kWh scheduled; " + fmt(d.tasks.find((x) => x.id === t.id)?.remaining ?? (t.enabled ? t.kwh : 0)) + " kWh unfinished." : "Scenario task; no measured EV or building thermal data."}</div></div>`).join("")}
 <hr><h3>Battery not reporting: checks & next steps</h3><div class="insight"><b>${safe(diag.label)}</b><br>${safe(diag.confidence)}<br>${safe(diag.next)}</div><details><summary>Extra checks (demo)</summary><p class="small">Try different readings to explore why a battery stopped reporting. These are demo inputs.</p><label class="toggle"><input id="freshEvidence" type="checkbox" ${h.evidence.fresh ? "checked" : ""}> These extra readings are recent</label><label>Power line voltage<select id="gridVoltage"><option value="120">120 V present</option><option value="0">0 V reported</option></select></label><label>Circuit breaker status<select id="breaker"><option value="unknown">Unknown</option><option value="tripped">Tripped report</option><option value="closed">Closed report</option></select></label><label class="toggle"><input id="faultEvidence" type="checkbox" ${h.evidence.fault ? "checked" : ""}> A separate check reports a fault</label><p class="small">Network group: ${safe(h.provider)} · assigned for scenario correlation only.</p></details>`;
  $("detail").appendChild(wrapper);
  document.querySelectorAll("[data-task]").forEach(
    (el) =>
      (el.onchange = () => {
        const t = h.prepTasks.find((t) => t.id === el.dataset.task);
        t.enabled = el.checked;
        t.accepted = el.checked;
        changed(h.name + ": preparation-task permission changed.");
      }),
  );
  for (const [selector, field] of [
    ["taskenergy", "kwh"],
    ["taskrate", "rate"],
  ])
    document.querySelectorAll("[data-" + selector + "]").forEach(
      (el) =>
        (el.onchange = () => {
          if (!el.reportValidity()) return;
          h.prepTasks.find((t) => t.id === el.dataset[selector])[field] = +el.value;
          changed(h.name + ": optional preparation task updated.");
        }),
    );
  $("gridEnrollment").onchange = () => {
    h.gridParticipation = $("gridEnrollment").checked;
    changed(h.name + ": scenario grid-support enrollment updated.");
  };
  $("gridVoltage").value = h.evidence.voltage;
  $("breaker").value = h.evidence.breaker;
  for (const id of ["freshEvidence", "gridVoltage", "breaker", "faultEvidence"])
    $(id).onchange = () => {
      h.evidence = {
        fresh: $("freshEvidence").checked,
        voltage: +$("gridVoltage").value,
        breaker: $("breaker").value,
        fault: $("faultEvidence").checked,
      };
      log(h.name + ": injected auxiliary evidence updated; cause remains a triage assessment.");
      render();
    };
}
function shieldInputs() {
  return {
    capacity: +$("feederCapacity").value,
    hours: +$("reliefHours").value,
    // Names and grace periods come from data/twists.json when loaded (demo.js); kW from the inputs.
    neighbors: (
      globalThis.PowerupConfig?.criticalLoads || [
        { name: "Cold storage (scenario)", inputId: "coldKw", graceHours: 1 },
        { name: "Communications (scenario)", inputId: "commsKw", graceHours: 0 },
        { name: "Port/security (scaled scenario)", inputId: "portKw", graceHours: 0 },
      ]
    ).map((l) => ({ name: l.name, kw: +$(l.inputId).value, graceHours: l.graceHours })),
  };
}
function renderShield() {
  const options = shieldInputs();
  $("chartTitle").textContent = "Plan to reduce local grid demand";
  $("chartLabel").textContent = "Demo with the local power line still on";
  if (outage) {
    $("chart").innerHTML =
      '<div class="insight red">An outage replay is active. Isolated home batteries cannot supply the neighboring port, communications or cold store through a de-energized feeder. End/reset the replay before evaluating grid-connected support.</div>';
    return;
  }
  const effectiveHomes = homes.map((h) => ({ ...h, energy: projectedEnergy(h) })),
    r = P.relief(effectiveHomes, cfg, options);
  $("metrics").innerHTML = [
    [
      "POWER REDUCTION NEEDED",
      fmt(r.neededKw) + " kW",
      "Baseline " + fmt(r.baselineKw) + " kW / capacity " + options.capacity + " kW",
    ],
    [
      "REDUCTION FROM THE PLAN",
      fmt(r.providedKw) + " kW",
      fmt(r.energyReliefKwh) + " kWh over " + options.hours + " hours",
    ],
    ["STILL NEEDS HELP", fmt(r.unresolvedKw) + " kW", r.unknown + " unknown batteries excluded"],
  ]
    .map(
      (x) =>
        `<div class="metric"><span class="small">${x[0]}</span><strong>${x[1]}</strong><span class="small">${x[2]}</span></div>`,
    )
    .join("");
  $("banner").textContent =
    `With grid power on: reduce usage where residents agree, then use spare battery energy. The remaining ${fmt(r.unresolvedKw)} kW needs help from the utility. Nearby services are examples; the app cannot control them.`;
  $("chart").innerHTML =
    r.actions
      .map(
        (a) =>
          `<div class="listitem"><b>${safe(homes.find((h) => h.id === a.home).name)}</b> · ${safe(a.kind)}<div class="small">${safe(a.name)} · ${fmt(a.kw)} kW relief</div></div>`,
      )
      .join("") +
    `<div class="insight ${r.unresolvedKw ? "red" : ""}">${r.unresolvedKw ? "Ask the utility to handle the remaining demand." : "The plan covers the needed reduction with these demo settings."}<br>Nearby services that may need backup soon: ${r.urgentNeighbors.map(safe).join(", ")}.</div>`;
}
function renderAdvanced() {
  renderReadiness();
  if (!homes.length) return;
  const h = homes.find((x) => x.id === selected),
    diag = P.diagnose(h, homes),
    b = viewBudget(h),
    tasks = plan?.homes.reduce((s, x) => s + x.tasks.reduce((n, t) => n + t.remaining, 0), 0) || 0;
  const entries = [
    [
      "WATCH",
      weatherSnapshot
        ? weatherSnapshot.stale
          ? "Weather snapshot stale"
          : "NWS evidence loaded"
        : "Awaiting weather evidence",
    ],
    [
      "ASK",
      homes.reduce((n, h) => n + h.loads.filter((l) => l.consent === "accepted").length, 0) +
        " accepted time windows",
    ],
    ["SLOW", b.actions.length + " permitted reductions for selected home"],
    ["HOLD", approved ? "Preparation plan approved" : "Reserve plan awaits review"],
    [
      "HAND OFF",
      !h.online
        ? diag.label
        : !b.targetMet
          ? "Selected home cannot meet target"
          : tasks > 0
            ? "Optional prep tasks unfinished"
            : "No selected-home shortfall",
    ],
  ];
  $("ladder").innerHTML = entries
    .map(([label, text]) => `<div><span class="eyebrow">${label}</span><p>${safe(text)}</p></div>`)
    .join("");
  if (mode === "everyday" && outage) {
    $("metrics").innerHTML =
      '<div class="metric"><span class="small">GRID EXPORT</span><strong>Paused</strong><span class="small">Outage replay active · local backup only</span></div>';
    $("banner").textContent =
      "No grid support is available from an isolated home during this outage replay. The battery serves its own household.";
    $("chart").innerHTML =
      '<div class="insight">Return to Storm preparation and change a planning input to clear the outage replay, then evaluate an ordinary-day event.</div>';
  }
}
for (const id of ["feederCapacity", "reliefHours", "coldKw", "commsKw", "portKw"])
  $(id).onchange = () => {
    if ($(id).reportValidity()) render();
  };
$("shieldTwist").onclick = () => {
  $("feederCapacity").value = Math.max(0, +$("feederCapacity").value * 0.75).toFixed(1);
  log("Scenario twist: feeder capacity reduced by 25%. Recomputed relief, no actual utility instruction.");
  render();
};
$("simulatePeerLoss").onclick = () => {
  if (!homes.length) return;
  const provider = homes.find((h) => h.id === selected).provider;
  homes
    .filter((h) => h.provider === provider)
    .forEach((h) => {
      h.online = false;
      if (outage) outage.devices.find((d) => d.id === h.id).offline = true;
    });
  plan = null;
  approved = false;
  log(
    "Scenario twist: shared network group lost communication. Unknown capacity excluded; correlated loss suggests but does not prove a communication fault.",
  );
  render();
};
// A saved demo retains measured provenance and weather timestamps. It never
// converts simulation controls into real telemetry or sends commands.
$("loadSnapshot").onclick = () => $("snapshotFile").click();
$("snapshotFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 3000000) throw Error("Snapshot must be under 3 MB.");
    const data = JSON.parse(await file.text());
    if (data.version !== 4 || !Array.isArray(data.homes) || !data.homes.length || data.homes.length > 30)
      throw Error("Expected a PoweruP v4 scenario export.");
    const next = data.homes.map((raw, i) => {
      const h = decorate(P.clone(raw));
      h.id = i + 1;
      h.name = String(h.name || "Measured profile " + (i + 1)).slice(0, 60);
      if (!Array.isArray(h.loads) || h.loads.length !== 4) throw Error("Invalid load definitions.");
      for (const l of h.loads) {
        if (!Number.isFinite(l.consentHours || 0) || (l.consentHours || 0) < 0 || (l.consentHours || 0) > 168)
          throw Error("Invalid consent horizon.");
      }
      for (const task of h.prepTasks) {
        if (
          !Number.isFinite(task.kwh) ||
          task.kwh < 0 ||
          task.kwh > 100 ||
          !Number.isFinite(task.rate) ||
          task.rate <= 0 ||
          task.rate > 20
        )
          throw Error("Invalid prep task.");
      }
      return h;
    });
    P._originalPrepare(next, data.cfg);
    homes = next;
    selected = 1;
    cfg = data.cfg;
    prices = { ...prices, ...data.prices };
    source = data.source || null;
    weatherSnapshot =
      data.weatherSnapshot &&
      Array.isArray(data.weatherSnapshot.alerts) &&
      Array.isArray(data.weatherSnapshot.periods)
        ? { ...data.weatherSnapshot, stale: true }
        : null;
    for (const key of ["duration", "lead", "headroom", "floor"])
      $(key).value = cfg[key] * (key === "floor" ? 100 : 1);
    for (const key of ["buy", "sell", "eventHours", "dailyReserve"]) $(key).value = prices[key];
    $("source").textContent = source
      ? `Saved demand-source snapshot: ${source.source}. ${source.location}. Battery state and consent remain scenario inputs.`
      : "Saved example scenario; no measured source.";
    $("sourceMini").textContent = homes.length + " saved profiles";
    $("dataBadge").textContent = source
      ? "SAVED MEASURED PROFILES / SCENARIO BATTERIES"
      : "SAVED DEMO / SIMULATED BATTERIES";
    if (typeof labelSceSource === "function") labelSceSource();
    mode = "prepare";
    changed("Saved demo restored offline. Weather marked stale; approvals require review.");
  } catch (error) {
    $("source").textContent = "Snapshot load failed: " + error.message;
  }
  e.target.value = "";
};
const tour = [
  [
    "Real inputs, explicit assumptions",
    "Demand inputs keep their historical source. ZIP-based homes are representative scenarios, while imported household profiles retain measured provenance. This run applies a 72-hour outage scenario; charge and device allowances remain assumptions.",
  ],
  [
    "Ask who can wait",
    "This step injects accepted resident responses for optional loads and grid-support reductions for this scenario. Nothing is inferred from household identity, and no messages are sent.",
  ],
  [
    "Prepare without creating a peak",
    "Battery charging and optional EV/conditioning preparation share the same headroom. Unfinished tasks and household shortfalls stay visible.",
  ],
  [
    "Approve, then test the energy budget",
    "The guided run approves a simulated plan and starts outage replay using its projected energy. Target coverage is calculated, not guaranteed.",
  ],
  [
    "The network goes quiet",
    "A shared scenario provider loses communication. The dispatcher sees unknown status; a separate local simulator continues stored time-limited policies.",
  ],
  [
    "An ordinary Tuesday",
    "The same reserve model evaluates grid support before an outage. We clear this replay and show user-assumed economics above protected reserves.",
  ],
];
function tourDisplay() {
  const t = tour[tourStep];
  $("tour").hidden = false;
  $("tourTitle").textContent = tourStep + 1 + " / " + tour.length + " · " + t[0];
  $("tourText").textContent = t[1];
  $("tourNext").textContent = tourStep === tour.length - 1 ? "Finish demo" : "Next →";
}
$("guided").onclick = () => {
  if (!source || homes.length < 2) {
    $("source").textContent =
      "Build a representative fleet from SCE benchmarks, load household measurements, or open a saved demo first.";
    $("source").closest("details").open = true;
    return;
  }
  mode = "prepare";
  cfg.duration = 72;
  $("duration").value = 72;
  homes.forEach((h) => {
    h.energy = h.capacity * 0.3;
    h.online = true;
    h.loads.forEach((l) => {
      if (l.id !== "essential") {
        l.consent = "unasked";
        l.consentHours = 0;
      }
    });
  });
  changed("Guided demo started using historical demand inputs and a labeled 72-hour scenario.");
  tourStep = 0;
  tourDisplay();
};
$("tourNext").onclick = () => {
  if (tourStep === tour.length - 1) {
    $("tour").hidden = true;
    return;
  }
  tourStep++;
  if (tourStep === 1) {
    homes.forEach((h) =>
      h.loads.forEach((l) => {
        if (l.id !== "essential") {
          l.consent = "accepted";
          l.consentHours = 72;
          l.gridAccepted = true;
        }
      }),
    );
    const h = homes[0];
    h.prepTasks.forEach((t) => {
      t.enabled = true;
      t.accepted = true;
    });
    changed("Guided demo injected time-scoped resident permission and optional preparation tasks.");
  }
  if (tourStep === 2) build();
  if (tourStep === 3) {
    if (!plan) build();
    approved = true;
    mode = "outage";
    outage = P.startOutage(homes, cfg, plan);
    log("Guided demo approved a simulated plan and entered outage replay.");
    render();
  }
  if (tourStep === 4) {
    $("simulatePeerLoss").onclick();
    advance(1);
  }
  if (tourStep === 5) {
    outage = null;
    plan = null;
    approved = false;
    mode = "everyday";
    homes.forEach((h) => {
      h.online = true;
      h.energy = h.capacity * 0.8;
      h.gridParticipation = true;
    });
    log(
      "Guided ordinary-day scenario: 80% starting charge and grid-support enrollment assumed; no current outage.",
    );
    render();
  }
  tourDisplay();
};
$("tourClose").onclick = () => ($("tour").hidden = true);
render();

$("uploadCsv").onclick = () => $("rawCsvFile").click();
$("rawCsvFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 25000000) throw Error("Use the 60-minute CSV, under 25 MB.");
    if (location.protocol === "file:")
      throw Error(
        "Open http://localhost:8004 to import raw CSV. Converted JSON and saved demos work offline.",
      );
    $("source").textContent = "Reading your downloaded OPSD CSV locally; no external download is needed.";
    const res = await fetch("/api/households/import-csv", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      }),
      data = await res.json();
    if (!res.ok) throw Error(data.error || "CSV import failed");
    importProfiles(data);
  } catch (error) {
    $("source").textContent = "CSV import failed: " + error.message;
  }
  e.target.value = "";
};
