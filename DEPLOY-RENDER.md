# Talk to AI: Retell voice calls on the PoweruP site

Visitors to the existing GitHub Pages site (https://enqiwang.github.io/powerup/) click **Talk to AI**, allow the
microphone, and talk to a Retell AI agent in the browser as the resident of the selected home. After the call the
resident's answer appears in the planner as a **pending** response with a before/after backup preview; nothing
changes until the operator clicks **Confirm** (or **Discard**). No login, access code, Retell account or phone number.

```
GitHub Pages (planner.html, retell-web.js) ──HTTPS + CORS──▶ Render: retell-server.js (API + webhooks only)
        │  browser voice (Retell SDK, per-call token)                 │  create-web-call / stop-call (API key)
        └──────────────────────────────────▶ Retell ◀─────────────────┘  ◀── signed call_analyzed webhook
```

## What protects the Retell credits

| Control | Where | Default |
| --- | --- | --- |
| Kill switch | `RETELL_ENABLED` must be exactly `true` | **off** |
| Bot check before **every** call | Cloudflare Turnstile (Invisible), verified server-side: success, hostname, action `talk_to_ai`, age ≤ 300 s; test-key results refused in production | on |
| Calls only created by the server | API key only on Render; browser gets a short-lived token for one call | — |
| Max call duration | server calls Retell `stop-call` at the limit; browser hangs up too | 120 s |
| Concurrent calls (all visitors) | server | 2 |
| Global daily calls | server, resets 00:00 UTC | 20 |
| Per browser tab (session) | server | 2 / hour, 1 at a time |
| Per IP | server (proxy-appended address, never the client-written part of `X-Forwarded-For`) | 4 / hour |
| New sessions per IP | server | 20 / hour |
| Fail closed | missing key, agent, origin list or Turnstile keys, or test Turnstile keys ⇒ calls off | — |

Theoretical maximum with the defaults: **20 calls × 2 min = 40 call-minutes per day per running instance**.

### Limitations you must know (Render Free)

- **All limits are in memory.** A restart, redeploy or Free-tier spin-down (after ~15 min without traffic) resets
  every counter, including the daily cap. So the in-memory limits are **not a hard spending cap**. Put a hard
  limit on the provider side as well: in Retell, keep prepaid credit low and turn off auto-recharge, and set any
  usage or spend limit, alert or concurrency limit your Retell plan offers. Set the agent's own **max call duration**.
- **Cold start:** the first visitor after a quiet period waits up to about a minute. The page shows
  "Waking up the voice service…" and pings the backend on load so it is usually awake by the time someone clicks.
- **Results can be lost on restart.** Call→visitor mappings live in memory; a webhook arriving after a restart is
  acknowledged and dropped. The page says so after 10 minutes without a result. Sessions themselves survive
  restarts (signed with `SESSION_SECRET`).
- **One instance only.** Do not scale to more than one instance; limits and mappings are per process.
- **Public callers can reach the API.** CORS and the `Origin` check only bind browsers. Non-browser callers still
  need a valid Turnstile token per call and hit every limit, but paid captcha-solving can defeat Turnstile, and
  per-session/per-IP limits can be spread across many sessions and IPs. The global daily cap and concurrency cap
  bound the cost per instance lifetime; if someone exhausts them, legitimate visitors are refused until the next
  UTC day (use the mock buttons, or raise the cap). Watch the Render logs during judging.
- **`ALLOWED_ORIGINS=https://enqiwang.github.io`** also admits other GitHub Pages projects under that account
  (same origin). Turnstile hostname checks have the same granularity.
- A visitor can extract their own call's access token and join that one call from another client; it is still a
  web call under the same duration cap.

## Step 1 — Cloudflare Turnstile (production keys)

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Hostnames: `enqiwang.github.io` (only this; local development uses Cloudflare's test keys).
3. Widget mode: **Invisible**. Pre-clearance: off.
4. Copy the **Site key** and **Secret key**. You will paste both into Render (Step 3). The site key is public; the
   page receives it from the backend, so nothing needs to change in the repository when keys rotate.

**Privacy notice.** Turnstile collects browser and device signals to detect bots. The Talk to AI panel already
shows a short notice with a link to Cloudflare's Turnstile privacy addendum, and says audio is processed by Retell.
If the team publishes a privacy policy, add: *"This site uses Cloudflare Turnstile to protect the voice demo from
abuse (https://www.cloudflare.com/turnstile-privacy-policy/), and Retell AI to process voice calls you start."*
This is not legal advice; check requirements for your audience (e.g. GDPR) before a public launch.

## Step 2 — Retell agent

1. Create (or reuse) a **web call** agent. Do not attach a phone number; this integration never makes phone calls.
2. **Post-call analysis** fields (exact names): `ev_outage_reduction_decision` (`agree` | `decline`),
   `permitted_hours` (number, 0.25–168), `resident_confirmed_readback` (boolean). The call receives
   `home_id` and `load_id=ev` as dynamic variables.
3. **Webhook URL:** `https://<your-service>.onrender.com/retell/webhook` (events: call ended and call analyzed).
4. **Max call duration:** 2 minutes (matches `MAX_CALL_SECONDS`), and end the call after a period of silence.
5. **Disclosure:** make the agent's first line say it is an AI and whether the demo call is recorded, for example
   "Hi, I'm an AI assistant for the PoweruP demo. This call may be recorded." California requires consent from
   everyone on the call before recording, so either announce the recording or use the agent's data-storage setting
   to keep less, as long as post-call analysis still reaches the webhook.
6. Credit protection as described above: low prepaid balance, no auto-recharge, plus any usage limits or alerts.
7. Use the API key with the **webhook** badge (it also verifies webhook signatures).

## Step 3 — Render (Free)

1. Push the PR branch to **your fork** and create a Render **Web Service** from it (or use **Blueprint** with
   `render.yaml`). Free instance type. Build command `npm install`, start command `node retell-server.js`, health
   check path `/retell/health`. Render sets `PORT`; the server binds `0.0.0.0:$PORT` and serves the API only.
2. Environment variables (Dashboard → Environment):

   | Variable | Value |
   | --- | --- |
   | `RETELL_ENABLED` | `false` for now (kill switch) |
   | `ALLOWED_ORIGINS` | `https://enqiwang.github.io` |
   | `RETELL_API_KEY` | Retell key with webhook badge (secret) |
   | `RETELL_AGENT_ID` | `agent_...` |
   | `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | from Step 1 (secret key is secret) |
   | `SESSION_SECRET` | long random value (`openssl rand -hex 32`; the Blueprint generates one) |
   | `MAX_CALL_SECONDS`, `MAX_CONCURRENT_CALLS`, `MAX_CALLS_PER_DAY`, `SESSION_CALLS_PER_HOUR`, `IP_CALLS_PER_HOUR` | `120`, `2`, `20`, `2`, `4` |
   | `CLIENT_IP_SOURCE`, `TRUST_PROXY_HOPS` | `xff`, `1` (verify in step 4) |

3. Deploy. Check `https://<service>.onrender.com/retell/health` → `{"ok":true}`. The log line
   `live calls DISABLED: RETELL_ENABLED is not "true"` is expected.
4. **Verify the client-IP setting before judging** (otherwise per-IP limits may lump visitors together or be
   spoofable): set `DEBUG_CLIENT_IP=true`, open the planner once from your own network, and read the
   `client-ip debug:` log line. `chosen=` must be **your public IP** (compare with any "what is my IP" page).
   If it is a Render/Cloudflare address, try `TRUST_PROXY_HOPS=2`, or `CLIENT_IP_SOURCE=header:true-client-ip`
   / `header:cf-connecting-ip` **only if** that header shows your IP and Render overwrites any value a client
   sends (test with `curl -H "True-Client-IP: 1.2.3.4" ...` and confirm `chosen` ignores it). Then remove
   `DEBUG_CLIENT_IP` (it logs IP addresses).
5. Set `RETELL_ENABLED=true` only when you are ready to spend credits.

**Emergency stop:** set `RETELL_ENABLED=false` (Render restarts the service in about a minute), or **Suspend** the
service in Render. Fastest provider-side stop: disable the agent or rotate the API key in Retell.

## Step 4 — Frontend (this PR, merged by the team)

1. In `planner.html`, set `<meta name="powerup-retell-backend" content="https://<your-service>.onrender.com" />`
   (HTTPS origin, no path). Empty means "voice backend not connected" and only the mock is offered.
2. Discoverability: **Talk to AI 🎙** in the planner's action bar, and a **Talk to AI 🎙** link on the replay home
   page (`index.html`) that opens `planner.html?demo=1&map=0#talk-to-ai`.
3. The browser SDK is `retell-client-js-sdk@3.0.2` from jsDelivr, using the **legacy `RetellWebClient`** with a
   server-created access token. It is deprecated in 3.x and removed in 4.0; the newer `RetellClient` would put a key
   in the browser. Keep the version pinned; before upgrading to 4.x, revisit this design.

## Local development (no Retell, no credits)

```bash
npm test                                   # unit + integration tests, Retell and Turnstile stubbed
python3 -m http.server 8004 --bind 127.0.0.1   # or: npm start
npm run retell:dev                         # stubbed backend on :8016, Cloudflare TEST keys, fake webhook
# open the URL it prints (planner with ?retellBackend=...&retellSdk=tests/fixtures/fake-retell-sdk.js)
```

`?retellBackend=` and `?retellSdk=` work only on `localhost`/`127.0.0.1`. To run hosted mode yourself against
real Retell, set the variables from `.env.example` plus `PORT`, and
`ALLOWED_ORIGINS=http://127.0.0.1:8004`. Turnstile test keys require `TURNSTILE_ALLOW_TEST_KEYS=true` and are refused
otherwise. The original local mode (`npm run retell`, two ports, `?retell=live`) is unchanged.
