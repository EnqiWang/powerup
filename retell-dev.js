/* Local development backend for "Talk to AI" with Retell STUBBED: no Retell account, no credits, no real calls.
   Runs retell-server.js hosted mode on 127.0.0.1 with Cloudflare's public Turnstile test keys and a fake
   create-web-call; about 6 s after each fake call it sends itself a signed call_analyzed webhook.
   Usage: npm run retell:dev   (and `npm start` for the site), then open the URL it prints.
   DEV_DECISION=agree|decline|unclear and DEV_HOURS=3 choose the fake resident's answer. */
"use strict";
const S = require("./retell-server.js");

const port = Number(process.env.DEV_BACKEND_PORT || 8016),
  site = process.env.DEV_SITE_ORIGIN || "http://127.0.0.1:8004",
  KEY = "dev-local-key-not-a-retell-key",
  decision = process.env.DEV_DECISION || "agree",
  hours = Number(process.env.DEV_HOURS || 3);
let n = 0;
const api = {
  async createWebCall(body) {
    const call_id = `dev_call_${Date.now()}_${++n}`;
    setTimeout(() => {
      const raw = JSON.stringify({
        event: "call_analyzed",
        call: {
          call_id,
          agent_id: body.agent_id,
          call_type: "web_call",
          metadata: body.metadata,
          call_analysis: {
            custom_analysis_data: { ev_outage_reduction_decision: decision, permitted_hours: hours, resident_confirmed_readback: true },
          },
        },
      });
      fetch(`http://127.0.0.1:${port}/retell/webhook`, { method: "POST", headers: { "x-retell-signature": S.sign(raw, KEY) }, body: raw })
        .then((r) => console.log(`dev: fake call_analyzed for ${call_id} → HTTP ${r.status}`))
        .catch((e) => console.error("dev: webhook failed", e.message));
    }, 6000);
    return { call_id, access_token: "dev-token-" + n, transport: "livekit" };
  },
  async stopCall(id) {
    console.log("dev: stop-call " + id);
  },
};
const h = S.createHostedServer({
  apiKey: KEY,
  agentId: "agent_dev_stub",
  allowedOrigins: [site, site.replace("127.0.0.1", "localhost")],
  turnstileSiteKey: "1x00000000000000000000BB", // Cloudflare test key: invisible, always passes
  turnstileSecret: "1x0000000000000000000000000000000AA",
  allowTestKeys: true,
  enabled: true,
  ipSource: "socket",
  api,
});
h.server.listen(port, "127.0.0.1", () => {
  console.log(`Dev backend (Retell stubbed): http://127.0.0.1:${port}`);
  console.log(`Open: ${site}/planner.html?demo=1&map=0&retellBackend=http://127.0.0.1:${port}&retellSdk=tests/fixtures/fake-retell-sdk.js#talk-to-ai`);
});
