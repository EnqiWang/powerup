/* PoweruP notification demo. No delivery providers, messages, or background jobs. */
(function (root) {
  "use strict";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const levels = { monitor: "Monitor", prepare: "Prepare now", urgent: "Urgent review" };
  function validateContact(c) {
    if (!c.name?.trim() || !/^\d{5}$/.test(c.zip)) throw Error("Enter a name and five-digit home ZIP.");
    if (!["sms", "email"].includes(c.channel)) throw Error("Choose SMS or email.");
    if (c.channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.destination))
      throw Error("Enter an email address.");
    if (c.channel === "sms" && !/^\+[1-9]\d{7,14}$/.test(c.destination))
      throw Error("Use a phone number with country code, such as +12135550101.");
    return { ...c, name: c.name.trim().slice(0, 60) };
  }
  function recipients(contacts, zip) {
    return contacts.filter((c) => c.zip === zip && c.consent === true);
  }
  function makeAlert(input, clock) {
    if (!/^\d{5}$/.test(input.zip) || !levels[input.level])
      throw Error("Choose a five-digit ZIP and readiness level.");
    if (input.level !== "monitor" && (!Number.isFinite(input.expected) || input.expected <= clock))
      throw Error("Set a future expected shutoff time relative to the demo clock.");
    const expected = input.level === "monitor" ? null : input.expected;
    return {
      id: "alert-" + clock + "-" + Math.random().toString(36).slice(2, 7),
      zip: input.zip,
      level: input.level,
      expected,
      createdAt: clock,
      evidence:
        input.evidence === "notice"
          ? "Simulated utility notice"
          : "Operator scenario; no utility confirmation",
      clockLabel: input.clockLabel,
      expectedLabel: input.expectedLabel,
      text:
        `DEMO ONLY — PoweruP | ZIP ${input.zip}\nReadiness: ${levels[input.level]} (operator selected).\n` +
        (expected
          ? `Possible shutoff window starts ${input.expectedLabel}. ${input.evidence === "notice" ? "Simulated utility notice." : "Scenario estimate, not a confirmed utility shutoff."}\nPrepare ahead: review your battery reserve and schedule EV charging to finish before the window. Save work and charge your phone.\nAt the reminder, pause EV charging; unplug the vehicle only if safe and consistent with its instructions. Manually switch off nonessential loads you can defer, such as pool pumps. Keep essential equipment powered.\n`
          : "Monitor official utility updates. No shutoff time has been set.\n") +
        "Weather and ZIP consumption do not establish an outage forecast. No equipment is switched off by this app.",
    };
  }
  function dispatch(state, alert) {
    const next = clone(state),
      targets = recipients(next.contacts, alert.zip);
    if (!targets.length) throw Error("No opted-in demo subscribers in this ZIP.");
    // A newer reviewed plan replaces pending reminders for the same ZIP.
    next.outbox.forEach((m) => {
      if (m.zip === alert.zip && m.status === "scheduled") m.status = "superseded";
    });
    next.alerts.push(alert);
    targets.forEach((c) => {
      const base = {
        alertId: alert.id,
        contactId: c.id,
        name: c.name,
        zip: c.zip,
        channel: c.channel,
        destination: c.destination,
      };
      next.outbox.push({
        ...base,
        id: alert.id + "-" + c.id + "-initial",
        kind: "Preparation alert",
        text: alert.text,
        due: next.clock,
        status: "simulated sent",
        sentAt: next.clock,
      });
      if (alert.expected) {
        const reminders = [
          {
            offset: 60,
            kind: "One-hour preparation reminder",
            text: "One hour until the scenario shutoff window. Review battery charge, finish charging your phone, save work and check the utility update.",
          },
          {
            offset: 15,
            kind: "EV / manual-load reminder",
            text: "15 minutes until the scenario shutoff window. Pause EV charging; unplug only if safe and per vehicle instructions. Manually switch off nonessential loads you can defer. Preserve essential equipment.",
          },
        ];
        reminders
          .filter((r) => alert.expected - r.offset * 60000 > next.clock)
          .forEach((r) =>
            next.outbox.push({
              ...base,
              id: alert.id + "-" + c.id + "-" + r.offset,
              kind: r.kind,
              text:
                "DEMO ONLY — ZIP " +
                c.zip +
                ". " +
                r.text +
                " Timing is simulated; no equipment commands sent.",
              due: alert.expected - r.offset * 60000,
              status: "scheduled",
            }),
          );
      }
    });
    return next;
  }
  function advance(state, minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) throw Error("Invalid clock advance.");
    const next = clone(state);
    next.clock += minutes * 60000;
    for (const item of next.outbox) {
      if (item.status !== "scheduled") continue;
      const contact = next.contacts.find((c) => c.id === item.contactId);
      if (!contact || !contact.consent || contact.zip !== item.zip) {
        item.status = "cancelled — consent / enrollment changed";
        continue;
      }
      if (item.due <= next.clock) {
        item.status = "simulated sent";
        item.sentAt = next.clock;
      }
    }
    return next;
  }
  const api = { validateContact, recipients, makeAlert, dispatch, advance, levels };
  root.PowerupNotify = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

if (typeof document !== "undefined") {
  let notifyState = { clock: Date.now(), contacts: [], alerts: [], outbox: [] },
    pendingAlert = null;
  const N = PowerupNotify;
  const nTime = (t) =>
    new Date(t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  const mask = (c) =>
    c.channel === "sms"
      ? "••••" + c.destination.slice(-4)
      : c.destination[0] + "•••@" + (c.destination.split("@")[1] || "hidden");
  function notifyRender() {
    $("notifyClock").textContent = "DEMO CLOCK · " + nTime(notifyState.clock);
    const zip = $("notifyZip").value.trim(),
      eligible = N.recipients(notifyState.contacts, zip);
    $("notifyAudience").textContent =
      eligible.length +
      " opted-in demo subscribers for ZIP " +
      zip +
      ". Phone area codes are not used for targeting.";
    $("notifyContacts").innerHTML =
      notifyState.contacts
        .map(
          (c) =>
            `<div class="subscriber"><span><b>${safe(c.name)}</b> · ZIP ${safe(c.zip)}<br><span class="small">${safe(c.channel.toUpperCase())} · ${safe(mask(c))}</span></span><label class="toggle"><input data-notifyconsent="${c.id}" type="checkbox" ${c.consent ? "checked" : ""}> Demo opt-in</label></div>`,
        )
        .join("") || '<p class="small">No subscribers. Load fictional residents or add a test contact.</p>';
    document.querySelectorAll("[data-notifyconsent]").forEach(
      (el) =>
        (el.onchange = () => {
          notifyState.contacts.find((c) => c.id === el.dataset.notifyconsent).consent = el.checked;
          notifyState = N.advance(notifyState, 0.001);
          notifyRender();
        }),
    );
    const scheduled = notifyState.outbox.filter((m) => m.status === "scheduled").length,
      sent = notifyState.outbox.filter((m) => m.status === "simulated sent").length;
    $("notifyCounts").textContent = sent + " simulated messages · " + scheduled + " scheduled reminders";
    $("notifyOutbox").innerHTML =
      [...notifyState.outbox]
        .sort((a, b) => b.due - a.due)
        .slice(0, 50)
        .map(
          (m) =>
            `<details class="message"><summary><span><b>${safe(m.kind)}</b><br><span class="small">${safe(m.name)} · ${safe(m.channel.toUpperCase())} · ZIP ${safe(m.zip)} · ${safe(nTime(m.due))}</span></span><span class="message-status">${safe(m.status)}</span></summary><p class="message-body">${safe(m.text)}</p></details>`,
        )
        .join("") ||
      '<div class="empty-message">Your first preparation alert appears here.<br><span class="small">Review → simulate send → advance clock → see reminders.</span></div>';
  }
  function notifySeed() {
    if (notifyState.contacts.length) {
      $("notifyStatus").textContent = "Subscribers already exist. Reset session to start fresh.";
      return;
    }
    const zips = ($("sceZips").value || "90002,90008,90022")
      .split(",")
      .map((z) => z.trim())
      .filter((z) => /^\d{5}$/.test(z));
    const areas = zips.length ? zips : ["90002"];
    for (let i = 0; i < 6; i++) {
      const channel = i % 2 ? "sms" : "email";
      notifyState.contacts.push({
        id: "demo-" + i,
        name: "Demo resident " + (i + 1),
        zip: areas[Math.floor(i / 2) % areas.length],
        channel,
        destination: channel === "email" ? "resident" + (i + 1) + "@example.com" : "+1213555010" + i,
        consent: true,
        fictional: true,
      });
    }
    $("notifyZip").value = areas[0];
    $("notifyStatus").textContent =
      "Six fictional subscribers loaded with simulated opt-in. No real messages can be sent.";
    notifyRender();
  }
  function notifyReview() {
    try {
      const expected = new Date($("notifyExpected").value).getTime();
      const alert = N.makeAlert(
        {
          zip: $("notifyZip").value.trim(),
          level: $("notifyLevel").value,
          evidence: $("notifyEvidence").value,
          expected,
          expectedLabel: Number.isFinite(expected) ? nTime(expected) : "",
          clockLabel: nTime(notifyState.clock),
        },
        notifyState.clock,
      );
      const targets = N.recipients(notifyState.contacts, alert.zip);
      if (!targets.length) throw Error("Load demo subscribers or add an opted-in contact for this ZIP.");
      pendingAlert = alert;
      $("notifyReviewAudience").textContent =
        `${targets.length} opted-in demo contacts · ZIP ${alert.zip}. Recipients: ${targets.map((c) => c.name + " (" + c.channel.toUpperCase() + ")").join(", ")}.`;
      $("notifyReviewBody").textContent = alert.text;
      $("notifyReview").showModal();
    } catch (error) {
      $("notifyStatus").textContent = error.message;
    }
  }
  $("jumpNotify").onclick = () => $("notifyTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  $("seedContacts").onclick = notifySeed;
  $("notifyZip").oninput = notifyRender;
  $("addNotifyContact").onclick = () => {
    try {
      const raw = {
        id: "contact-" + Date.now() + "-" + notifyState.contacts.length,
        name: $("contactName").value.trim(),
        zip: $("contactZip").value.trim(),
        channel: $("contactChannel").value,
        destination: $("contactDestination").value.trim(),
        consent: $("contactOptin").checked,
        fictional: false,
      };
      const c = N.validateContact(raw);
      if (
        notifyState.contacts.some(
          (x) => x.channel === c.channel && x.destination === c.destination && x.zip === c.zip,
        )
      )
        throw Error("This contact is already enrolled for this ZIP.");
      notifyState.contacts.push(c);
      $("contactDestination").value = "";
      $("contactOptin").checked = false;
      $("notifyStatus").textContent =
        "Test subscriber added locally. Delivery is simulated, including for a real-looking contact.";
      notifyRender();
    } catch (error) {
      $("notifyStatus").textContent = error.message;
    }
  };
  $("reviewNotify").onclick = notifyReview;
  $("cancelNotify").onclick = () => {
    pendingAlert = null;
    $("notifyReview").close();
  };
  $("confirmNotify").onclick = () => {
    try {
      if (!pendingAlert) return;
      notifyState = N.dispatch(notifyState, pendingAlert);
      $("notifyReview").close();
      log(
        "DEMO notification: reviewed " +
          N.levels[pendingAlert.level] +
          " alert for ZIP " +
          pendingAlert.zip +
          ". Email/SMS simulated; follow-up reminders queued.",
      );
      pendingAlert = null;
      $("notifyStatus").textContent =
        "Alert simulated in outbox. Advance the demo clock to trigger reminders. No email or SMS was sent.";
      notifyRender();
    } catch (error) {
      $("notifyStatus").textContent = error.message;
      $("notifyReview").close();
    }
  };
  $("advanceNotify").onclick = () => {
    notifyState = N.advance(notifyState, 30);
    notifyRender();
  };
  $("nextNotify").onclick = () => {
    const next = notifyState.outbox.filter((m) => m.status === "scheduled").sort((a, b) => a.due - b.due)[0];
    if (!next) {
      $("notifyStatus").textContent = "No pending reminders. Review a preparation alert first.";
      return;
    }
    notifyState = N.advance(notifyState, Math.max(0.001, (next.due - notifyState.clock) / 60000));
    notifyRender();
  };
  $("exportNotify").onclick = () => {
    const report = {
      simulation: true,
      source: "PoweruP local notification demo",
      clock: new Date(notifyState.clock).toISOString(),
      alerts: notifyState.alerts,
      outbox: notifyState.outbox.map(({ destination, ...m }) => ({
        ...m,
        destinationMasked: mask({ destination, channel: m.channel }),
      })),
    };
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "PoweruP-notification-demo.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const expected = new Date(notifyState.clock + 6 * 3600000);
  expected.setMinutes(expected.getMinutes() - expected.getTimezoneOffset());
  $("notifyExpected").value = expected.toISOString().slice(0, 16);
  notifyRender();
}
