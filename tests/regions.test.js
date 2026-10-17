const test = require("node:test"),
  assert = require("node:assert/strict");
const { M, snaps, root, fs, path } = require("./helpers");
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const index = read("config/regions/index.json");
const region = (id) => {
  const r = M.validateRegion(read(`config/regions/${id}.json`));
  return { ...r, scenarioData: M.validateScenario(typeof r.scenario === "string" ? read(r.scenario) : r.scenario) };
};

test("index lists the four regions; LA wildfire is the default", () => {
  assert.deepEqual(index.regions, ["la-wildfire", "au-bushfire", "jp-typhoon", "community-battery"]);
  assert.equal(index.default, "la-wildfire");
});

test("every region declares hazard feed, shutoff rules, critical loads, units and currency", () => {
  for (const id of index.regions) {
    const r = region(id);
    assert.ok(r.hazardFeed.name && r.shutoffRules.name, id);
    assert.ok(r.units.temperature && r.currency.code && r.currency.symbol, id);
    assert.equal(r.criticalLoads.length, 3, id);
  }
});

test("all non-LA region data is labeled SYNTHETIC", () => {
  for (const id of index.regions.filter((x) => x !== "la-wildfire")) {
    const r = region(id);
    assert.equal(r.provenance, "SYNTHETIC");
    assert.equal(r.scenarioData.provenance, "SYNTHETIC");
    for (const e of r.scenarioData.events) assert.equal(e.provenance, "SYNTHETIC", e.id);
    for (const l of r.criticalLoads) assert.equal(l.provenance, "SYNTHETIC", l.id);
  }
  assert.throws(() => M.validateRegion({ ...region("au-bushfire"), provenance: "REAL" }), /SYNTHETIC/);
});

test("the same engine replays every region with finite metrics", () => {
  for (const id of index.regions) {
    const r = region(id),
      run = M.runScenario(r.scenarioData, snaps, { currency: r.currency, medicalLabel: r.medicalLabel });
    for (const m of run.metrics) assert.ok(Number.isFinite(m.value), `${id}.${m.id}`);
    assert.ok(run.recharge.staggeredKw <= run.recharge.surgeKw, id);
    assert.equal(run.outage.elapsed, r.scenarioData.cfg.duration, id);
  }
});

test("community-battery mode sizes sites from config, not engine edits", () => {
  const r = region("community-battery"),
    homes = M.buildFleet(r.scenarioData, snaps);
  assert.ok(homes.every((h) => h.capacity === 200));
  assert.match(r.scenarioData.fleet.capacityNote, /not a Base product spec/);
});

test("JPY prices pass the engine's price limit through config engineScale", () => {
  const r = region("jp-typhoon"),
    p = M.enginePrices(r.scenarioData.prices, r.currency);
  assert.ok(p.buy <= 10 && p.sell <= 10);
});

test("engine files are not region-aware (no region ids or currencies inside)", () => {
  for (const f of ["engine.js", "advanced.js"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /bushfire|typhoon|community-battery|JPY|AUD/, f);
  }
});
