const test = require("node:test"),
  assert = require("node:assert/strict");
const { P, fleet, consent } = require("./helpers");
const cfg = { duration: 72, lead: 18, headroom: 8, floor: 0.2 };

test("Base Core capacity is the published 39.2 kWh", () => {
  assert.equal(P.makeHome(1, "x").capacity, 39.2);
});

test("staggered preparation never exceeds shared headroom", () => {
  const plan = P.prepare(consent(fleet(), cfg.duration), cfg);
  for (const step of plan.trace) assert.ok(step.total <= cfg.headroom + 1e-9);
  assert.ok(plan.homes.every((h) => h.energy <= h.capacity + 1e-9));
});

test("essential loads are never reduced; only accepted loads are", () => {
  const h = fleet()[0],
    cooling = h.loads.find((l) => l.id === "cooling");
  cooling.consent = "accepted";
  cooling.consentHours = 72;
  const b = P.budget(h, cfg, 5);
  assert.ok(b.actions.length > 0);
  assert.ok(b.actions.every((a) => a.id === "cooling"));
});

test("outage replay never creates energy or goes negative", () => {
  const homes = consent(fleet(), cfg.duration);
  let s = P.startOutage(homes, cfg, P.prepare(homes, cfg));
  for (let i = 0; i < 6; i++) s = P.advance(s, 12);
  assert.equal(s.elapsed, 72);
  assert.ok(s.devices.every((d) => d.energy >= 0 && d.energy <= d.initialEnergy + 1e-9));
});

test("relief hands unresolved kW to the operator instead of inventing capacity", () => {
  const r = P.relief(fleet(), cfg, {
    capacity: 1,
    hours: 2,
    neighbors: [{ name: "Cell site", kw: 50, graceHours: 0 }],
  });
  assert.ok(r.unresolvedKw > 0);
  assert.deepEqual(r.urgentNeighbors, ["Cell site"]);
});
