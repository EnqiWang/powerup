// "Talk to AI" frontend (retell-web.js) and the web-call path through retell-mock.js's browser code.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { P, fleet, fs, path, root } = require("./helpers");
const R = require("../retell-mock");

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("planner offers Talk to AI in its action bar; the replay home page links to it", () => {
  const planner = read("planner.html"),
    index = read("index.html");
  assert.match(planner, /<div class="global-actions">[\s\S]*?<button id="talkToAi">Talk to AI/);
  assert.match(index, /<a href="planner\.html\?demo=1&amp;map=0#talk-to-ai">Talk to AI/);
  assert.match(planner, /<meta name="powerup-retell-backend" content="[^"]*" \/>/);
  assert.doesNotMatch(index, /retell-(mock|web)\.js/, "replay page has no Retell panel");
});

test("frontend talks only to the configured backend, the pinned SDK and Cloudflare Turnstile", () => {
  const src = read("retell-web.js");
  const hosts = [...new Set([...src.matchAll(/https?:\/\/[a-z0-9.-]+[^\s"'`)]*/gi)].map((m) => m[0]))].sort();
  assert.deepEqual(hosts, [
    "https://cdn.jsdelivr.net/npm/retell-client-js-sdk@3.0.2/+esm",
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    "https://www.cloudflare.com/turnstile-privacy-policy/",
  ]);
  const fetches = [...src.matchAll(/\bfetch\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(fetches, ["BACKEND + path", 'BACKEND + "/retell/config"']);
  for (const p of [...src.matchAll(/api\("([^"?]+)/g)].map((m) => m[1])) assert.match(p, /^\/retell\/(session|web-call|events)$/);
  // Development overrides work only on localhost.
  assert.match(src, /\(LOCAL && params\.get\("retellBackend"\)\)/);
  assert.match(src, /SDK_URL = LOCAL && params\.get\("retellSdk"\)/);
  assert.doesNotMatch(src, /RETELL_API_KEY|api\.retellai\.com|TURNSTILE_SECRET|document\.cookie|localStorage/);
  assert.match(src, /sessionStorage/);
  assert.match(src, /action: "talk_to_ai"/);
  assert.match(src, /execution: "execute"/);
});

test("frontend accepts only an https backend (or localhost http) from the meta tag", () => {
  const re = /^https:\/\/[^/]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  assert.match(read("retell-web.js"), /\^https:\\\/\\\/\[\^\/\]\+\$\|\^http:\\\/\\\/\(localhost\|127\\\.0\\\.0\\\.1\)\(:\\d\+\)\?\$/);
  for (const ok of ["https://powerup-retell.onrender.com", "http://127.0.0.1:8016"]) assert.match(ok, re);
  for (const bad of ["http://powerup.example", "https://x.onrender.com/path", "javascript:alert(1)", ""]) assert.doesNotMatch(bad, re);
});

test("planner's configured backend is a bare https origin the frontend accepts, and the page carries no secrets", () => {
  const planner = read("planner.html"),
    backend = planner.match(/<meta name="powerup-retell-backend" content="([^"]*)" \/>/)[1];
  assert.equal(backend, "https://powerup-retell-api.onrender.com");
  assert.match(backend, /^https:\/\/[^/]+$/);
  assert.doesNotMatch(planner, /RETELL_API_KEY|TURNSTILE_SECRET|SESSION_SECRET|key_[A-Za-z0-9]{16,}|0x4AAA|agent_[A-Za-z0-9]{8,}/);
});

// Runs the real browser parts of retell-mock.js (and optionally retell-web.js) against a tiny fake DOM.
function page({ web = false, backend = "", hostname = "enqiwang.github.io", search = "" } = {}) {
  const els = {},
    created = [],
    fetched = [],
    downloads = [];
  const el = () => ({ after() {}, querySelectorAll: () => [], dataset: {}, innerHTML: "", append() {}, focus() {}, scrollIntoView() {}, click() {} });
  const ctx = {
    homes: fleet(),
    cfg: { duration: 24, lead: 6, headroom: 8, floor: 0.2 },
    outage: null,
    selected: null,
    safe: (s) => String(s),
    log: () => {},
    changed: () => {},
    render: function () {},
    Powerup: P,
    URLSearchParams,
    AbortSignal,
    Blob: class {
      constructor(parts) {
        downloads.push(JSON.parse(parts.join("")));
      }
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    location: { search, hostname, hash: "" },
    sessionStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {},
    navigator: {},
    fetch: (url) => (fetched.push(url), new Promise(() => {})),
    document: {
      createElement: () => (created.push(el()), created.at(-1)),
      getElementById: (id) => (els[id] ||= el()),
      querySelector: (q) => (q.startsWith("meta") ? { content: backend } : null),
      head: el(),
    },
  };
  ctx.$ = (id) => ctx.document.getElementById(id);
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("retell-mock.js"), ctx);
  if (web) vm.runInContext(read("retell-web.js"), ctx);
  const panel = () => created.find((e) => e.id === "retellMock").innerHTML;
  const exported = () => (els.retellExport.onclick(), downloads.at(-1).records);
  return { ctx, els, fetched, panel, exported, R: ctx.PowerupRetell };
}

test("without a backend URL the panel says so, makes no request, and the mock still works", () => {
  const { els, fetched, R: PR, ctx } = page({ web: true });
  assert.deepEqual(fetched, []);
  assert.match(els.retellLiveBody.innerHTML, /not connected on this copy of the site/);
  assert.equal(PR.receive(R.sample("mock-1", 1, "agree", 4)).status, "pending");
  assert.equal(ctx.homes[0].loads.find((l) => l.id === "ev").consent, "unasked", "still needs Confirm");
});

test("with a backend URL the page first asks /retell/config (which also wakes a sleeping server)", () => {
  const { fetched } = page({ web: true, backend: "https://powerup-retell.onrender.com/" });
  assert.deepEqual(fetched, ["https://powerup-retell.onrender.com/retell/config"]);
  assert.deepEqual(page({ web: true, backend: "http://powerup.example" }).fetched, [], "non-https backend ignored");
});

test("a web call result is bound to the home selected when the call started, not looked up by id", () => {
  const { ctx, R: PR } = page();
  const home = ctx.homes[1];
  PR.expect("web-1", home);
  const r = PR.receive(R.sample("web-1", 2, "agree", 3), "WEB CALL");
  assert.equal(r.status, "pending");
  assert.equal(r.homeId, 2);
  assert.equal(home.loads.find((l) => l.id === "ev").consent, "unasked", "nothing changes before Confirm");
  // A result naming a different home than the one pinned is refused.
  PR.expect("web-2", ctx.homes[0]);
  assert.equal(PR.receive(R.sample("web-2", 2, "agree", 3), "WEB CALL").status, "rejected");
});

test("web call results this tab did not start are refused", () => {
  const { R: PR } = page();
  const r = PR.receive(R.sample("someone-else", 2, "agree", 3), "WEB CALL");
  assert.equal(r.status, "rejected");
  assert.match(r.reason, /not started from this browser tab/);
});

test("if the fleet is replaced during a call, the result is not applied to a same-id home in the new fleet", () => {
  const { ctx, R: PR } = page();
  PR.expect("web-3", ctx.homes[1]);
  ctx.homes = fleet(); // e.g. region or data change while the call was running
  const r = PR.receive(R.sample("web-3", 2, "agree", 3), "WEB CALL");
  assert.equal(r.status, "rejected");
  assert.match(r.reason, /fleet was replaced/);
  assert.ok(ctx.homes.every((h) => R.consentOf(h).consent === "unasked"));
});

test("the Retell panel tells real web calls apart from mock results", () => {
  const { R: PR, ctx } = page();
  const src = read("retell-mock.js");
  assert.doesNotMatch(src, /Simulated post-call results only/);
  assert.match(src, /<b>WEB CALL<\/b> is a real browser voice call/);
  assert.match(src, /<b>MOCK<\/b> is simulated by the buttons here, with no call placed/);
  assert.match(src, /MOCK · Retell AI<\/span><p class="retell-text">Simulate a post-call result\. No call is placed\./);
  // Own tag class: the team's .badge is pushed right by margin-left:auto and hidden below 650 px.
  for (const f of ["retell-mock.js", "retell-web.js"]) assert.doesNotMatch(read(f), /class="badge"/, f);
  assert.match(read("planner.html"), /<link rel="stylesheet" href="retell\.css\?v=\d+" \/>/);
  PR.expect("web-9", ctx.homes[0]);
  assert.equal(PR.receive(R.sample("web-9", 1, "agree", 2), "WEB CALL").source, "WEB CALL");
  assert.equal(PR.receive(R.sample("mock-9", 1, "agree", 2)).source, "MOCK");
});

test("public page: no mock buttons and no MOCK results, while real web call results of every status stay listed", () => {
  for (const search of ["", "?demo=1&map=0", "?retellMock=1", "?demo=1&retellMock=1"]) {
    const { R: PR, ctx, panel } = page({ search });
    assert.equal(PR.mockMode, false, search);
    assert.doesNotMatch(panel(), /retellSampleAgree|retellSampleDecline|Mock call|MOCK/, search);
    assert.match(panel(), /No call results yet/);
    // A mock received anyway (e.g. from the console) is kept but not listed.
    const m = PR.receive(R.sample("mock-hidden", 1, "agree", 4));
    assert.equal(m.status, "pending");
    assert.doesNotMatch(panel(), /mock-hidden|MOCK/);
    assert.match(panel(), /No call results yet/);
    assert.doesNotMatch(panel(), /retellExport/);
    assert.match(PR.receive(R.sample("mock-hidden", 1, "agree", 4)).reason, /Duplicate/, "the hidden record is still stored");
    // Real results: pending, declined (pending decline), rejected.
    PR.expect("web-a", ctx.homes[0]);
    PR.expect("web-d", ctx.homes[1]);
    PR.receive(R.sample("web-a", 1, "agree", 3), "WEB CALL");
    PR.receive(R.sample("web-d", 2, "decline", 0), "WEB CALL");
    PR.receive(R.sample("web-x", 2, "agree", 3), "WEB CALL");
    const html = panel();
    for (const id of ["web-a", "web-d", "web-x"]) assert.match(html, new RegExp("call " + id));
    assert.match(html, /WEB CALL<\/span><span class="retell-status">pending/);
    assert.match(html, /WEB CALL<\/span><span class="retell-status">rejected/);
    assert.match(html, /Declines any EV charging reduction/);
    assert.match(html, /data-retellconfirm=.*data-retelldiscard=/s, "Confirm/Discard unchanged");
    assert.match(html, /<button id="retellExport" class="wide">Export call records<\/button>/);
  }
});

test("developer mode (?retellMock=1 on localhost only) shows the mock buttons and MOCK results", () => {
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const { R: PR, panel } = page({ hostname, search: "?retellMock=1" });
    assert.equal(PR.mockMode, true);
    assert.match(panel(), /<button id="retellSampleAgree">Mock call: agrees \(4 h\)<\/button><button id="retellSampleDecline">Mock call: declines<\/button>/);
    PR.receive(R.sample("mock-shown", 1, "agree", 4));
    assert.match(panel(), /retell-tag mock">MOCK<\/span>[\s\S]*call mock-shown/);
  }
  assert.equal(page({ hostname: "localhost", search: "?demo=1" }).R.mockMode, false, "?demo=1 does not enable mocks");
  assert.equal(page({ hostname: "localhost", search: "?retellMock=0" }).R.mockMode, false);
});

test("voice status notes mention the mock buttons only in developer mode", () => {
  assert.doesNotMatch(page({ web: true }).els.retellLiveBody.innerHTML, /mock/i);
  assert.match(page({ web: true, hostname: "localhost", search: "?retellMock=1" }).els.retellLiveBody.innerHTML, /mock buttons above still work/);
});

test("Export call records: the public page exports only visible records; developer mode still exports mocks", () => {
  const pub = page();
  pub.R.receive(R.sample("mock-old", 1, "agree", 4));
  pub.R.expect("web-e", pub.ctx.homes[0]);
  pub.R.receive(R.sample("web-e", 1, "agree", 3), "WEB CALL");
  pub.R.receive(R.sample("web-foreign", 2, "agree", 3), "WEB CALL");
  assert.deepEqual(pub.exported().map((r) => [r.source, r.callId]), [["WEB CALL", "web-e"], ["WEB CALL", "web-foreign"]]);
  assert.match(pub.R.receive(R.sample("mock-old", 1, "agree", 4)).reason, /Duplicate/, "the mock is still stored internally");
  const dev = page({ hostname: "localhost", search: "?retellMock=1" });
  dev.R.receive(R.sample("mock-dev", 1, "agree", 4));
  dev.R.expect("web-dev", dev.ctx.homes[1]);
  dev.R.receive(R.sample("web-dev", 2, "decline", 0), "WEB CALL");
  assert.deepEqual(dev.exported().map((r) => r.source), ["MOCK", "WEB CALL"]);
});
