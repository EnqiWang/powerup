// Hosted (Render) mode of retell-server.js: API + webhooks for the GitHub Pages site.
// Retell and Cloudflare Turnstile are always stubs here: no test reaches the network.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { fs, path, root } = require("./helpers");
const S = require("../retell-server");

const KEY = "dummy-test-key",
  SITE = "https://enqiwang.github.io",
  GOOD = "good-turnstile-token";

function stubApi({ fail = false } = {}) {
  const api = { created: [], stopped: [] };
  api.createWebCall = async (body) => {
    api.created.push(body);
    if (fail) throw Error("Retell /v3/create-web-call HTTP 500");
    const n = api.created.length;
    return { call_id: "call_" + n, access_token: "tok_" + n, transport: "livekit", agent_id: body.agent_id, extra: "x" };
  };
  api.stopCall = async (id) => api.stopped.push(id);
  return api;
}
// Shaped like Cloudflare's siteverify replies (checked against the real endpoint with its test keys).
const verdict = (over = {}) => ({
  success: true,
  "error-codes": [],
  challenge_ts: new Date().toISOString(),
  hostname: "enqiwang.github.io",
  action: "talk_to_ai",
  ...over,
});
function stubTurnstile(replies = {}) {
  const seen = [];
  const fn = async (token) => {
    seen.push(token);
    if (replies[token] instanceof Error) throw replies[token];
    return replies[token] || (token.startsWith(GOOD) ? verdict() : { success: false, "error-codes": ["invalid-input-response"] });
  };
  fn.seen = seen;
  return fn;
}

const base = {
  apiKey: KEY,
  agentId: "agent_test",
  allowedOrigins: [SITE],
  turnstileSiteKey: "0x4AAAAAAAprodSiteKey",
  turnstileSecret: "0x4AAAAAAAprodSecret",
  enabled: true,
  ipSource: "xff",
  proxyHops: 1,
};
async function start(opts = {}) {
  const api = opts.api || stubApi(),
    verifyTurnstile = opts.verifyTurnstile || stubTurnstile(),
    h = S.createHostedServer({ ...base, api, verifyTurnstile, log: () => {}, ...opts });
  await new Promise((r) => h.server.listen(0, "127.0.0.1", r));
  const port = h.server.address().port;
  // http.request, because fetch() cannot set Origin freely.
  h.req = (method, p, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const raw = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
      const r = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text: data, json });
        });
      });
      r.on("error", reject);
      r.end(raw);
    });
  // What the PoweruP page sends: its Origin, JSON, and (after /retell/session) a bearer token.
  h.page = (method, p, body, token, headers = {}) =>
    h.req(method, p, {
      body,
      headers: {
        Origin: SITE,
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: "Bearer " + token }),
        ...headers,
      },
    });
  let tokens = 0;
  // A visitor tab; `ip` is what Render's proxy appends (the rightmost X-Forwarded-For entry).
  h.visitor = async (ip = "203.0.113.1") => {
    const xff = { "X-Forwarded-For": ip },
      res = await h.page("POST", "/retell/session", {}, null, xff);
    assert.equal(res.status, 200, res.text);
    const v = {
      token: res.json.token,
      call: (home_id = 2, turnstile_token = GOOD + ++tokens) => h.page("POST", "/retell/web-call", { home_id, turnstile_token }, v.token, xff),
      feed: async () => (await h.page("GET", "/retell/events?after=0", undefined, v.token)).json.events,
    };
    return v;
  };
  h.webhook = (event, call_id, over = {}, headers = {}) => {
    const raw = JSON.stringify({
      event,
      call: {
        call_id,
        call_type: "web_call",
        agent_id: "agent_test",
        metadata: { home_id: 5, load_id: "ev" },
        transcript: "SECRET TRANSCRIPT",
        call_analysis: {
          call_summary: "SECRET SUMMARY",
          custom_analysis_data: { ev_outage_reduction_decision: "agree", permitted_hours: 4, resident_confirmed_readback: true },
        },
        ...over,
      },
    });
    return h.req("POST", "/retell/webhook", { body: raw, headers: { "x-retell-signature": S.sign(raw, KEY), ...headers } });
  };
  h.api = api;
  h.turnstile = verifyTurnstile;
  return h;
}
const run = (opts, fn) => async () => {
  const h = await start(opts);
  try {
    await fn(h);
  } finally {
    await h.close();
  }
};

for (const [name, opts] of [
  ["RETELL_ENABLED is not true (kill switch, the default)", { enabled: false }],
  ["RETELL_API_KEY missing", { apiKey: "" }],
  ["RETELL_AGENT_ID missing", { agentId: "" }],
  ["ALLOWED_ORIGINS missing", { allowedOrigins: [] }],
  ["Turnstile secret missing", { turnstileSecret: "" }],
  ["Turnstile site key missing", { turnstileSiteKey: "" }],
  ["Turnstile test keys configured in production", { turnstileSiteKey: "1x00000000000000000000BB", turnstileSecret: "1x0000000000000000000000000000000AA" }],
])
  test(
    `fails closed when ${name}`,
    run(opts, async (h) => {
      assert.equal(h.callsReady(), false);
      if (opts.allowedOrigins) return assert.equal((await h.page("GET", "/retell/config")).status, 403);
      const config = (await h.page("GET", "/retell/config")).json;
      assert.equal(config.live, false);
      assert.ok(!("turnstileSiteKey" in config));
      const v = await h.visitor();
      assert.equal((await v.call()).status, 503);
      assert.equal(h.api.created.length, 0);
      assert.equal(h.turnstile.seen.length, 0);
    }),
  );

test("configFromEnv: kill switch off by default, requested defaults, origin normalization, clamps", () => {
  const c = S.configFromEnv({ ALLOWED_ORIGINS: "https://enqiwang.github.io/powerup/, http://evil.example, http://127.0.0.1:8004, junk" });
  assert.equal(c.enabled, false);
  assert.deepEqual(c.allowedOrigins, ["https://enqiwang.github.io", "http://127.0.0.1:8004"], "https only, localhost http for dev");
  assert.deepEqual(c.turnstileHostnames, ["enqiwang.github.io", "127.0.0.1"]);
  assert.deepEqual(
    [c.maxCallSeconds, c.maxConcurrent, c.maxPerDay, c.sessionPerHour, c.ipPerHour],
    [120, 2, 20, 2, 4],
  );
  assert.equal(c.ipSource, "xff");
  assert.equal(c.proxyHops, 1);
  assert.equal(c.allowTestKeys, false);
  assert.equal(S.configFromEnv({ RETELL_ENABLED: "TRUE" }).enabled, false, "only exactly \"true\"");
  assert.equal(S.configFromEnv({ RETELL_ENABLED: "true" }).enabled, true);
  assert.equal(S.configFromEnv({ MAX_CALL_SECONDS: "9999" }).maxCallSeconds, 600);
  assert.equal(S.configFromEnv({ CLIENT_IP_SOURCE: "header:Bad Header" }).ipSource, "xff");
  assert.equal(S.configFromEnv({ RETELL_CREATE_WEB_CALL_PATH: "/v2/create-phone-call" }).createPath, "/v3/create-web-call");
});

test(
  "API only: no website, no static files, health for anyone",
  run({}, async (h) => {
    for (const p of ["/", "/planner.html", "/retell-web.js", "/.env", "/package.json"])
      assert.equal((await h.req("GET", p)).status, 404, p);
    assert.equal((await h.req("GET", "/retell/health")).status, 200);
  }),
);

test(
  "CORS: only the allowed origin, no credentials; preflight allows exactly what the page sends",
  run({}, async (h) => {
    const pre = await h.req("OPTIONS", "/retell/web-call", {
      headers: { Origin: SITE, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers["access-control-allow-origin"], SITE);
    assert.equal(pre.headers["access-control-allow-methods"], "GET, POST");
    assert.equal(pre.headers["access-control-allow-headers"], "Authorization, Content-Type");
    assert.equal(pre.headers["access-control-allow-credentials"], undefined);
    assert.equal(pre.headers.vary, "Origin");
    for (const origin of ["https://evil.example", "https://enqiwang.github.io.evil.example", "null", undefined]) {
      const r = await h.req("GET", "/retell/config", { headers: origin ? { Origin: origin } : {} });
      assert.equal(r.status, 403, String(origin));
      assert.equal(r.headers["access-control-allow-origin"], undefined);
    }
    const ok = await h.page("GET", "/retell/config");
    assert.equal(ok.headers["access-control-allow-origin"], SITE);
    assert.equal(ok.headers["set-cookie"], undefined, "no cookies at all");
    assert.equal((await h.page("POST", "/retell/session", "x=1", null, { "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
  }),
);

test(
  "config exposes only the public site key and limits, never secrets",
  run({}, async (h) => {
    const r = await h.page("GET", "/retell/config");
    assert.deepEqual(r.json, { live: true, maxSeconds: 120, turnstileSiteKey: "0x4AAAAAAAprodSiteKey" });
    for (const secret of [KEY, "agent_test", "0x4AAAAAAAprodSecret"]) assert.ok(!r.text.includes(secret));
  }),
);

test(
  "sessions: signed anonymous bearer tokens; forged, expired or missing tokens are refused",
  run({}, async (h) => {
    const v = await h.visitor();
    assert.match(v.token, /^[A-Za-z0-9_-]{22}\.\d{13}\.[A-Za-z0-9_-]{43}$/);
    const [id, exp] = v.token.split(".");
    for (const bad of [
      "",
      `${id}.${exp}.${"A".repeat(43)}`,
      `${id}.${Number(exp) + 1}.${v.token.split(".")[2]}`,
      `${"a".repeat(22)}.${exp}.${v.token.split(".")[2]}`,
    ])
      assert.equal((await h.page("GET", "/retell/events", undefined, bad)).status, 401, bad);
    assert.equal((await h.page("GET", "/retell/events", undefined, v.token)).status, 200);
  }),
);

test("a token survives a restart when SESSION_SECRET is set (state starts empty), and expires after 12 h", async () => {
  let t = Date.now();
  const opts = { sessionSecret: "s".repeat(64), now: () => t };
  const a = await start(opts),
    v = await a.visitor();
  await a.close();
  const b = await start(opts);
  try {
    assert.deepEqual((await b.page("GET", "/retell/events?after=0", undefined, v.token)).json, { events: [] });
    t += 12 * 3_600_000 + 1;
    assert.equal((await b.page("GET", "/retell/events", undefined, v.token)).status, 401);
  } finally {
    await b.close();
  }
});

test(
  "new sessions are rate limited per IP",
  run({ sessionsPerIpHour: 3 }, async (h) => {
    for (let i = 0; i < 3; i++) await h.visitor("198.51.100.20");
    assert.equal((await h.page("POST", "/retell/session", {}, null, { "X-Forwarded-For": "198.51.100.20" })).status, 429);
    assert.equal((await h.page("POST", "/retell/session", {}, null, { "X-Forwarded-For": "198.51.100.21" })).status, 200);
  }),
);

test(
  "Turnstile is verified server-side before every call; failures, wrong hostname/action, stale or test-key results are refused",
  run(
    {
      verifyTurnstile: stubTurnstile({
        "t-host": verdict({ hostname: "evil.example" }),
        "t-action": verdict({ action: "login" }),
        "t-noaction": verdict({ action: undefined }),
        "t-stale": verdict({ challenge_ts: new Date(Date.now() - 301_000).toISOString() }),
        // Exactly what Cloudflare's test secret returns (checked against siteverify).
        "t-testkey": { success: true, "error-codes": [], challenge_ts: new Date().toISOString(), hostname: "example.com", metadata: { result_with_testing_key: true } },
        "t-dup": { success: false, "error-codes": ["timeout-or-duplicate"] },
        "t-down": Error("siteverify HTTP 500"),
      }),
    },
    async (h) => {
      const v = await h.visitor();
      for (const t of ["t-host", "t-action", "t-noaction", "t-stale", "t-testkey", "t-dup", "bogus"])
        assert.equal((await v.call(2, t)).status, 403, t);
      assert.equal((await v.call(2, "t-down")).status, 503);
      for (const bad of ["", 42, "x".repeat(2049)]) assert.equal((await v.call(2, bad)).status, 400);
      assert.equal(h.api.created.length, 0, "no call without a valid bot check");
      const ok = await v.call(2, GOOD);
      assert.equal(ok.status, 200);
      assert.equal(h.turnstile.seen.at(-1), GOOD);
    },
  ),
);

test(
  "test-key Turnstile results pass only when TURNSTILE_ALLOW_TEST_KEYS is set (local development)",
  run(
    {
      allowTestKeys: true,
      turnstileSiteKey: "1x00000000000000000000BB",
      turnstileSecret: "1x0000000000000000000000000000000AA",
      verifyTurnstile: async () => ({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }),
    },
    async (h) => {
      assert.equal(h.callsReady(), true);
      assert.equal((await (await h.visitor()).call(2, "XXXX.DUMMY.TOKEN.XXXX")).status, 200);
    },
  ),
);

test(
  "web call is created server-side: agent, home, EV load, no visitor identifiers, only token fields returned",
  run({}, async (h) => {
    const v = await h.visitor();
    for (const bad of ["2", 0, -1, 1.5, null, 100_001]) assert.equal((await v.call(bad)).status, 400, String(bad));
    const res = await v.call(3);
    assert.equal(res.status, 200);
    assert.deepEqual(h.api.created, [
      {
        agent_id: "agent_test",
        metadata: { home_id: 3, load_id: "ev", source: "powerup-demo" },
        retell_llm_dynamic_variables: { home_id: "3", load_id: "ev" },
      },
    ]);
    assert.deepEqual(res.json, { call_id: "call_1", access_token: "tok_1", transport: "livekit", max_seconds: 120 });
    assert.equal(res.headers["access-control-allow-origin"], SITE);
    assert.ok(!res.text.includes(KEY) && !res.text.includes(v.token));
  }),
);

test(
  "limits: one call per tab at a time, global concurrency, per-session and per-IP hourly caps",
  run({}, async (h) => {
    const a = await h.visitor("192.0.2.1"),
      b = await h.visitor("192.0.2.2"),
      c = await h.visitor("192.0.2.3");
    // Parallel requests from one tab cannot both slip through (the check is repeated after the Turnstile await).
    const [r1, r2] = await Promise.all([a.call(), a.call()]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 429]);
    assert.equal((await b.call()).status, 200);
    const busy = await c.call();
    assert.equal(busy.status, 429);
    assert.match(busy.json.error, /busy/);
    await h.webhook("call_ended", (r1.status === 200 ? r1 : r2).json.call_id);
    const a2 = await a.call();
    assert.equal(a2.status, 200, "slot freed by call_ended");
    await h.webhook("call_ended", a2.json.call_id);
    assert.match((await a.call()).json.error, /2 calls per hour in this browser tab/);
    // New tabs from one network: the per-IP cap (4/h) still applies.
    await h.webhook("call_ended", "call_2");
    const same = [];
    for (let i = 0; i < 5; i++) same.push(await h.visitor("192.0.2.9"));
    for (const v of same.slice(0, 4)) {
      const r = await v.call();
      assert.equal(r.status, 200);
      await h.webhook("call_ended", r.json.call_id);
    }
    assert.match((await same[4].call()).json.error, /4 calls per hour from this network/);
  }),
);

test(
  "rate limits use the proxy-appended (rightmost) X-Forwarded-For entry, so a spoofed left entry changes nothing",
  run({ ipPerHour: 1, sessionPerHour: 5 }, async (h) => {
    const send = (spoof) => h.visitor(`${spoof}, 198.51.100.50`);
    const first = await (await send("1.1.1.1")).call();
    assert.equal(first.status, 200);
    await h.webhook("call_ended", first.json.call_id);
    assert.match((await (await send("8.8.8.8")).call()).json.error, /from this network/);
  }),
);

test("socket and header IP sources ignore X-Forwarded-For entirely", async () => {
  for (const opts of [{ ipSource: "socket" }, { ipSource: "header:true-client-ip" }]) {
    const h = await start({ ...opts, ipPerHour: 1, sessionPerHour: 5 });
    try {
      const hdr = opts.ipSource === "socket" ? {} : { "True-Client-IP": "198.51.100.60" };
      const mk = async (xff) => {
        const r = await h.page("POST", "/retell/session", {}, null, { "X-Forwarded-For": xff, ...hdr });
        return (t) => h.page("POST", "/retell/web-call", { home_id: 2, turnstile_token: GOOD + t }, r.json.token, { "X-Forwarded-For": xff, ...hdr });
      };
      const first = await (await mk("10.0.0.1"))(1);
      assert.equal(first.status, 200);
      await h.webhook("call_ended", first.json.call_id);
      assert.equal((await (await mk("10.0.0.2"))(2)).status, 429, opts.ipSource);
    } finally {
      await h.close();
    }
  }
});

test("hourly caps reset after an hour; the daily budget (20) resets at UTC midnight", async () => {
  let t = Date.parse("2026-10-17T22:30:00Z");
  const h = await start({ now: () => t, maxPerDay: 2, verifyTurnstile: async () => verdict({ challenge_ts: new Date(t).toISOString() }) });
  try {
    const v = await h.visitor(),
      w = await h.visitor("203.0.113.2"),
      x = await h.visitor("203.0.113.3");
    for (let i = 0; i < 2; i++) await h.webhook("call_ended", (await v.call()).json.call_id);
    assert.match((await w.call()).json.error, /budget is used up/);
    t += 61 * 60_000;
    assert.match((await v.call()).json.error, /budget is used up/, "daily cap still holds after the hour");
    t = Date.parse("2026-10-18T00:01:00Z");
    assert.equal((await x.call()).status, 200, "new UTC day");
  } finally {
    await h.close();
  }
});

test(
  "failed Retell creates still count toward the limits and leak no details",
  run({ api: stubApi({ fail: true }) }, async (h) => {
    const v = await h.visitor();
    const r = await v.call();
    assert.equal(r.status, 502);
    assert.doesNotMatch(r.text, /HTTP 500|v3/);
    assert.equal((await v.call()).status, 502);
    assert.equal((await v.call()).status, 429);
    assert.equal(h.api.created.length, 2);
  }),
);

test(
  "repeated failed bot checks from one network are throttled before reaching Cloudflare",
  run({ ipPerHour: 1 }, async (h) => {
    const v = await h.visitor("192.0.2.77");
    for (let i = 0; i < 5; i++) assert.equal((await v.call(2, "bogus" + i)).status, 403);
    assert.equal((await v.call(2, "bogus-x")).status, 429);
    assert.equal(h.turnstile.seen.length, 5);
  }),
);

test(
  "server stops a call that reaches the duration cap and frees its slot",
  run({ maxCallSeconds: 0.05, maxConcurrent: 1 }, async (h) => {
    const v = await h.visitor(),
      w = await h.visitor("203.0.113.9");
    const { call_id } = (await v.call()).json;
    assert.equal((await w.call()).status, 429);
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(h.api.stopped, [call_id]);
    assert.equal((await w.call()).status, 200);
  }),
);

test(
  "webhook results reach only the session that started the call, for the home recorded at creation",
  run({}, async (h) => {
    const a = await h.visitor("192.0.2.10"),
      b = await h.visitor("192.0.2.11");
    const ca = (await a.call(2)).json.call_id,
      cb = (await b.call(4)).json.call_id;
    // Retell's servers: no Origin, no CORS, only the signature matters.
    assert.equal((await h.webhook("call_analyzed", ca)).status, 204);
    const [item] = await a.feed();
    assert.deepEqual(await b.feed(), [], "b never sees a's result");
    assert.equal(item.event.call.call_id, ca);
    assert.equal(item.event.call.metadata.home_id, 2, "payload's home_id 5 is ignored");
    assert.ok(!JSON.stringify(item).includes("SECRET"));
    await h.webhook("call_analyzed", cb, { metadata: { home_id: 2 } });
    assert.equal((await b.feed())[0].event.call.metadata.home_id, 4);
    assert.equal((await a.feed()).length, 1);
    await h.webhook("call_analyzed", ca);
    assert.equal((await a.feed()).length, 1, "Retell retries are delivered once");
  }),
);

test(
  "webhooks for unknown calls, other agents, or bad signatures are never delivered",
  run({}, async (h) => {
    const v = await h.visitor();
    const { call_id } = (await v.call()).json;
    assert.equal((await h.webhook("call_analyzed", "call_from_dashboard")).status, 204);
    assert.equal((await h.webhook("call_analyzed", call_id, { agent_id: "agent_other" })).status, 204);
    assert.equal((await h.webhook("call_analyzed", call_id, {}, { "x-retell-signature": S.sign("{}", KEY) })).status, 401);
    assert.equal((await h.webhook("call_analyzed", call_id, {}, { "x-retell-signature": "" })).status, 401);
    assert.equal((await h.req("POST", "/retell/webhook", { body: "{bad", headers: { "x-retell-signature": S.sign("{bad", KEY) } })).status, 400);
    assert.equal((await h.req("GET", "/retell/webhook")).status, 405);
    assert.deepEqual(await v.feed(), []);
  }),
);

test("turnstileVerifier posts the secret only to Cloudflare's siteverify", async () => {
  const sent = [];
  const verifyT = S.turnstileVerifier({
    secret: "sec",
    fetchImpl: async (url, init) => (sent.push({ url, init }), { ok: true, json: async () => ({ success: true }) }),
  });
  assert.deepEqual(await verifyT("tok"), { success: true });
  assert.equal(sent[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.deepEqual(JSON.parse(sent[0].init.body), { secret: "sec", response: "tok" });
  const down = S.turnstileVerifier({ secret: "sec", fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(down("tok"), /HTTP 500/);
});

test("retellApi sends the key only to api.retellai.com, for web calls and stop-call", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ call_id: "c", access_token: "t" }) };
  };
  const api = S.retellApi({ apiKey: KEY, fetchImpl });
  assert.deepEqual(await api.createWebCall({ agent_id: "a" }), { call_id: "c", access_token: "t" });
  await api.stopCall("c/1");
  assert.deepEqual(sent.map((s) => s.url), ["https://api.retellai.com/v3/create-web-call", "https://api.retellai.com/v2/stop-call/c%2F1"]);
  assert.equal(sent[0].init.headers.Authorization, "Bearer " + KEY);
  const failing = S.retellApi({ apiKey: KEY, fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(failing.createWebCall({}), /HTTP 401/);
});

test("browser voice calls only; hosted mode binds 0.0.0.0:$PORT; blueprint keeps secrets out of git and calls off", () => {
  const server = fs.readFileSync(path.join(root, "retell-server.js"), "utf8"),
    web = fs.readFileSync(path.join(root, "retell-web.js"), "utf8"),
    dev = fs.readFileSync(path.join(root, "retell-dev.js"), "utf8"),
    blueprint = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  for (const src of [server, web, dev]) assert.doesNotMatch(src, /create-phone-call|create-batch-call|from_number:/);
  assert.match(server, /if \(process\.env\.PORT\)/);
  assert.match(server, /listen\(port, "0\.0\.0\.0"/);
  assert.match(blueprint, /startCommand: node retell-server\.js/);
  assert.match(blueprint, /healthCheckPath: \/retell\/health/);
  assert.match(blueprint, /plan: free/);
  assert.match(blueprint, /key: RETELL_ENABLED\n\s+value: "false"/);
  assert.match(blueprint, /key: ALLOWED_ORIGINS\n\s+value: https:\/\/enqiwang\.github\.io\n/);
  for (const k of ["RETELL_API_KEY", "RETELL_AGENT_ID", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"])
    assert.match(blueprint, new RegExp(`key: ${k}\\n\\s+sync: false`));
  assert.doesNotMatch(dev, /retellApi\(|api\.retellai\.com/, "dev backend never talks to Retell");
});
