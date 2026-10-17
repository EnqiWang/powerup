const test = require("node:test"),
  assert = require("node:assert/strict");
const { P, fleet } = require("./helpers");

function silent(homes, id, evidence) {
  const h = homes.find((h) => h.id === id);
  h.online = false;
  h.evidence = { ...h.evidence, ...evidence };
  return h;
}

test("talking batteries are verified capacity", () => {
  const homes = fleet(),
    c = P.classifySilent(homes[0], homes);
  assert.equal(c.category, "talking");
  assert.equal(c.verified, true);
});

test("fresh fault evidence → broken", () => {
  const homes = fleet();
  assert.equal(P.classifySilent(silent(homes, 5, { fresh: true, fault: true }), homes).category, "broken");
});

test("fresh breaker evidence → tripped (extends diagnose tripped logic)", () => {
  const homes = fleet(),
    h = silent(homes, 3, { fresh: true, breaker: "tripped" }),
    c = P.classifySilent(h, homes);
  assert.equal(c.category, "tripped");
  assert.equal(P.diagnose(h, homes).label, "Breaker trip suspected");
  assert.equal(c.verified, false);
});

test("correlated silence on one provider → not talking, still following local plan", () => {
  const homes = fleet();
  silent(homes, 2, {});
  silent(homes, 4, {});
  const c = P.classifySilent(homes[1], homes);
  assert.equal(c.category, "not-talking");
  assert.match(c.localPlan, /local plan/);
});

test("lone silence without evidence stays unknown (no guessing)", () => {
  const homes = fleet();
  assert.equal(P.classifySilent(silent(homes, 2, {}), homes).category, "unknown");
});

test("spoofed telemetry is untrusted even if it claims to be online", () => {
  const homes = fleet();
  homes[2].evidence.spoofSuspected = true;
  const c = P.classifySilent(homes[2], homes);
  assert.equal(c.category, "untrusted");
  assert.equal(c.verified, false);
});
