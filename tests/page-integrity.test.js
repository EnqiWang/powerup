const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("page has one shell, header and main, with unique IDs and scripts", () => {
  for (const pattern of [/class="app-shell"/g, /class="topbar"/g, /<main\b/g]) {
    assert.equal([...html.matchAll(pattern)].length, 1, String(pattern));
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate HTML IDs");
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"?]+)/g)].map((m) => m[1]);
  assert.equal(new Set(scripts).size, scripts.length, "duplicate script execution");
  assert.match(html, /href="demo\.css\?/);
});

test("every page script parses before it reaches the browser", () => {
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = attributes.match(/src="([^"?]+)/)?.[1];
    const code = src ? fs.readFileSync(path.join(root, src), "utf8") : body;
    assert.doesNotThrow(() => new vm.Script(code, { filename: src || "inline script" }));
  }
});

test("first-use flow offers examples and keeps technical inputs collapsed", () => {
  assert.match(html, /id="gettingStarted"/);
  assert.match(html, /id="tryExamples"[^>]*>Try example homes/);
  assert.match(html, /<details class="charging-settings">[\s\S]*?id="headroom"[\s\S]*?id="floor"[\s\S]*?<\/details>/);
  assert.match(html, /id="approve"[^>]*>Review plan/);
  const visual = fs.readFileSync(path.join(root, "visual.js"), "utf8");
  assert.match(visual, /\$\("tryExamples"\)\.onclick = \(\) => \{\s*mode = "prepare";\s*offline\(\);/);
});

test("old poster URL redirects to the app, including on GitHub Pages subpaths", () => {
  const poster = fs.readFileSync(path.join(root, "poster.html"), "utf8");
  assert.match(poster, /window\.location\.replace\("\.\/"\)/);
  assert.match(poster, /http-equiv="refresh" content="0; url=\.\/"/);
  assert.equal(new URL("./", "https://enqiwang.github.io/powerup/poster.html").pathname, "/powerup/");
  assert.doesNotMatch(poster, /Export PNG|Export PDF|<canvas/);
});

test("simplified overview labels its average correctly and includes unverified homes needing help", () => {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /"Average backup time",\s*known\.length \? fmt\(coverage \/ known\.length\)/);
  assert.match(app, /"Homes needing help",\s*String\(homes\.length - ready\)/);
});

test("planning flow has three progress steps and readable styles loaded last", () => {
  assert.deepEqual([...html.matchAll(/data-plan-step="(\d)"/g)].map((m) => m[1]), ["1", "2", "3"]);
  const styles = [...html.matchAll(/<link[^>]*href="([^"?]+\.css)/g)].map((m) => m[1]);
  assert.equal(styles.at(-1), "simple-ui.css");
  assert.ok(fs.existsSync(path.join(root, styles.at(-1))));
});
