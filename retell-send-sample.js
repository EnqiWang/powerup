/* Sends one signed, dummy call_analyzed webhook to the LOCAL retell-server.js. No Retell account traffic.
   Usage: node retell-send-sample.js <agree|decline|unclear> <hours> <home_id> [--no-readback] [--bad-signature] */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { FIELDS, LOAD } = require("./retell-mock.js"),
  { sign } = require("./retell-server.js");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const key = process.env.RETELL_API_KEY,
  port = Number(process.env.WEBHOOK_PORT || 8015),
  [decision = "agree", hours = "4", homeId = "1"] = process.argv.slice(2).filter((a) => !a.startsWith("--")),
  flags = process.argv.slice(2);
if (!key) {
  console.error("RETELL_API_KEY missing in .env (a dummy value is fine for local tests).");
  process.exit(1);
}
// Shaped like a real Retell payload, including fields the server must strip before the browser sees them.
const raw = JSON.stringify({
  event: "call_analyzed",
  call: {
    call_type: "web_call",
    call_id: "local-sample-" + Date.now(),
    agent_id: process.env.RETELL_AGENT_ID || "agent_local_sample",
    retell_llm_dynamic_variables: { home_id: String(homeId), load_id: LOAD, resident_name: "Test Resident" },
    transcript: "Agent: ... User: ... (dummy transcript, must not reach the browser)",
    from_number: "+15555550100",
    call_analysis: {
      call_summary: "dummy",
      custom_analysis_data: {
        [FIELDS.decision]: decision,
        [FIELDS.hours]: Number(hours),
        [FIELDS.readback]: !flags.includes("--no-readback"),
      },
    },
  },
});
const signature = flags.includes("--bad-signature") ? sign(raw, "wrong-key") : sign(raw, key);
fetch(`http://127.0.0.1:${port}/retell/webhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-retell-signature": signature },
  body: raw,
})
  .then((r) => console.log(`HTTP ${r.status}${r.status === 204 ? " accepted" : " rejected"}`))
  .catch((e) => console.error("Could not reach the local webhook port:", e.message));
