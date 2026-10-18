const test = require("node:test");
const assert = require("node:assert/strict");
const { fleet } = require("./helpers");
const R = require("../retell-mock");
const S = require("../retell-server");

const KEY = "dummy-test-key";
// Realistic payload, including PII the server must strip. Dummy data only.
const payload = (over = {}) => ({
  event: "call_analyzed",
  call: {
    call_type: "web_call",
    call_id: "call-" + Math.random().toString(36).slice(2),
    agent_id: "agent_test",
    retell_llm_dynamic_variables: { home_id: "2", load_id: "ev", resident_name: "Test Resident" },
    transcript: "SECRET TRANSCRIPT",
    from_number: "+15555550100",
    to_number: "+15555550101",
    call_analysis: {
      call_summary: "SECRET SUMMARY",
      custom_analysis_data: { ev_outage_reduction_decision: "agree", permitted_hours: 4, resident_confirmed_readback: true, extra: "x" },
    },
    ...over,
  },
});

async function start(opts = {}) {
  const s = S.createServers({ apiKey: KEY, log: () => {}, ...opts });
  await Promise.all([s.app, s.webhook].map((srv) => new Promise((r) => srv.listen(0, "127.0.0.1", r))));
  const base = (srv) => "http://127.0.0.1:" + srv.address().port;
  s.post = (body, signature) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return fetch(base(s.webhook) + "/retell/webhook", {
      method: "POST",
      headers: { "x-retell-signature": signature ?? S.sign(raw, KEY) },
      body: raw,
    });
  };
  s.get = (p, port = s.app, headers = {}) => fetch(base(port) + p, { headers });
  s.feed = async () => (await (await s.get("/retell/events?after=0")).json()).events;
  return s;
}

test("signature verification matches Retell's documented scheme", () => {
  const raw = '{"event":"call_analyzed"}',
    now = Date.now(),
    sig = S.sign(raw, KEY, now);
  assert.match(sig, /^v=\d+,d=[0-9a-f]{64}$/);
  assert.ok(S.verify(raw, KEY, sig, now));
  assert.ok(!S.verify(raw + " ", KEY, sig, now), "tampered body");
  assert.ok(!S.verify(raw, "other-key", sig, now), "wrong key");
  assert.ok(!S.verify(raw, KEY, sig, now + 5 * 60_000 + 1), "stale");
  assert.ok(!S.verify(raw, KEY, "garbage", now));
  assert.ok(!S.verify(raw, KEY, undefined, now));
});

test("refuses to start without an API key", () => {
  assert.throws(() => S.createServers({ apiKey: "" }), /RETELL_API_KEY/);
});

test("verified call_analyzed is queued, sanitized, and parses as a pending EV response", async () => {
  const s = await start();
  try {
    const p = payload();
    assert.equal((await s.post(p)).status, 204);
    const [item] = await s.feed();
    const text = JSON.stringify(item);
    for (const secret of ["SECRET", "+1555", "resident_name", "extra", "agent_test"]) assert.ok(!text.includes(secret), secret);
    assert.equal(item.event.call.metadata.home_id, 2, "string dynamic variable converted to numeric home id");
    const r = R.parse(item.event, fleet(), [], "LIVE TEST");
    assert.equal(r.status, "pending");
    assert.equal(r.hours, 4);
    assert.equal(r.homeId, 2);
  } finally {
    await s.close();
  }
});

test("unsigned, tampered, wrong-key and stale webhooks are rejected and never queued", async () => {
  const s = await start();
  try {
    const raw = JSON.stringify(payload());
    assert.equal((await s.post(raw, "")).status, 401);
    assert.equal((await s.post(raw.replace('"agree"', '"decline"'), S.sign(raw, KEY))).status, 401);
    assert.equal((await s.post(raw, S.sign(raw, "wrong"))).status, 401);
    assert.equal((await s.post(raw, S.sign(raw, KEY, Date.now() - 6 * 60_000))).status, 401);
    assert.deepEqual(await s.feed(), []);
  } finally {
    await s.close();
  }
});

test("other events, other agents and duplicate retries are acknowledged but not queued twice", async () => {
  const s = await start({ agentId: "agent_test" });
  try {
    const p = payload();
    assert.equal((await s.post({ ...p, event: "call_ended" })).status, 204);
    assert.equal((await s.post(payload({ agent_id: "agent_other" }))).status, 204);
    assert.equal((await s.post(p)).status, 204);
    assert.equal((await s.post(p)).status, 204, "Retell retry");
    assert.equal((await s.feed()).length, 1);
    assert.equal((await s.post("{not json")).status, 400);
  } finally {
    await s.close();
  }
});

test("webhook port exposes nothing but POST /retell/webhook", async () => {
  const s = await start();
  try {
    for (const p of ["/", "/index.html", "/retell/events", "/.env", "/retell-server.js"])
      assert.equal((await s.get(p, s.webhook)).status, 404, p);
    const big = await s.post("x".repeat(1_100_000)).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
  } finally {
    await s.close();
  }
});

test("app port serves the UI locally but never dotfiles, traversal, or foreign Host headers", async () => {
  const s = await start();
  try {
    assert.equal((await s.get("/")).status, 200);
    assert.equal((await s.get("/planner.html")).status, 200);
    assert.equal((await s.get("/retell-mock.js")).status, 200);
    for (const p of ["/.env", "/.env.example", "/.git/config", "/..%2fetc%2fpasswd", "/..%2f..%2f..%2fetc%2fhosts", "/%2e%2e/%2e%2e/etc/hosts", "/README.md"])
      assert.equal((await s.get(p)).status, 404, p);
    // fetch() ignores a custom Host header, so use http.request to simulate DNS rebinding.
    const status = await new Promise((resolve, reject) =>
      require("node:http")
        .get({ host: "127.0.0.1", port: s.app.address().port, path: "/retell/events", headers: { Host: "evil.example" } }, (res) =>
          resolve(res.resume().statusCode),
        )
        .on("error", reject),
    );
    assert.equal(status, 403);
  } finally {
    await s.close();
  }
});

test("dashboard-style calls without home_id or with bad hours stay non-actionable", async () => {
  const s = await start();
  try {
    await s.post(payload({ retell_llm_dynamic_variables: {} }));
    const p = payload();
    p.call.call_analysis.custom_analysis_data.permitted_hours = null;
    await s.post(p);
    const [a, b] = await s.feed();
    assert.equal(R.parse(a.event, fleet()).status, "rejected");
    assert.equal(R.parse(b.event, fleet()).status, "needs follow-up");
  } finally {
    await s.close();
  }
});
