const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../replay-engine');
const DATA = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../data/replay-malibu.js'), 'utf8') + '\nDATA;');
const P = G.defaultParams(DATA);
const world = G.buildHomes(DATA, P);
const sim = G.simulate(DATA, world, P);

test('charging expense matches actual circuit charging at each hour and resets daily', () => {
  let total = 0, daily = 0, energy = 0;
  for (let h = 0; h < G.HOURS; h++) {
    if (h % 24 === 0) daily = 0;
    const kwh = Object.values(sim.circuits).reduce((sum, c) => sum + c.chargeKW[h], 0);
    const rate = h % 24 >= P.on_peak_hours[0] && h % 24 < P.on_peak_hours[1] ? P.on_peak : P.off_peak;
    total += kwh * rate; daily += kwh * rate; energy += kwh;
    assert.ok(Math.abs(sim.fleet[h].chargingCostCum - total) < 0.02, `cumulative hour ${h}`);
    assert.ok(Math.abs(sim.fleet[h].chargingCostDay - daily) < 0.02, `daily hour ${h}`);
    assert.ok(Math.abs(sim.fleet[h].chargingKwhCum - energy) < 0.05);
  }
});

test('outage-day zero does not erase preparation expense', () => {
  const h = G.rungHours(DATA).hold;
  assert.ok(sim.fleet[h].chargingCostCum > 0);
  assert.equal(sim.fleet[h].readinessDay, 0);
  assert.ok(sim.fleet[h].readinessCum > 0);
  assert.equal(sim.fleet[h + 1].chargingCostCum, sim.fleet[h].chargingCostCum);
});

test('changing rates recalculates cost, and a zero-home fleet costs zero', () => {
  const doubled = G.simulate(DATA, world, {...P, on_peak:P.on_peak*2, off_peak:P.off_peak*2});
  assert.equal(doubled.totals.chargingCost, sim.totals.chargingCost*2);
  const params = {...P, adoption_pct:0};
  const empty = G.simulate(DATA, G.buildHomes(DATA, params), params);
  assert.equal(empty.N,0);
  assert.equal(empty.totals.chargingCost,0);
});
