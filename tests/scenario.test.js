const test = require("node:test"),
  assert = require("node:assert/strict");
const { P, M, snaps, root, fs, path } = require("./helpers");
const load = () => JSON.parse(fs.readFileSync(path.join(root, "scenarios/bryson_malibu_2026.json"), "utf8"));

test("Bryson scenario loads and validates", () => {
  const s = M.validateScenario(load());
  assert.equal(s.zip, "90265");
  assert.match(s.pitch, /6 days before Malibu went dark/);
});

test("every event has a source label; every Grace action is INFERRED", () => {
  for (const e of load().events) {
    assert.ok(e.source, e.id);
    if (e.grace) assert.equal(e.grace.provenance, "INFERRED", e.id);
  }
  const phases = load().events.filter((e) => e.grace).map((e) => e.grace.phase);
  for (const p of ["WATCH", "ASK", "FILL", "HOLD", "HAND OFF"]) assert.ok(phases.includes(p), p);
});

test("circuit sizes match public counts; Tuna has no record", () => {
  const c = Object.fromEntries(load().circuits.map((x) => [x.name, x.customers]));
  assert.deepEqual(c, { Cuthbert: 2407, Galahad: 2220, Merlin: 775, Maguire: 687, Serra: 285, Tuna: null });
  const total = Object.values(c).reduce((s, x) => s + (x || 0), 0);
  assert.equal(total, 6374);
});

test("the forecast lead is about six days before the lights went out", () => {
  const ev = Object.fromEntries(load().events.map((e) => [e.id, e])),
    days = (Date.parse(ev["bryson-ignition"].at) - Date.parse(ev["nws-santa-ana"].at)) / 864e5;
  assert.ok(days > 6 && days < 7, String(days));
});

test("loader rejects bad scenarios", () => {
  const s = load();
  s.events[0].grace.provenance = "REAL";
  assert.throws(() => M.validateScenario(s), /INFERRED/);
  const t = load();
  delete t.events[1].source;
  assert.throws(() => M.validateScenario(t), /source/);
  const u = load();
  u.events.reverse();
  assert.throws(() => M.validateScenario(u), /time order/);
});

test("fleet uses the real ZIP 90265 SCE average and Base Core 39.2 kWh", () => {
  const homes = M.buildFleet(load(), snaps);
  assert.equal(homes.length, 6);
  for (const h of homes) {
    assert.equal(h.capacity, 39.2);
    assert.equal(h.meanKw, snaps.sce.zips["90265"].latest.meanKw);
  }
  assert.equal(homes.filter((h) => h.medicalBaseline).length, 2);
});

test("replay: budget beats no plan, Medical Baseline homes protected, staggered recharge beats surge", () => {
  const s = load(),
    r = M.runScenario(s, snaps),
    m = Object.fromEntries(r.metrics.map((x) => [x.id, x]));
  assert.ok(m.backup.value > m.backup.baseline, "budget extends backup");
  assert.equal(m.medical.value, 2);
  assert.ok(m.kept.value > m.kept.baseline);
  assert.ok(r.recharge.staggeredKw < r.recharge.surgeKw);
  for (const step of r.plan.trace) assert.ok(step.total <= s.cfg.headroom + 1e-9);
});

test("Medical Baseline homes start charging first", () => {
  const s = load(),
    r = M.runScenario(s, snaps),
    first = r.plan.trace[0].allocations;
  for (const h of r.homes.filter((h) => h.medicalBaseline)) assert.ok(first[h.id] > 0, h.name);
});

test("demo replay runs about three minutes and every step is wired", () => {
  const s = load(),
    total = s.demo.reduce((n, x) => n + x.seconds, 0),
    known = ["tuesday", "watch", "ask", "fill", "hold", "silent", "handoff"];
  assert.ok(total >= 150 && total <= 200, total + " s");
  for (const d of s.demo) assert.ok(known.includes(d.id), d.id);
  assert.deepEqual(
    s.demo.map((d) => d.id),
    known,
  );
  assert.ok(P.classifySilent);
});
