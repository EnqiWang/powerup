/* PoweruP × Retell AI — webhook receiver and (hosted) web-call backend. Node built-ins only.
   LOCAL mode (no PORT env): two listeners on 127.0.0.1, no outbound requests.
     APP_PORT     (8014) static PoweruP UI + GET /retell/events  — never tunnel this port
     WEBHOOK_PORT (8015) POST /retell/webhook only, signature-verified — the only port a tunnel may expose
   HOSTED mode (PORT set, e.g. Render): API + webhook only on 0.0.0.0:$PORT; the UI stays on GitHub Pages.
     Browser voice calls only. Each web call is created here after a Cloudflare Turnstile check and the limits;
     the browser gets a short-lived access token for that call, never the API key. Sessions are anonymous bearer
     tokens (no cookies, so cross-site requests work). Webhooks are accepted only for calls this instance created
     and delivered only to the session that started them. See DEPLOY-RENDER.md.
   Events only queue here. Simulation state changes when the operator clicks Confirm in the browser.
   Run: npm run retell   (needs RETELL_API_KEY in .env, see .env.example) */
"use strict";
const http = require("node:http"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path");
const { FIELDS, LOAD } = require("./retell-mock.js");

const MAX_BODY = 1_000_000,
  MAX_BROWSER_BODY = 4096,
  TOLERANCE_MS = 5 * 60_000,
  MAX_EVENTS = 500,
  HOUR = 3_600_000,
  RETELL_API = "https://api.retellai.com",
  TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };

// Retell docs, "verify without SDK": header "v=<ms>,d=<hex HMAC-SHA256(rawBody + ms, API key)>", 5-minute window.
function sign(rawBody, apiKey, now = Date.now()) {
  return `v=${now},d=` + crypto.createHmac("sha256", apiKey).update(rawBody + now).digest("hex");
}
function verify(rawBody, apiKey, header, now = Date.now()) {
  const m = /^v=(\d+),d=([0-9a-f]{64})$/.exec(String(header || ""));
  if (!m || Math.abs(now - Number(m[1])) > TOLERANCE_MS) return false;
  const expected = crypto.createHmac("sha256", apiKey).update(rawBody + m[1]).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(m[2], "hex"));
}

// Keep only what parse() reads. Transcript, phone numbers, summary and recordings never leave this process.
// Dashboard test calls cannot set metadata, so home_id/load_id may come from dynamic variables (always strings).
// Hosted mode passes `homeId`: the home recorded when this server created the call wins over anything in the payload.
function sanitize(call, homeId) {
  const vars = call.retell_llm_dynamic_variables || {},
    meta = call.metadata || {},
    rawHome = homeId ?? meta.home_id ?? vars.home_id,
    data = call.call_analysis?.custom_analysis_data || {};
  return {
    event: "call_analyzed",
    call: {
      call_id: String(call.call_id || "").slice(0, 80),
      call_type: call.call_type === "phone_call" ? "phone_call" : "web_call",
      metadata: {
        home_id: /^\d+$/.test(String(rawHome)) ? Number(rawHome) : null,
        load_id: String(meta.load_id ?? vars.load_id ?? ""),
      },
      call_analysis: {
        custom_analysis_data: Object.fromEntries(Object.values(FIELDS).filter((k) => k in data).map((k) => [k, data[k]])),
      },
    },
  };
}

// Reads a request body up to `limit` bytes; answers 413 itself when exceeded.
function readBody(req, res, limit, done) {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > limit) {
      res.writeHead(413).end();
      req.destroy();
    } else chunks.push(c);
  });
  req.on("end", () => res.headersSent || done(Buffer.concat(chunks).toString("utf8")));
}

// No dotfiles (.env, .git), nothing outside the repo, only known static types.
function serveStatic(root, url, send) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return send(400, "text/plain", "Bad path");
  }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(root, "." + rel);
  if (!file.startsWith(root + path.sep) || /(^|[\\/])\./.test(path.relative(root, file)) || !TYPES[path.extname(file)])
    return send(404, "text/plain", "Not found");
  fs.readFile(file, (err, data) => (err ? send(404, "text/plain", "Not found") : send(200, TYPES[path.extname(file)], data)));
}

function createServers({ apiKey, agentId = "", root = __dirname, log = console.log }) {
  if (!apiKey) throw Error("RETELL_API_KEY is missing. Copy .env.example to .env and add the key with the webhook badge.");
  const events = [],
    seen = new Set();
  let seq = 0;

  const webhook = http.createServer((req, res) => {
    const end = (code) => res.writeHead(code).end();
    if (req.method !== "POST" || req.url !== "/retell/webhook") return end(404);
    readBody(req, res, MAX_BODY, (raw) => {
      if (!verify(raw, apiKey, req.headers["x-retell-signature"])) {
        log("webhook: rejected (bad or stale signature)");
        return end(401);
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return end(400);
      }
      const call = body?.call || {};
      // 204 for everything verified, so Retell does not retry events we deliberately ignore.
      if (body.event !== "call_analyzed") return end(204);
      if (agentId && call.agent_id !== agentId) {
        log("webhook: ignored call from another agent");
        return end(204);
      }
      const clean = sanitize(call);
      if (!clean.call.call_id || seen.has(clean.call.call_id)) return end(204);
      seen.add(clean.call.call_id);
      events.push({ seq: ++seq, event: clean });
      if (events.length > MAX_EVENTS) events.shift();
      log(`webhook: queued ${clean.call.call_type} ${clean.call.call_id} for home ${clean.call.metadata.home_id} (awaiting operator)`);
      end(204);
    });
  });

  const app = http.createServer((req, res) => {
    const send = (code, type, body) => res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);
    // Localhost only: refuse other Host headers (DNS rebinding), and anything but GET/HEAD.
    const host = String(req.headers.host || "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost"].includes(host)) return send(403, "text/plain", "Forbidden");
    if (!["GET", "HEAD"].includes(req.method)) return send(405, "text/plain", "Method not allowed");
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/retell/events") {
      const after = Number(url.searchParams.get("after")) || 0;
      return send(200, "application/json", JSON.stringify({ events: events.filter((e) => e.seq > after) }));
    }
    serveStatic(root, url, send);
  });

  const close = () => Promise.all([app, webhook].map((s) => new Promise((r) => s.close(r))));
  return { app, webhook, events, close };
}

// The two Retell REST calls hosted mode makes. Web calls only; this file never creates phone calls.
function retellApi({ apiKey, createPath = "/v3/create-web-call", fetchImpl = fetch }) {
  const post = async (p, body) => {
    const res = await fetchImpl(RETELL_API + p, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw Error(`Retell ${p} HTTP ${res.status}`);
    return res.status === 204 ? null : res.json().catch(() => null);
  };
  return {
    createWebCall: (body) => post(createPath, body),
    stopCall: (callId) => post("/v2/stop-call/" + encodeURIComponent(callId), {}),
  };
}


// Cloudflare Turnstile server-side check. Tokens are single-use and expire after 300 s.
const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  TURNSTILE_ACTION = "talk_to_ai";
function turnstileVerifier({ secret, fetchImpl = fetch }) {
  return async (token) => {
    const res = await fetchImpl(TURNSTILE_VERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw Error("siteverify HTTP " + res.status);
    return res.json();
  };
}
// Cloudflare's published dummy keys: always pass/fail, any hostname. Never acceptable in production.
const isTestSiteKey = (k) => /^[123]x0{20}[A-Z]{2}$/.test(k),
  isTestSecret = (k) => /^[123]x0{31}AA$/.test(k);

const int = (v, d, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
// "https://enqiwang.github.io/powerup/" → "https://enqiwang.github.io". https only, except localhost for development.
function normalizeOrigin(o) {
  try {
    const u = new URL(String(o).trim());
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    return (u.protocol === "https:" || (local && u.protocol === "http:")) && !u.username ? u.origin : null;
  } catch {
    return null;
  }
}
// Every hosted setting comes from the environment. Secrets stay here; /retell/config exposes none of them.
function configFromEnv(env = process.env) {
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "").split(",").map(normalizeOrigin).filter(Boolean);
  return {
    apiKey: env.RETELL_API_KEY || "",
    agentId: env.RETELL_AGENT_ID || "",
    allowedOrigins,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
    turnstileSecret: env.TURNSTILE_SECRET_KEY || "",
    turnstileHostnames: env.TURNSTILE_HOSTNAMES
      ? env.TURNSTILE_HOSTNAMES.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
      : allowedOrigins.map((o) => new URL(o).hostname),
    allowTestKeys: env.TURNSTILE_ALLOW_TEST_KEYS === "true",
    sessionSecret: env.SESSION_SECRET || "",
    // Kill switch, off unless explicitly "true".
    enabled: env.RETELL_ENABLED === "true",
    createPath: env.RETELL_CREATE_WEB_CALL_PATH === "/v2/create-web-call" ? "/v2/create-web-call" : "/v3/create-web-call",
    maxCallSeconds: int(env.MAX_CALL_SECONDS, 120, 30, 600),
    maxConcurrent: int(env.MAX_CONCURRENT_CALLS, 2, 1, 20),
    maxPerDay: int(env.MAX_CALLS_PER_DAY, 20, 0, 1000),
    sessionPerHour: int(env.SESSION_CALLS_PER_HOUR, 2, 0, 60),
    ipPerHour: int(env.IP_CALLS_PER_HOUR, 4, 0, 120),
    sessionsPerIpHour: int(env.IP_SESSIONS_PER_HOUR, 20, 1, 500),
    ipSource: /^(xff|socket|header:[a-z0-9-]+)$/.test(env.CLIENT_IP_SOURCE || "") ? env.CLIENT_IP_SOURCE : "xff",
    proxyHops: int(env.TRUST_PROXY_HOPS, 1, 1, 5),
    debugIp: env.DEBUG_CLIENT_IP === "true",
  };
}

// HOSTED mode: API + webhook only (no UI). The GitHub Pages site calls it cross-origin with a bearer session token.
function createHostedServer({
  apiKey = "",
  agentId = "",
  allowedOrigins = [],
  turnstileSiteKey = "",
  turnstileSecret = "",
  turnstileHostnames = allowedOrigins.map((o) => new URL(o).hostname),
  allowTestKeys = false,
  sessionSecret = "",
  enabled = false,
  createPath,
  maxCallSeconds = 120,
  maxConcurrent = 2,
  maxPerDay = 20,
  sessionPerHour = 2,
  ipPerHour = 4,
  sessionsPerIpHour = 20,
  ipSource = "xff",
  proxyHops = 1,
  debugIp = false,
  api = retellApi({ apiKey, createPath }),
  verifyTurnstile = turnstileVerifier({ secret: turnstileSecret }),
  now = Date.now,
  log = console.log,
}) {
  // Fail closed: without every one of these, the backend answers but no real call can be created.
  const testKeys = isTestSiteKey(turnstileSiteKey) || isTestSecret(turnstileSecret);
  const missing = [
    !apiKey && "RETELL_API_KEY",
    !agentId && "RETELL_AGENT_ID",
    !allowedOrigins.length && "ALLOWED_ORIGINS",
    !turnstileSiteKey && "TURNSTILE_SITE_KEY",
    !turnstileSecret && "TURNSTILE_SECRET_KEY",
    testKeys && !allowTestKeys && "production Turnstile keys (test keys configured)",
  ].filter(Boolean);
  const callsReady = () => enabled && !missing.length;
  if (missing.length) log("live calls DISABLED, missing: " + missing.join(", "));
  else if (!enabled) log("live calls DISABLED: RETELL_ENABLED is not \"true\" (kill switch)");
  if (testKeys && allowTestKeys) log("WARNING: Turnstile TEST keys accepted; every bot check passes. Development only.");

  const secret = sessionSecret || crypto.randomBytes(32).toString("hex"),
    hmac = (s) => crypto.createHmac("sha256", secret).update(s).digest("base64url");
  if (!sessionSecret) log("SESSION_SECRET not set: visitor sessions reset on every restart");

  const sessions = new Map(), // session id → { events, seq, calls: [timestamps], seen }
    calls = new Map(), // call_id → { sid, homeId, active, delivered, timer }
    ips = new Map(), // hashed ip → { calls, attempts, sessions: [timestamps] }
    pending = new Set(), // calls being created right now; they hold a concurrency slot during the await
    day = { key: "", count: 0 };
  const SESSION_TTL = 12 * HOUR;
  // Sliding-window counter over an array of timestamps.
  const recent = (list, windowMs) => {
    while (list.length && list[0] <= now() - windowMs) list.shift();
    return list.length;
  };
  const bounded = (map, max) => {
    while (map.size > max) map.delete(map.keys().next().value);
  };
  // Client address for rate limits. Never the left (client-written) end of X-Forwarded-For: by default the entry
  // `proxyHops` from the right, which the platform's proxy appended. Verify on Render with DEBUG_CLIENT_IP.
  function clientIp(req) {
    const socket = req.socket.remoteAddress || "?";
    if (ipSource === "socket") return socket;
    if (ipSource.startsWith("header:")) return String(req.headers[ipSource.slice(7)] || "").trim() || socket;
    const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    return xff.length >= proxyHops ? xff[xff.length - proxyHops] : socket;
  }
  // Limits are keyed by a keyed hash, so raw addresses are not kept in memory.
  const ipState = (req) => {
    const key = hmac("ip:" + clientIp(req)).slice(0, 22);
    let s = ips.get(key);
    if (!s) ips.set(key, (s = { calls: [], attempts: [], sessions: [] }));
    bounded(ips, 20_000);
    return s;
  };
  const activeCalls = () => [...calls.values(), ...pending].filter((c) => c.active);
  const finish = (rec) => {
    rec.active = false;
    clearTimeout(rec.timer);
  };

  // Bearer token "<id>.<expiry ms>.<hmac>": signed, so it stays valid across a restart (state is recreated empty).
  function newToken() {
    const id = crypto.randomBytes(16).toString("base64url"),
      exp = now() + SESSION_TTL;
    return { token: `${id}.${exp}.${hmac(id + "." + exp)}`, expiresAt: exp };
  }
  function sessionOf(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{22})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization || ""));
    if (!m || Number(m[2]) < now()) return null;
    const mac = Buffer.from(hmac(m[1] + "." + m[2])),
      given = Buffer.from(m[3]);
    if (mac.length !== given.length || !crypto.timingSafeEqual(mac, given)) return null;
    let s = sessions.get(m[1]);
    sessions.delete(m[1]); // re-insert: Map order doubles as least-recently-used eviction
    sessions.set(m[1], (s ||= { events: [], seq: 0, calls: [], seen: 0 }));
    s.seen = now();
    bounded(sessions, 10_000);
    return { sid: m[1], s };
  }

  function onWebhook(req, res) {
    const end = (code) => res.writeHead(code).end();
    readBody(req, res, MAX_BODY, (raw) => {
      if (!apiKey || !verify(raw, apiKey, req.headers["x-retell-signature"])) {
        log("webhook: rejected (bad or stale signature)");
        return end(401);
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return end(400);
      }
      const call = body?.call || {},
        rec = calls.get(String(call.call_id || ""));
      // 204 for everything verified, so Retell does not retry events we deliberately ignore.
      if (agentId && call.agent_id !== agentId) {
        log("webhook: ignored call from another agent");
        return end(204);
      }
      if (!rec) {
        log("webhook: ignored call not created by this server instance");
        return end(204);
      }
      if (body.event === "call_ended" || body.event === "call_analyzed") finish(rec);
      if (body.event !== "call_analyzed" || rec.delivered) return end(204);
      rec.delivered = true;
      const owner = sessions.get(rec.sid);
      if (!owner) {
        log(`webhook: ${call.call_id} analyzed after its visitor session was evicted; dropped`);
        return end(204);
      }
      owner.events.push({ seq: ++owner.seq, event: sanitize(call, rec.homeId) });
      if (owner.events.length > 50) owner.events.shift();
      log(`webhook: queued web_call ${call.call_id} for home ${rec.homeId} (awaiting that visitor's operator Confirm)`);
      end(204);
    });
  }

  function limitRefusal(sid, s, ip) {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (day.key !== today) Object.assign(day, { key: today, count: 0 });
    const active = activeCalls();
    return active.some((c) => c.sid === sid) ? "You already have a call in progress."
      : active.length >= maxConcurrent ? "All call lines are busy. Try again in a few minutes."
      : recent(s.calls, HOUR) >= sessionPerHour ? `Limit reached: ${sessionPerHour} calls per hour in this browser tab.`
      : recent(ip.calls, HOUR) >= ipPerHour ? `Limit reached: ${ipPerHour} calls per hour from this network.`
      : day.count >= maxPerDay ? "Today's demo call budget is used up. The mock buttons still work."
      : "";
  }
  function turnstileRefusal(r) {
    if (!r?.success) return "failed: " + [].concat(r?.["error-codes"] || []).join(",");
    if (r.metadata?.result_with_testing_key) return allowTestKeys ? "" : "test-key result in production";
    if (!turnstileHostnames.includes(String(r.hostname).toLowerCase())) return "hostname " + r.hostname;
    if (r.action !== TURNSTILE_ACTION) return "action " + r.action;
    if (!(now() - Date.parse(r.challenge_ts) <= 300_000)) return "stale challenge";
    return "";
  }

  async function webCall(body, { sid, s }, ip, json) {
    const homeId = body.home_id,
      token = body.turnstile_token;
    if (!callsReady()) return json(503, { error: "Live calls are not available right now." });
    if (!Number.isInteger(homeId) || homeId < 1 || homeId > 100_000) return json(400, { error: "Select a home first." });
    if (typeof token !== "string" || !token || token.length > 2048) return json(400, { error: "Bot check missing. Please try again." });
    if (recent(ip.attempts, HOUR) >= ipPerHour * 5) return json(429, { error: "Too many attempts from this network. Try again later." });
    ip.attempts.push(now());
    let refusal = limitRefusal(sid, s, ip);
    if (refusal) return json(429, { error: refusal });
    try {
      refusal = turnstileRefusal(await verifyTurnstile(token));
    } catch (error) {
      log("turnstile: verify unavailable: " + error.message);
      return json(503, { error: "Bot check unavailable. Please try again." });
    }
    if (refusal) {
      log("turnstile: rejected (" + refusal + ")");
      return json(403, { error: "Bot check failed. Please reload the page and try again." });
    }
    // Re-check after the await (others may have taken the last slot), then reserve synchronously.
    refusal = limitRefusal(sid, s, ip);
    if (refusal) return json(429, { error: refusal });
    s.calls.push(now());
    ip.calls.push(now());
    day.count++;
    const rec = { sid, homeId, active: true, delivered: false };
    pending.add(rec);
    let out;
    try {
      out = await api.createWebCall({
        agent_id: agentId,
        // No visitor identifiers go to Retell; the call→session mapping stays in this process.
        metadata: { home_id: homeId, load_id: LOAD, source: "powerup-demo" },
        retell_llm_dynamic_variables: { home_id: String(homeId), load_id: LOAD },
      });
    } catch (error) {
      log("web-call: create failed: " + error.message);
      return json(502, { error: "Could not start the call. Please try again later." });
    } finally {
      pending.delete(rec);
    }
    if (!out?.call_id || !out?.access_token) {
      log("web-call: create returned no call_id/access_token");
      return json(502, { error: "Could not start the call. Please try again later." });
    }
    // Hard duration cap enforced here, in addition to the agent's own max call duration in Retell.
    rec.timer = setTimeout(() => {
      if (!rec.active) return;
      finish(rec);
      log(`web-call: ${out.call_id} reached ${maxCallSeconds}s; stopping`);
      api.stopCall(out.call_id).catch((e) => log("web-call: stop failed: " + e.message));
    }, maxCallSeconds * 1000);
    rec.timer.unref?.();
    calls.set(out.call_id, rec);
    bounded(calls, 5000);
    log(`web-call: created ${out.call_id} for home ${homeId} (${day.count}/${maxPerDay} today on this instance)`);
    // Only what the browser SDK needs to join this one call.
    json(200, {
      call_id: out.call_id,
      access_token: out.access_token,
      ...(out.transport && { transport: out.transport }),
      ...(out.url && { url: out.url }),
      ...(out.ice_servers && { ice_servers: out.ice_servers }),
      max_seconds: maxCallSeconds,
    });
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin,
      allowed = allowedOrigins.includes(origin),
      headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        Vary: "Origin",
        // No credentials: the session travels in the Authorization header, never in (third-party) cookies.
        ...(allowed && { "Access-Control-Allow-Origin": origin }),
      };
    const json = (code, obj) => res.writeHead(code, { ...headers, "Content-Type": "application/json" }).end(JSON.stringify(obj));
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/retell/webhook")
      return req.method === "POST" ? onWebhook(req, res) : json(405, { error: "Method not allowed" });
    if (url.pathname === "/retell/health") return json(200, { ok: true });
    if (!url.pathname.startsWith("/retell/")) return json(404, { error: "PoweruP Retell backend: API only." });
    // Everything below is for the PoweruP page. Origin is a browser control only; non-browser callers still face
    // Turnstile and every limit.
    if (!allowed) return json(403, { error: "Origin not allowed." });
    if (req.method === "OPTIONS")
      return res
        .writeHead(204, {
          ...headers,
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
        })
        .end();
    if (url.pathname === "/retell/config" && req.method === "GET")
      return json(200, {
        live: callsReady(),
        maxSeconds: maxCallSeconds,
        ...(callsReady() ? { turnstileSiteKey } : { reason: enabled ? "the voice service is not fully configured" : "live calls are switched off" }),
      });
    if (req.method === "POST" && !/^application\/json\b/.test(String(req.headers["content-type"] || "")))
      return json(415, { error: "JSON required." });
    const ip = ipState(req);
    if (url.pathname === "/retell/session" && req.method === "POST") {
      if (debugIp)
        log(`client-ip debug: socket=${req.socket.remoteAddress} xff=${req.headers["x-forwarded-for"] || "-"} ` +
          `true-client-ip=${req.headers["true-client-ip"] || "-"} cf-connecting-ip=${req.headers["cf-connecting-ip"] || "-"} chosen=${clientIp(req)}`);
      if (recent(ip.sessions, HOUR) >= sessionsPerIpHour) return json(429, { error: "Too many new sessions from this network." });
      ip.sessions.push(now());
      return readBody(req, res, MAX_BROWSER_BODY, () => json(200, newToken()));
    }
    const session = sessionOf(req);
    if (!session) return json(401, { error: "session" });
    if (url.pathname === "/retell/events" && req.method === "GET") {
      const after = Number(url.searchParams.get("after")) || 0;
      return json(200, { events: session.s.events.filter((e) => e.seq > after) });
    }
    if (url.pathname === "/retell/web-call" && req.method === "POST")
      return readBody(req, res, MAX_BROWSER_BODY, (raw) => {
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(400, { error: "Bad JSON." });
        }
        webCall(body && typeof body === "object" ? body : {}, session, ip, json).catch((e) => {
          log("web-call: " + e.message);
          if (!res.headersSent) json(500, { error: "Unexpected error." });
        });
      });
    json(404, { error: "Not found" });
  });
  const close = () => {
    for (const c of calls.values()) clearTimeout(c.timer);
    return new Promise((r) => server.close(r));
  };
  return { server, sessions, calls, close, callsReady };
}

if (require.main === module) {
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile)) {
    if (typeof process.loadEnvFile !== "function") {
      console.error("Node 20.12+ is required for .env loading (found " + process.version + ").");
      process.exit(1);
    }
    process.loadEnvFile(envFile);
  }
  if (process.env.PORT) {
    const c = configFromEnv(),
      h = createHostedServer(c),
      port = Number(process.env.PORT);
    h.server.listen(port, "0.0.0.0", () => {
      console.log(`PoweruP Retell backend (API only) on 0.0.0.0:${port}; allowed origins: ${c.allowedOrigins.join(", ") || "none"}`);
      console.log(`Live calls: ${h.callsReady() ? "ENABLED" : "disabled"}; limits ${c.maxCallSeconds}s/call, ${c.maxConcurrent} concurrent, ` +
        `${c.maxPerDay}/day, ${c.sessionPerHour}/h per tab, ${c.ipPerHour}/h per IP (in memory: reset on restart)`);
    });
  } else {
    const appPort = Number(process.env.APP_PORT || 8014),
      webhookPort = Number(process.env.WEBHOOK_PORT || 8015);
    let s;
    try {
      s = createServers({ apiKey: process.env.RETELL_API_KEY, agentId: process.env.RETELL_AGENT_ID });
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
    for (const [server, port, name] of [
      [s.app, appPort, "APP_PORT"],
      [s.webhook, webhookPort, "WEBHOOK_PORT"],
    ])
      server.on("error", (e) => {
        console.error(
          e.code === "EADDRINUSE"
            ? `Port ${port} is already in use. Find it with: lsof -nP -iTCP:${port} -sTCP:LISTEN  (stop that process, or set ${name} in .env)`
            : e.message,
        );
        process.exit(1);
      });
    s.app.listen(appPort, "127.0.0.1", () =>
      s.webhook.listen(webhookPort, "127.0.0.1", () => {
        console.log(`PoweruP UI (local only):  http://127.0.0.1:${appPort}/planner.html?demo=1&map=0&retell=live`);
        console.log(`Webhook (tunnel only this): http://127.0.0.1:${webhookPort}/retell/webhook`);
        console.log(`Agent post-call fields:   ${Object.values(FIELDS).join(", ")}; dynamic vars home_id, load_id=${LOAD}`);
        console.log(process.env.RETELL_AGENT_ID ? "Accepting agent " + process.env.RETELL_AGENT_ID : "RETELL_AGENT_ID not set: accepting any agent on this key");
      }),
    );
  }
}

module.exports = {
  sign,
  verify,
  sanitize,
  createServers,
  createHostedServer,
  configFromEnv,
  retellApi,
  turnstileVerifier,
  normalizeOrigin,
  TURNSTILE_ACTION,
};
