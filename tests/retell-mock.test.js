const test = require("node:test");
const assert = require("node:assert/strict");
const { P, fleet, fs, path, root } = require("./helpers");
const R = require("../retell-mock");

const ev = (h) => h.loads.find((l) => l.id === "ev");
const withData = (patch, homeId = 1) => {
  const e = R.sample("call-x", homeId, "agree", 4);
  Object.assign(e.call.call_analysis.custom_analysis_data, patch);
  return e;
};

test("agreement with read-back becomes a pending EV outage-window reduction, without touching state", () => {
  const homes = fleet(),
    before = JSON.stringify(homes);
  const r = R.parse(R.sample("call-1", 2, "agree", 4), homes);
  assert.equal(r.status, "pending");
  assert.equal(r.decision, "accepted");
  assert.equal(r.hours, 4);
  assert.equal(r.homeId, 2);
  assert.equal(JSON.stringify(homes), before, "parse must not change the simulation");
});

test("confirm writes only the EV load consent fields", () => {
  const homes = fleet(),
    others = JSON.stringify(homes.map((h) => ({ ...h, loads: h.loads.filter((l) => l.id !== "ev") })));
  R.apply(homes, R.parse(R.sample("call-2", 2, "agree", 4), homes));
  assert.equal(ev(homes[1]).consent, "accepted");
  assert.equal(ev(homes[1]).consentHours, 4);
  assert.equal(ev(homes[0]).consent, "unasked");
  assert.equal(JSON.stringify(homes.map((h) => ({ ...h, loads: h.loads.filter((l) => l.id !== "ev") }))), others);
  assert.equal(homes[1].prepTasks, undefined, "pre-outage EV top-up task is not involved");
});

test("decline is pending until confirmed, then records declined with zero hours", () => {
  const homes = fleet(),
    r = R.parse(R.sample("call-3", 1, "decline", 0), homes);
  assert.equal(r.status, "pending");
  assert.equal(ev(homes[0]).consent, "unasked");
  R.apply(homes, r);
  assert.equal(ev(homes[0]).consent, "declined");
  assert.equal(ev(homes[0]).consentHours, 0);
});

test("unclear, out-of-range or unconfirmed agreements need human follow-up and cannot be applied", () => {
  const homes = fleet();
  for (const patch of [
    { ev_outage_reduction_decision: "maybe" },
    { ev_outage_reduction_decision: undefined },
    { permitted_hours: 0 },
    { permitted_hours: 500 },
    { permitted_hours: "four" },
    { resident_confirmed_readback: false },
    { resident_confirmed_readback: "yes" },
  ]) {
    const r = R.parse(withData(patch), homes);
    assert.equal(r.status, "needs follow-up", JSON.stringify(patch));
    assert.throws(() => R.apply(homes, r));
  }
  assert.ok(homes.every((h) => ev(h).consent === "unasked"));
});

test("malformed, unknown-home, non-EV and duplicate events are rejected", () => {
  const homes = fleet();
  const nonEv = R.sample("call-4", 1, "agree", 4);
  nonEv.call.metadata.load_id = "cooling";
  const wrongEvent = R.sample("call-5", 1, "agree", 4);
  wrongEvent.event = "call_started";
  for (const e of [null, {}, wrongEvent, R.sample("", 1, "agree", 4), R.sample("call-6", 99, "agree", 4), nonEv])
    assert.equal(R.parse(e, homes).status, "rejected");
  assert.equal(R.parse(R.sample("dup", 1, "agree", 4), homes, ["dup"]).status, "rejected");
});

test("a confirmed agreement reduces EV load only inside the window via the unchanged engine", () => {
  const cfg = { duration: 24, lead: 6, headroom: 8, floor: 0.2 },
    base = fleet(),
    homes = fleet();
  R.apply(homes, R.parse(R.sample("call-7", 1, "agree", 4), homes));
  const action = P.budget(homes[0], cfg, homes[0].energy).actions.find((a) => a.id === "ev");
  assert.ok(action, "EV reduction appears in the budget");
  assert.equal(action.untilHours, 4);
  assert.ok(P.budget(homes[0], cfg, homes[0].energy).runtime >= P.budget(base[0], cfg, base[0].energy).runtime);
});

test("planner page loads the mock after the app (then the optional web-call add-on) and labels it as a mock", () => {
  const html = fs.readFileSync(path.join(root, "planner.html"), "utf8"),
    scripts = [...html.matchAll(/<script\b[^>]*src="([^"?]+)/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(-3), ["ui.js", "retell-mock.js", "retell-web.js"]);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "index.html"), "utf8"), /retell-mock\.js/, "replay landing page has no #detail panel");
  const src = fs.readFileSync(path.join(root, "retell-mock.js"), "utf8");
  assert.match(src, /MOCK · Retell AI/);
  assert.doesNotMatch(src, /XMLHttpRequest|WebSocket|https?:\/\/|retellai\.com/i, "no external hosts");
  const fetches = [...src.matchAll(/\bfetch\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(fetches, ['"/retell/events?after=" + live.after'], "only the same-origin local feed");
  assert.match(src, /get\("retell"\) === "live" \?/, "live feed is opt-in");
});

test("field names are defined once and used by sample events", () => {
  assert.deepEqual(R.FIELDS, {
    decision: "ev_outage_reduction_decision",
    hours: "permitted_hours",
    readback: "resident_confirmed_readback",
  });
  assert.deepEqual(Object.keys(R.sample("c", 1, "agree", 4).call.call_analysis.custom_analysis_data), Object.values(R.FIELDS));
  const src = fs.readFileSync(path.join(root, "retell-mock.js"), "utf8");
  for (const name of Object.values(R.FIELDS)) assert.equal(src.split(name).length - 1, 1, name + " literal appears only in FIELDS");
});

test("records carry their source label", () => {
  const homes = fleet();
  assert.equal(R.parse(R.sample("s1", 1, "agree", 4), homes).source, "MOCK");
  assert.equal(R.parse(R.sample("s2", 1, "agree", 4), homes, [], "LIVE TEST").source, "LIVE TEST");
});

test("live feed path avoids /api/*, which static-api.js answers inside the browser", () => {
  const src = fs.readFileSync(path.join(root, "retell-mock.js"), "utf8"),
    adapter = fs.readFileSync(path.join(root, "static-api.js"), "utf8");
  assert.match(adapter, /startsWith\("\/api\/"\)/, "adapter still intercepts /api/*");
  assert.doesNotMatch(src, /fetch\("\/api\//);
});

// The default ?demo=1 fleet: every flexible load pre-accepted for the scenario duration (an assumption).
const bryson = () => {
  const s = JSON.parse(fs.readFileSync(path.join(root, "scenarios/bryson_malibu_2026.json"), "utf8"));
  const { M } = require("./helpers");
  return { homes: M.acceptConsent(M.buildFleet(s, require("./helpers").snaps), s.cfg.duration), cfg: { ...s.cfg } };
};

test("preview reproduces the 48 h → 41.6 h case and warns below target, without touching the fleet", () => {
  const { homes, cfg } = bryson(),
    before = JSON.stringify(homes),
    r = R.parse(R.sample("p1", 2, "agree", 3), homes),
    p = R.preview(homes, cfg, r, P);
  assert.equal(JSON.stringify(homes), before, "preview works on copies only");
  assert.equal(p.targetHours, 48);
  assert.equal(+p.before.runtime.toFixed(1), 48);
  assert.equal(+p.after.runtime.toFixed(1), 41.6);
  assert.ok(p.belowTarget && p.reduces);
  assert.deepEqual(p.fleetMeetingTarget, { before: 6, after: 5, of: 6 }, "other homes are unaffected");
  // The preview matches what the unchanged engine produces after a real confirm.
  R.apply(homes, r);
  const plan = P.prepare(homes, cfg);
  assert.equal(P.budget(homes[1], cfg, plan.homes[1].energy).runtime, p.after.runtime);
});

test("preview reports no change when the engine does not need the reduction", () => {
  const homes = fleet(),
    cfg = { duration: 48, lead: 24, headroom: 8, floor: 0.2 },
    p = R.preview(homes, cfg, R.parse(R.sample("p2", 2, "agree", 3), homes), P);
  assert.equal(p.before.runtime, p.after.runtime);
  assert.ok(!p.belowTarget && !p.reduces);
});

test("a confirmed resident answer overrides the scenario assumption, even when shorter, and reports old → new", () => {
  const { homes } = bryson();
  assert.deepEqual(R.consentOf(homes[1]), { consent: "accepted", hours: 48 });
  const r = R.parse(R.sample("o1", 2, "agree", 3), homes),
    out = R.apply(homes, r);
  assert.deepEqual(out, { previous: { consent: "accepted", hours: 48 }, next: { consent: "accepted", hours: 3 } });
  assert.ok(R.matches(r, R.consentOf(homes[1])));
  const d = R.parse(R.sample("o2", 3, "decline", 0), homes);
  assert.deepEqual(R.apply(homes, d).next, { consent: "declined", hours: 0 });
  // Later edits elsewhere are detectable.
  homes[1].loads.find((l) => l.id === "ev").consentHours = 72;
  assert.ok(!R.matches(r, R.consentOf(homes[1])));
});

test("a response bound to one fleet can never be applied to a replaced fleet with the same home ids", () => {
  const oldFleet = bryson().homes,
    r = R.parse(R.sample("f1", 2, "agree", 3), oldFleet),
    bound = oldFleet[1],
    newFleet = fleet();
  assert.equal(newFleet[1].id, 2, "same numeric id in the new fleet");
  assert.throws(() => R.apply(newFleet, r, bound), /no longer in the simulation/);
  assert.throws(() => R.preview(newFleet, { duration: 48, lead: 24, headroom: 8, floor: 0.2 }, r, P, bound));
  assert.ok(newFleet.every((h) => R.consentOf(h).consent === "unasked"), "new fleet untouched");
});
