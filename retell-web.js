/* PoweruP × Retell AI — "Talk to AI" browser voice call. Frontend on GitHub Pages; backend on Render
   (retell-server.js hosted mode, see DEPLOY-RENDER.md), whose URL is in planner.html's
   <meta name="powerup-retell-backend">. Without a reachable backend the panel says so (the mock stays available in developer mode).
   Each call: microphone check → Cloudflare Turnstile (invisible) → the backend checks the token and its limits and
   creates the web call → the browser joins with a short-lived access token for that call. The Retell API key never
   reaches the browser. Browser microphone calls only, never phone calls. Sessions are anonymous bearer tokens kept
   in sessionStorage (per tab), not cookies, so they work across github.io → onrender.com.
   The call's result arrives as a pending response in the Retell panel (retell-mock.js), pinned to the home selected
   when the call started, and changes nothing until the operator confirms.
   SDK: retell-client-js-sdk 3.0.2, legacy RetellWebClient.startCall({ accessToken }). Deprecated in 3.x and
   removed in 4.0, so the exact version is pinned; the newer RetellClient would need a key in the browser. */
(function () {
  "use strict";
  if (typeof document === "undefined" || !globalThis.PowerupRetell?.expect) return;
  const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname),
    params = new URLSearchParams(location.search),
    // Overrides for local development only; on the public site the backend and SDK are fixed.
    backendRaw = (LOCAL && params.get("retellBackend")) || document.querySelector('meta[name="powerup-retell-backend"]')?.content || "",
    BACKEND = /^https:\/\/[^/]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(backendRaw.replace(/\/+$/, "")) ? backendRaw.replace(/\/+$/, "") : "",
    SDK_URL = LOCAL && params.get("retellSdk")
      ? new URL(params.get("retellSdk"), location.href).href
      : "https://cdn.jsdelivr.net/npm/retell-client-js-sdk@3.0.2/+esm",
    TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    TOKEN_KEY = "powerup-retell-session",
    R = PowerupRetell;

  const box = document.createElement("div");
  box.id = "retellLive";
  box.className = "load retell-panel";
  box.innerHTML =
    '<div id="retellLiveBody" class="retell-panel"></div><div id="retellTurnstile"></div>' +
    '<p class="retell-text retell-fine">Talk to AI is a browser voice call with Retell AI: your microphone audio is processed by Retell to run the conversation. ' +
    "Please do not share personal information. Bot protection by Cloudflare Turnstile " +
    '(<a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener">privacy</a>).</p>';
  (document.getElementById("retellMock") || document.getElementById("detail")).after(box);

  const state = { phase: "checking", message: "", config: null, client: null, timer: null, tick: null, ends: 0, home: "" },
    waiting = new Map(); // call_id → give-up time, while a result may still arrive
  let sdk = null,
    turnstileReady = null,
    widget = null,
    turnstileWait = null,
    token = null,
    after = 0,
    pollTimer = null;
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch {}

  const busy = () => state.phase === "connecting" || state.phase === "live";
  const target = () => homes.find((h) => h.id === selected) || homes[0];
  const homeLabel = () => (target() ? `${target().name} (home ${target().id})` : "no home loaded yet");
  const say = (message, phase = state.phase) => {
    Object.assign(state, { message, phase });
    draw();
  };

  // ---------- backend ----------
  async function session(renew) {
    if (token && !renew) return token;
    ({ token } = await api("/retell/session", { method: "POST", body: {} }, false));
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {}
    return token;
  }
  async function api(path, { method = "GET", body } = {}, auth = true) {
    for (let attempt = 0; ; attempt++) {
      const headers = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (auth) headers.Authorization = "Bearer " + (await session(attempt > 0));
      const res = await fetch(BACKEND + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && auth && attempt === 0) continue; // expired or foreign token: get a new session once
      if (!res.ok) throw Error(data.error || "HTTP " + res.status);
      return data;
    }
  }
  // Free hosting sleeps when idle; the first request can take up to about a minute while it wakes.
  async function init() {
    if (!BACKEND) return say("", "unconfigured");
    say("", "checking");
    const slow = setTimeout(() => state.phase === "checking" && say("", "waking"), 2500);
    try {
      const res = await fetch(BACKEND + "/retell/config", { cache: "no-store", signal: AbortSignal.timeout(90_000) });
      state.config = await res.json();
      if (typeof state.config?.live !== "boolean") throw Error("unexpected reply");
    } catch {
      state.config = null;
    }
    clearTimeout(slow);
    if (!state.config) return say("", "unreachable");
    if (!state.config.live) return say("", "off");
    loadTurnstile().catch(() => {}); // warm up both, so the click starts promptly
    loadSdk().catch(() => {});
    say("", "ready");
  }

  // ---------- Cloudflare Turnstile (invisible; a visible check appears only if Cloudflare insists) ----------
  function loadTurnstile() {
    return (turnstileReady ||= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TURNSTILE_URL;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => {
        turnstileReady = null;
        reject(Error("Could not load the bot check (Cloudflare Turnstile)."));
      };
      document.head.append(s);
    }).then(() => {
      widget = turnstile.render("#retellTurnstile", {
        sitekey: state.config.turnstileSiteKey,
        action: "talk_to_ai",
        execution: "execute",
        appearance: "interaction-only",
        callback: (t) => turnstileWait?.resolve(t),
        "error-callback": () => {
          turnstileWait?.reject(Error("Bot check failed. Please try again."));
          return true;
        },
      });
    }));
  }
  async function turnstileToken() {
    await loadTurnstile();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Bot check timed out. Please try again.")), 60_000);
      turnstileWait = {
        resolve: (t) => (clearTimeout(timeout), resolve(t)),
        reject: (e) => (clearTimeout(timeout), reject(e)),
      };
      turnstile.execute(widget);
    });
  }
  const resetTurnstile = () => {
    turnstileWait = null;
    if (widget !== null) turnstile.reset(widget); // tokens are single-use
  };

  const loadSdk = () =>
    (sdk ||= import(SDK_URL).catch((error) => {
      sdk = null;
      throw Error("Could not load the Retell browser SDK (" + error.message + ").");
    }));

  // ---------- UI ----------
  function draw() {
    const mins = state.config ? Math.round(state.config.maxSeconds / 60) : 2,
      mockNote = R.mockMode ? " The mock buttons above still work." : "";
    const notes = {
      unconfigured: "The voice backend is not connected on this copy of the site." + mockNote,
      checking: "Checking the voice service…",
      waking: "Waking up the voice service (free hosting can take up to a minute)…",
      unreachable: "The voice service is not reachable right now." + mockNote,
      off: `Voice calls are unavailable: ${safe(state.config?.reason || "switched off")}.` + mockNote,
    };
    let body;
    if (notes[state.phase])
      body = `<p class="retell-text">${notes[state.phase]}</p>` + (state.phase === "unreachable" ? '<div class="retell-actions"><button id="retellRetry">Try again</button></div>' : "");
    else if (busy())
      body =
        `<p class="retell-text">${state.phase === "connecting" ? safe(state.message || "Connecting…") : `<b>On the call</b> about ${safe(state.home)} · <span id="retellLiveTimer"></span> left`}</p>` +
        `<div class="retell-actions"><button id="retellHangup">End call</button></div>`;
    else
      body =
        `<p class="retell-text">Speak as the resident of <b id="retellLiveHome">${safe(homeLabel())}</b>. The AI asks whether you agree to reduce EV charging during the outage window.</p>` +
        `<p class="retell-text">Your browser asks for the microphone; calls end after ${mins} min. No login or phone number needed.</p>` +
        `<div class="retell-actions"><button id="retellTalk" class="primary">Talk to AI</button></div>` +
        (state.message ? `<p class="retell-text">${safe(state.message)}</p>` : "");
    $("retellLiveBody").innerHTML =
      `<div class="retell-head"><h3>Talk to AI</h3><span class="retell-tag">LIVE · Retell AI</span></div>${body}` +
      '<p class="retell-text">After the call, the answer appears above as a pending resident response. Nothing changes until you Confirm.</p>';
    if ($("retellRetry")) $("retellRetry").onclick = init;
    if ($("retellTalk")) $("retellTalk").onclick = start;
    if ($("retellHangup")) $("retellHangup").onclick = () => hangup("You ended the call.");
    countdown();
  }
  function countdown() {
    if (!$("retellLiveTimer")) return;
    const s = Math.max(0, Math.round((state.ends - Date.now()) / 1000));
    $("retellLiveTimer").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------- call ----------
  async function start() {
    if (busy() || state.phase !== "ready") return;
    const home = target();
    if (!home) return say("Load example homes first (Try example homes).");
    if (!navigator.mediaDevices?.getUserMedia) return say("This browser cannot use the microphone on this page.");
    state.home = `${home.name} (home ${home.id})`;
    say("Checking the microphone…", "connecting");
    try {
      // Microphone, SDK and bot check first, so a denied prompt or blocked script never uses a call from the budget.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => t.stop());
      say("Loading the voice SDK…");
      const { RetellWebClient } = await loadSdk();
      say("Checking you are not a bot…");
      const turnstileTokenValue = await turnstileToken();
      say("Starting the call…");
      let call;
      try {
        call = await api("/retell/web-call", { method: "POST", body: { home_id: home.id, turnstile_token: turnstileTokenValue } });
      } finally {
        resetTurnstile();
      }
      R.expect(call.call_id, home);
      waiting.set(call.call_id, Date.now() + (call.max_seconds + 600) * 1000);
      poll();
      log(`Retell web call ${call.call_id} started for ${home.name}; its answer will need operator confirmation.`);
      const client = (state.client = new RetellWebClient());
      client.on("call_started", () => {
        client.startAudioPlayback().catch(() => {});
        say("", "live");
      });
      client.on("call_ended", () => ended("Call ended."));
      client.on("error", (message) => hangup("Call error: " + message));
      state.ends = Date.now() + call.max_seconds * 1000;
      state.timer = setTimeout(() => hangup(`Time limit (${Math.round(call.max_seconds / 60)} min) reached.`), call.max_seconds * 1000);
      state.tick = setInterval(countdown, 1000);
      await client.startCall({
        accessToken: call.access_token,
        callId: call.call_id,
        ...(call.transport && { transport: call.transport }),
        ...(call.url && { url: call.url }),
        ...(call.ice_servers && { iceServers: call.ice_servers }),
      });
    } catch (error) {
      ended(error.name === "NotAllowedError" ? "Microphone permission was denied; no call was placed." : error.message);
    }
  }
  function ended(message) {
    const wasLive = state.phase === "live",
      client = state.client;
    clearTimeout(state.timer);
    clearInterval(state.tick);
    state.client = null;
    client?.removeAllListeners?.();
    say(message + (wasLive ? " Waiting for Retell's post-call analysis (usually under a minute)." : ""), "ready");
  }
  function hangup(message) {
    state.client?.stopCall();
    ended(message);
  }
  addEventListener("pagehide", () => state.client?.stopCall());

  // Results for this tab's session only, while a call's result is outstanding.
  async function poll() {
    clearTimeout(pollTimer);
    for (const [id, until] of waiting)
      if (Date.now() > until) {
        waiting.delete(id);
        if (!busy())
          say(`No result arrived for call ${id}. If the voice service restarted (free hosting), the result was lost; you can place another call.`);
      }
    if (!waiting.size) return;
    try {
      const { events } = await api("/retell/events?after=" + after);
      for (const item of events) {
        after = Math.max(after, item.seq);
        waiting.delete(String(item.event?.call?.call_id));
        R.receive(item.event, "WEB CALL");
      }
    } catch {}
    if (waiting.size) pollTimer = setTimeout(poll, 3000);
  }

  // ---------- discoverability: planner button and #talk-to-ai links ----------
  async function reveal() {
    document.querySelector('[data-view="operations"]')?.click();
    for (let i = 0; i < 20 && !homes.length; i++) await new Promise((r) => setTimeout(r, 250));
    if (!homes.length) $("tryExamples")?.click();
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    $("retellTalk")?.focus({ preventScroll: true });
  }
  if ($("talkToAi")) $("talkToAi").onclick = reveal;
  if (location.hash === "#talk-to-ai") setTimeout(reveal, 300);

  // Keep the "speak as" label on the selected home.
  const baseRender = render;
  render = function () {
    baseRender.apply(this, arguments);
    if (!busy() && $("retellLiveHome")) $("retellLiveHome").textContent = homeLabel();
  };

  draw();
  init();
})();
