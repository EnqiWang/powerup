/* PoweruP × Retell AI — MOCK integration (Phase 1). No calls, network requests, API keys or device commands.
   A mock post-call event becomes a *pending* resident response; only an operator Confirm changes the
   existing EV load consent ("Optional charging" reduction during the outage window), via changed().
   Phase 2: with ?retell=live and retell-server.js running, verified Retell webhooks arrive through the same path.
   Web calls (retell-web.js): each result is pinned to the home selected when its call started in this tab.
   A confirmed resident response overrides scenario assumptions. It is bound to the exact home object it was
   received for; fleet replacement or later edits are detected and logged, never silently carried or lost.
   Remove: delete this file, retell-server.js, retell-send-sample.js, tests/retell-*.test.js and its <script> tag. */
(function (root) {
  "use strict";
  const LOAD = "ev",
    MIN_HOURS = 0.25,
    MAX_HOURS = 168;
  // Retell "Post call extraction" field names. Agent config, server, mocks and tests all use these.
  const FIELDS = {
    decision: "ev_outage_reduction_decision",
    hours: "permitted_hours",
    readback: "resident_confirmed_readback",
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // Shaped like a Retell "call_analyzed" webhook; custom_analysis_data keys are our own agent's fields.
  const sample = (callId, homeId, decision, hours, readback = true) => ({
    event: "call_analyzed",
    call: {
      call_id: callId,
      metadata: { home_id: homeId, load_id: LOAD },
      call_analysis: {
        custom_analysis_data: { [FIELDS.decision]: decision, [FIELDS.hours]: hours, [FIELDS.readback]: readback },
      },
    },
  });
  // Every event yields a record. Only status "pending" can be confirmed; nothing defaults to "accepted".
  function parse(event, homes, seen = [], source = "MOCK") {
    const call = event?.call,
      callId = String(call?.call_id ?? "").slice(0, 80),
      data = call?.call_analysis?.custom_analysis_data || {},
      homeId = call?.metadata?.home_id,
      home = homes.find((h) => h.id === homeId),
      record = {
        callId,
        source,
        homeId: home ? home.id : null,
        homeName: home ? home.name : null,
        loadId: LOAD,
        decision: null,
        hours: 0,
        status: "rejected",
        reason: "",
        receivedAt: new Date().toISOString(),
        history: [],
      };
    const reject = (reason, status = "rejected") => Object.assign(record, { status, reason });
    if (event?.event !== "call_analyzed") return reject("Not a call_analyzed event.");
    if (!callId) return reject("Missing call_id.");
    if (seen.includes(callId)) return reject("Duplicate call_id; ignored.");
    if (!home) return reject("Unknown home_id.");
    if (call.metadata.load_id !== LOAD) return reject("Only the EV load can be changed by this mock.");
    const decision = data[FIELDS.decision];
    if (decision === "decline") return Object.assign(record, { decision: "declined", status: "pending" });
    if (decision !== "agree") return reject("Resident response unclear; follow up by a person.", "needs follow-up");
    const hours = Number(data[FIELDS.hours]);
    if (!Number.isFinite(hours) || hours < MIN_HOURS || hours > MAX_HOURS)
      return reject(`Permitted hours must be ${MIN_HOURS}–${MAX_HOURS}.`, "needs follow-up");
    if (data[FIELDS.readback] !== true)
      return reject("Resident did not confirm the read-back; follow up by a person.", "needs follow-up");
    return Object.assign(record, { decision: "accepted", hours, status: "pending" });
  }
  function consentOf(home) {
    const l = home.loads.find((l) => l.id === LOAD);
    return { consent: l.consent, hours: l.consent === "accepted" ? l.consentHours || 0 : 0 };
  }
  // Does the home still hold exactly what this response set?
  function matches(record, c) {
    return c.consent === record.decision && (record.decision !== "accepted" || c.hours === record.hours);
  }
  // Writes the confirmed response into the existing consent fields. The scheduler is untouched.
  // `home` pins the exact object the response was received for; a replaced fleet with the same ids is refused.
  function apply(homes, record, home = homes.find((h) => h.id === record?.homeId)) {
    if (record?.status !== "pending") throw Error("Only pending responses can be confirmed.");
    const load = homes.includes(home) && home.loads.find((l) => l.id === LOAD);
    if (!load) throw Error("Home is no longer in the simulation.");
    const previous = consentOf(home);
    load.consent = record.decision;
    load.consentHours = record.decision === "accepted" ? record.hours : 0;
    return { previous, next: consentOf(home) };
  }
  // Backup before/after for this home, planned on copies of the fleet with the unchanged engine.
  function preview(homes, cfg, record, P, home = homes.find((h) => h.id === record?.homeId)) {
    const i = homes.indexOf(home);
    if (i < 0) throw Error("Home is no longer in the simulation.");
    const run = (fleet) => {
      const plan = P.prepare(fleet, cfg);
      return fleet.map((h, k) => {
        const b = P.budget(h, cfg, plan.homes[k].energy);
        return { runtime: b.runtime, targetMet: b.targetMet };
      });
    };
    const after = clone(homes);
    apply(after, { ...record, status: "pending" }, after[i]);
    const b = run(clone(homes)),
      a = run(after),
      meeting = (xs) => xs.filter((x) => x.targetMet).length;
    return {
      targetHours: cfg.duration,
      before: b[i],
      after: a[i],
      belowTarget: !a[i].targetMet,
      reduces: (a[i].runtime ?? 0) < (b[i].runtime ?? 0) - 1e-6,
      fleetMeetingTarget: { before: meeting(b), after: meeting(a), of: homes.length },
    };
  }
  const api = { parse, apply, preview, consentOf, matches, sample, FIELDS, LOAD, MIN_HOURS, MAX_HOURS };
  root.PowerupRetell = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

if (typeof document !== "undefined") {
  const R = PowerupRetell,
    records = [],
    homeOf = new WeakMap(), // record → the exact home object it was received for (kept out of the export)
    expected = new Map(); // call_id → home object selected when this tab started that web call
  let mockCount = 0;
  // Opt-in (?retell=live): poll the localhost-only feed of retell-server.js. Same origin; nothing external.
  const live = new URLSearchParams(location.search).get("retell") === "live" ? { status: "connecting", after: 0 } : null;
  const box = document.createElement("div");
  box.id = "retellMock";
  box.className = "load retell-panel";
  document.getElementById("detail").after(box);
  const now = () => new Date().toISOString(),
    hrs = (x) => (Number.isFinite(x) ? x.toFixed(1) + " h" : "—"),
    tag = (r) => `Retell (${r.source.toLowerCase()})`,
    fmtConsent = (c) => (c.consent === "accepted" ? `accepted ${c.hours} h` : c.consent === "unasked" ? "no response" : c.consent);
  const describe = (r) =>
    r.decision === "accepted"
      ? `Agrees to reduce EV charging during the outage for ${r.hours} h from outage start`
      : r.decision === "declined"
        ? "Declines any EV charging reduction during the outage"
        : "No usable answer";
  // Where the home's current EV consent came from: a confirmed resident response still in effect, or not.
  function sourceOf(home) {
    const c = R.consentOf(home),
      r = records.find((x) => x.status === "confirmed" && homeOf.get(x) === home && R.matches(x, c));
    if (r) return `confirmed resident response (call ${r.callId})`;
    return c.consent === "unasked" ? "no response yet" : "scenario assumption or operator demo setting";
  }
  function mark(r, status, detail, extra = {}) {
    r.status = status;
    r.history.push({ at: now(), action: status, detail, ...extra });
    log(`${tag(r)} call ${r.callId} for ${r.homeName}: ${status}. ${detail}`);
  }
  // Runs after every app render: catches fleet replacement and consent edits made by other controls.
  function integrityCheck() {
    for (const r of records) {
      const home = homeOf.get(r);
      if (!home) continue;
      if (!homes.includes(home)) {
        if (r.status === "pending")
          mark(r, "void", "The fleet was replaced (region or data change) before confirmation; nothing was applied to the new fleet.");
        else if (r.status === "confirmed" || r.status === "overridden")
          mark(r, "not carried over", "The fleet was replaced; this resident response belongs to the previous fleet and was not applied to any new home.");
      } else if (r.status === "confirmed" && !R.matches(r, R.consentOf(home))) {
        const c = R.consentOf(home);
        mark(r, "overridden", `WARNING: EV consent was changed elsewhere to ${fmtConsent(c)}; the resident's answer is no longer in effect. Use Re-apply to restore it.`, { now: c });
      }
    }
  }
  function previewHtml(r, home) {
    if (outage) return '<div class="small">Preview unavailable during a running outage.</div>';
    let p;
    try {
      p = r.preview = R.preview(homes, cfg, r, Powerup, home);
    } catch (error) {
      return `<div class="small">Preview unavailable: ${safe(error.message)}</div>`;
    }
    const fleet =
      p.fleetMeetingTarget.before !== p.fleetMeetingTarget.after
        ? ` Homes meeting target: ${p.fleetMeetingTarget.before} → ${p.fleetMeetingTarget.after} of ${p.fleetMeetingTarget.of}.`
        : "";
    return (
      `<div class="small">Estimated backup for this home: <b>${hrs(p.before.runtime)} → ${hrs(p.after.runtime)}</b> (target ${p.targetHours} h).${fleet}</div>` +
      (p.belowTarget
        ? `<div class="insight red"><b>Warning:</b> confirming leaves this home below the ${p.targetHours} h backup target. The resident's confirmed answer still takes precedence over scenario assumptions; follow up separately if more backup is needed.</div>`
        : p.reduces
          ? '<div class="small">Backup decreases but still meets the target.</div>'
          : "")
    );
  }
  function card(r, idx) {
    const home = homeOf.get(r),
      present = home && homes.includes(home),
      head =
        `<div class="retell-card-head"><span class="retell-tag${r.source === "MOCK" ? " mock" : ""}">${safe(r.source)}</span><span class="retell-status">${safe(r.status)}</span></div>` +
        `<b class="retell-card-title">${r.homeName ? safe(r.homeName) + " (home " + r.homeId + ")" : "Unknown home"}</b>` +
        `<div class="small">${safe(describe(r))}${r.reason ? " · " + safe(r.reason) : ""} · call ${safe(r.callId)}</div>`;
    let body = "";
    if (r.status === "pending" && present) {
      const c = R.consentOf(home);
      body =
        `<div class="small">Current EV consent: <b>${safe(fmtConsent(c))}</b> — ${safe(sourceOf(home))}</div>` +
        `<div class="small">Proposed: <b>${safe(fmtConsent({ consent: r.decision, hours: r.hours }))}</b> — resident response (call ${safe(r.callId)})</div>` +
        previewHtml(r, home) +
        `<div class="retell-actions"><button data-retellconfirm="${idx}" class="primary" ${outage ? "disabled" : ""}>Confirm</button><button data-retelldiscard="${idx}">Discard</button></div>`;
    } else if (r.status === "confirmed")
      body = `<div class="small">In effect: ${safe(fmtConsent(r.next))} (was ${safe(fmtConsent(r.previous))} — ${safe(r.previous.source)}).</div>`;
    else if (r.history.length) body = `<div class="small">${safe(r.history.at(-1).detail)}</div>`;
    if (r.status === "overridden" && present)
      body += `<div class="retell-actions"><button data-retellreapply="${idx}" ${outage ? "disabled" : ""}>Re-apply resident response</button></div>`;
    return `<div class="insight retell-card${r.status === "overridden" ? " red" : ""}">${head}${body}</div>`;
  }
  function retellRender() {
    box.innerHTML =
      `<div class="retell-head"><h3>Resident phone responses</h3><span class="retell-tag">Retell AI</span></div>` +
      `<p class="retell-text">Each result is labelled by source: <b>WEB CALL</b> is a real browser voice call with the Retell AI agent (Talk to AI, below); <b>MOCK</b> is simulated by the buttons here, with no call placed and nothing sent.</p>` +
      `<p class="retell-text">Either way it covers reducing <b>EV charging during the outage window</b>, not pre-outage EV top-up, and the simulation changes only after you confirm.</p>` +
      (live ? `<p class="retell-text">Live test feed (local retell-server.js): <b>${safe(live.status)}</b>. Verified Retell webhooks still need your Confirm.</p>` : "") +
      `<div class="retell-sub"><span class="retell-tag mock">MOCK · Retell AI</span><p class="retell-text">Simulate a post-call result. No call is placed.</p>` +
      `<div class="retell-actions"><button id="retellSampleAgree">Mock call: agrees (4 h)</button><button id="retellSampleDecline">Mock call: declines</button></div></div>` +
      (records
        .map(card)
        .reverse()
        .join("") || '<p class="retell-text">No call results yet.</p>') +
      (records.length ? '<button id="retellExport" class="wide">Export call records (mock and real)</button>' : "");
    const target = () => homes.find((h) => h.id === selected) || homes[0];
    const mock = (decision, hours) => {
      if (!homes.length) return log("Retell (mock): load example homes first.");
      receive(R.sample("mock-" + Date.now() + "-" + ++mockCount, target().id, decision, hours));
    };
    $("retellSampleAgree").onclick = () => mock("agree", 4);
    $("retellSampleDecline").onclick = () => mock("decline", 0);
    box.querySelectorAll("[data-retellconfirm]").forEach(
      (el) => (el.onclick = () => confirmResponse(records[+el.dataset.retellconfirm])),
    );
    box.querySelectorAll("[data-retelldiscard]").forEach(
      (el) =>
        (el.onclick = () => {
          const r = records[+el.dataset.retelldiscard],
            home = homeOf.get(r),
            c = home && homes.includes(home) ? R.consentOf(home) : null;
          mark(r, "discarded", `Operator discarded the response; EV consent unchanged${c ? " (" + fmtConsent(c) + ")" : ""}.`, {
            previous: c,
            next: c,
          });
          retellRender();
        }),
    );
    box.querySelectorAll("[data-retellreapply]").forEach(
      (el) =>
        (el.onclick = () => {
          const r = records[+el.dataset.retellreapply];
          mark(r, "pending", "Operator asked to re-apply the resident response; review the preview and confirm.");
          retellRender();
        }),
    );
    if ($("retellExport"))
      $("retellExport").onclick = () => {
        const url = URL.createObjectURL(
            new Blob([JSON.stringify({ simulation: true, source: "PoweruP Retell (each record's source: MOCK, WEB CALL or LIVE TEST)", exportedAt: now(), records }, null, 2)], {
              type: "application/json",
            }),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = "PoweruP-retell-mock.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
  }
  function confirmResponse(r) {
    const home = homeOf.get(r);
    try {
      if (outage) throw Error("Consent cannot change during a running outage.");
      if (!home || !homes.includes(home)) {
        integrityCheck();
        throw Error("This response's home is no longer in the simulation; nothing was applied.");
      }
      const previous = { ...R.consentOf(home), source: sourceOf(home) },
        p = R.preview(homes, cfg, r, Powerup, home);
      // A newer confirmed answer for the same home supersedes the older one.
      for (const x of records)
        if (x !== r && x.status === "confirmed" && homeOf.get(x) === home)
          mark(x, "superseded", `Superseded by call ${r.callId}.`);
      const { next } = R.apply(homes, r, home);
      Object.assign(r, { previous, next, preview: p, decidedAt: now() });
      r.status = "confirmed";
      r.history.push({ at: r.decidedAt, action: "confirmed", detail: "Operator confirmed.", previous, next, preview: p });
      changed(
        `${tag(r)} call ${r.callId}, operator confirmed for ${r.homeName}: EV consent ${fmtConsent(previous)} (${previous.source}) → ${fmtConsent(next)} (resident). ` +
          `Estimated backup ${hrs(p.before.runtime)} → ${hrs(p.after.runtime)}, target ${p.targetHours} h${p.belowTarget ? " — BELOW TARGET" : ""}.`,
      );
    } catch (error) {
      log(`${tag(r)}: ${error.message}`);
    }
    retellRender();
  }
  // Console entry point for hand-written mock events: PowerupRetell.receive({...}).
  // A web call result is parsed against only the home pinned when this tab started the call, never a same-id home
  // in a fleet loaded since; web call results this tab did not start are refused.
  function receive(event, source = "MOCK") {
    const pinned = expected.get(String(event?.call?.call_id ?? "")),
      foreign = source === "WEB CALL" && !pinned;
    const r = R.parse(
      event,
      foreign ? [] : pinned ? (homes.includes(pinned) ? [pinned] : []) : homes,
      records.map((x) => x.callId),
      source,
    );
    if (foreign && r.status === "rejected") r.reason = "Call was not started from this browser tab; ignored.";
    else if (pinned && !homes.includes(pinned) && r.status === "rejected")
      r.reason = "The fleet was replaced during the call; nothing was applied to the new fleet.";
    if (r.homeId !== null) homeOf.set(r, pinned || homes.find((h) => h.id === r.homeId));
    records.push(r);
    log(`${tag(r)}: call ${r.callId || "?"} received → ${r.status}${r.reason ? " (" + r.reason + ")" : ""}.${r.status === "pending" ? " Awaiting operator confirmation." : " No simulation change."}`);
    retellRender();
    return r;
  }
  R.receive = receive;
  // retell-web.js registers each web call it starts, before the call can produce a result.
  R.expect = (callId, home) => expected.set(String(callId), home);
  // Same wrapping pattern as demo.js: re-check bindings and refresh previews after every app render.
  const baseRender = render;
  render = function () {
    baseRender.apply(this, arguments);
    integrityCheck();
    retellRender();
  };
  async function poll() {
    const before = live.status;
    // Events stay queued on the server until homes exist, so none is rejected as "unknown home".
    if (!homes.length) live.status = "waiting for homes to load";
    else
      try {
        const res = await fetch("/retell/events?after=" + live.after, { cache: "no-store" });
        if (!res.ok) throw Error("HTTP " + res.status);
        const { events } = await res.json();
        live.status = "connected";
        for (const item of events) {
          live.after = Math.max(live.after, item.seq);
          receive(item.event, "LIVE TEST");
        }
      } catch (error) {
        live.status = "not reachable (" + error.message + ")";
      }
    if (live.status !== before) retellRender();
  }
  if (live) setInterval(poll, 3000);
  retellRender();
}
