const test = require("node:test"),
  assert = require("node:assert/strict");
const { P, M, snaps, config, fleet, consent, root, fs, path } = require("./helpers");
const route = (u) => M.demoRoute(new URL(u, "http://localhost:8004"), snaps);

test("?demo=1 turns demo mode on; ?demo=0 does not", () => {
  assert.equal(M.isDemo("?demo=1"), true);
  assert.equal(M.isDemo("?demo=0"), false);
  assert.equal(M.isDemo(""), false);
});

test("every bundled snapshot records its source and fetch time", () => {
  for (const [name, s] of Object.entries(snaps)) {
    assert.ok(s.source, name + " source");
    assert.ok(!Number.isNaN(Date.parse(s.fetchedAt)), name + " fetchedAt");
  }
});

test("demo routes answer every app API from snapshots", () => {
  const sce = route("/api/sce?zip=90002");
  assert.equal(sce.status, 200);
  assert.equal(sce.body.kind, "zip-benchmark");
  assert.equal(route("/api/sce?zip=99999").status, 404);
  const w = route("/api/weather?lat=34&lon=-118");
  assert.equal(w.status, 200);
  assert.ok(Array.isArray(w.body.periods) && Array.isArray(w.body.alerts));
  const g = route("/api/geography?zips=90002,90008,12345");
  assert.deepEqual(g.body.features.map((f) => f.properties.zip).sort(), ["90002", "90008"]);
  assert.deepEqual(g.body.missing, ["12345"]);
  const o = route("/api/households/public");
  assert.equal(o.body.schema, "powerup.measured-loads.v1");
  assert.equal(o.body.homes.length, 6);
  assert.equal(route("/api/households/cached").status, 404);
  assert.equal(route("/powerup/api/sce?zip=90046").status, 200, "works under a Pages sub-path");
});

test("demo routing has no network calls or remote URLs", () => {
  const src = fs.readFileSync(path.join(root, "demo-model.js"), "utf8"),
    body = src.slice(src.indexOf("function demoRoute"), src.indexOf("// Everyone plugs in"));
  assert.doesNotMatch(body, /fetch|https?:\/\//);
});

test("map=0 keeps the map offline and retains the Census SVG fallback", () => {
  const scene = fs.readFileSync(path.join(root, "scene.js"), "utf8"),
    guard = scene.indexOf("get('map')==='0'"),
    mapImport = scene.indexOf("import(MODULE)");
  assert.ok(guard >= 0 && guard < mapImport, "offline guard runs before the MapLibre import");
  assert.match(scene, /id=\"geoFallback\"/);
  assert.match(scene, /Offline outline map of loaded ZIP areas/);
});

test("initial theme defaults to light while honoring a saved choice", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(root, "ui.js"), "utf8");
  assert.match(html, /savedTheme === "dark" \|\| savedTheme === "light"[\s\S]*\? savedTheme[\s\S]*: "light"/);
  assert.match(ui, /saved==='light'\|\|saved==='dark'\?saved:'light'/);
  assert.doesNotMatch(ui, /prefers-color-scheme/);
});

test("scenario controls auto-load the demo fleet and omit the assumed heading", () => {
  const demo = fs.readFileSync(path.join(root, "demo.js"), "utf8");
  assert.match(demo, /TRY A SCENARIO/);
  assert.doesNotMatch(demo, /TWISTS <i class="prov assumed">ASSUMED<\/i>/);
  assert.match(demo, /if \(!homes\.length\) \{\s*setupFleet\(\);\s*\}/);
});

test("headline metrics are finite and carry provenance badges", () => {
  const homes = consent(fleet(), 72),
    c = config.baseCase.cfg,
    m = M.headline(homes, c, config.baseCase.prices, P.prepare(homes, c));
  assert.deepEqual(
    m.map((x) => x.id),
    ["backup", "kept", "essential", "headroom", "value"],
  );
  for (const x of m) {
    assert.ok(Number.isFinite(x.value), x.id);
    assert.ok(["REAL", "ASSUMED", "MIXED"].includes(x.provenance), x.id);
  }
  assert.ok(m[0].value > m[0].baseline, "budget extends backup hours");
  assert.ok(m[3].baseline > c.headroom, "4 PM rush exceeds shared headroom");
  assert.ok(m[4].value > 0, "ordinary-day value is positive with participation");
});

test("config: Port of Long Beach is labeled ASSUMED and makes no control claim", () => {
  const port = config.criticalLoads.find((l) => /Long Beach/.test(l.name));
  assert.equal(port.provenance, "ASSUMED");
  assert.match(port.name, /ASSUMED/);
  assert.match(port.note, /does not control/);
  assert.equal(config.battery.capacityKwh, 39.2);
});

test("config: critical-load inputs and every script tag exist", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const l of config.criticalLoads) assert.match(html, new RegExp(`id="${l.inputId}"`));
  for (const [, src] of html.matchAll(/<script src="([^"?]+)/g)) assert.ok(fs.existsSync(path.join(root, src)), src);
});

test("each twist is config-only and never mutates the base case", () => {
  const known = Object.keys(config.effectTypes),
    base = {
      homes: fleet(),
      cfg: { ...config.baseCase.cfg },
      shield: { ...config.baseCase.shield },
      criticalLoads: config.criticalLoads,
    },
    before = JSON.stringify(base);
  for (const t of config.twists) {
    for (const k of Object.keys(t.effects)) assert.ok(known.includes(k), `${t.id}: unknown effect ${k}`);
    const r = M.applyTwists(base, config.twists, [t.id]);
    assert.ok(r.trail.length > 0, t.id + " leaves a decision trail");
    assert.ok(M.headline(r.state.homes, r.state.cfg, config.baseCase.prices, null));
  }
  assert.equal(JSON.stringify(base), before);
});

test("spoof + cell-outage twists move capacity to unverified buckets", () => {
  const base = { homes: fleet(), cfg: { ...config.baseCase.cfg }, shield: {}, criticalLoads: config.criticalLoads },
    { state } = M.applyTwists(base, config.twists, ["spoofed-telemetry", "cell-outage"]),
    cats = state.homes.map((h) => P.classifySilent(h, state.homes).category);
  assert.deepEqual(cats, ["talking", "not-talking", "untrusted", "not-talking", "talking", "talking"]);
});

test("demo script runs about three minutes", () => {
  const s = config.demoScript.reduce((n, x) => n + x.seconds, 0);
  assert.ok(s >= 150 && s <= 200, s + " s");
  assert.equal(config.demoSilent.length, 4);
});
