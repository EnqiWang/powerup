const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("navigation updates heading, description and overview actions for every section", () => {
  const names = ["operations", "data", "residents", "funding"];
  const nodes = new Map();
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, { textContent: "", hidden: false, onclick() {} });
    return nodes.get(key);
  };
  const sections = names.map((name) => ({ dataset: { appView: name }, hidden: false }));
  const buttons = names.map((name) => ({
    dataset: { view: name },
    active: false,
    classList: { toggle(_key, active) { buttons.find((b) => b.dataset.view === name).active = active; } },
  }));
  const context = vm.createContext({
    document: {
      body: { dataset: {} },
      querySelector: node,
      querySelectorAll: (selector) => selector === "[data-app-view]" ? sections : buttons,
    },
    $: node,
    homes: [],
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../visual.js"), "utf8"), context);
  for (const name of [...names, "operations"]) {
    buttons.find((b) => b.dataset.view === name).onclick();
    assert.equal(context.document.body.dataset.view, name);
    assert.equal(node(".global-actions").hidden, name !== "operations");
    assert.ok(node(".pagehead p").textContent.length > 0);
    assert.equal(node(".pagehead h1").textContent.includes("Stay ahead"), name === "operations");
    assert.deepEqual(sections.filter((s) => !s.hidden).map((s) => s.dataset.appView), [name]);
    assert.deepEqual(buttons.filter((b) => b.active).map((b) => b.dataset.view), [name]);
  }
  context.PowerupVisual.view("missing");
  assert.equal(context.document.body.dataset.view, "operations");
});
