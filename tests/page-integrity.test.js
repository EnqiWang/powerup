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
