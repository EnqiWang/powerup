# PoweruP — Devpost submission

**Track:** Energy, with Base Power · **Dual-Use Hackathon**

## Problem

Public Safety Power Shutoffs and fire-weather outages hit Los Angeles neighborhoods with a few hours' warning. Home batteries help, but three things work against them today:

1. **Everyone charges at once.** Every home tops up at 4 PM, on the same feeder the utility is trying to protect.
2. **Batteries run flat early.** Without a budget, a battery runs the AC until it's empty at hour 26. Essential loads (fridge, medical device, lights) needed to last 72 h.
3. **Silence looks like capacity.** When a battery stops reporting at 3 AM, operators can't tell "comms down but running" from "tripped" or "broken", so they count capacity that may not exist.

## Dual use: one fleet, two jobs

| Ordinary Tuesday | Fire-weather shutoff |
|---|---|
| Fleet sells energy above each home's protected reserve during the evening peak | Same fleet prepares early, staggered inside the feeder's spare capacity |
| A utility DR dispatcher is the second customer: accepted load deferrals first, battery energy above reserve second | Dispatcher approves a 72 h grace-period budget per home |
| Earns ordinary-day value | Keeps essential loads on, classifies silent batteries, hands shortfalls to a human operator |

The same software, data model and consent records run on both days. Resilience isn't a separate product that sits idle until disaster.

## How it works

1. **Load:** six real LA ZIPs (SCE monthly residential averages via ORNL), each modeled as a representative Base Core home (39.2 kWh).
2. **Alert:** the NWS forecast and alerts feed sets context. Residents get a reviewed alert (simulated outbox).
3. **Prepare:** a 15-minute scheduler shares feeder headroom. The most at-risk homes charge first, and the plan never exceeds the limit.
4. **Approve:** a human dispatcher approves. Only loads residents accepted can be reduced. Essential loads are never touched.
5. **Outage:** each home follows a grace-period budget (kW it may draw so essentials last the horizon). Batteries keep the local plan if comms drop.
6. **Classify:** `classifySilent` sorts silent batteries into *not talking*, *tripped*, *broken*, *untrusted* or *unknown*. Only talking batteries count as verified capacity.
7. **Handoff:** shortfalls, silent batteries and zero-grace critical loads (cold storage, cell site, port load *[ASSUMED]*) go to an operator. Every decision exports as a JSON trail.

**Adapting to twists:** each twist (harbor night shift, heat wave, spoofed telemetry, cell outage) is one entry in `data/twists.json`. The UI toggle, the metrics recompute and the per-twist decision-trail export come from that entry with no new code.

## Real vs assumed

| REAL | ASSUMED |
|---|---|
| SCE June-2024 residential ZIP averages (ORNL OpenEnergy Hub) | 30% starting state of charge |
| NWS hourly forecast + active alerts (snapshot fetched 2026-10-17 UTC; it contained a real *Heat Advisory*) | 3 kW charge/export power |
| U.S. Census 2020 ZCTA boundaries (TIGERweb) | Load shares (essential 30%, cooling 45%, flexible 25%) |
| OPSD measured household loads (Konstanz, DE: real, but not LA) | Resident consent and grid participation |
| Base Core capacity 39.2 kWh | Feeder headroom, prices, critical-load kW and grace periods |
| | The fire-weather warning itself, the 3 AM evidence, and every twist |

Every metric in the app carries a REAL / ASSUMED / MIXED badge. Bundled snapshots keep their `source` and `fetchedAt`.

## Impact (demo model, 6 homes; assumptions above)

- **Backup:** 26 h → **72 h** average per home with the grace-period budget.
- **Households kept powered through 72 h:** 0 → **6 of 6**.
- **Essential-load hours preserved:** **+276 home-hours**.
- **Peak headroom freed:** **10 kW**. The 4 PM rush (18 kW) becomes 8 kW staggered, inside the feeder limit.
- **Ordinary-day value:** **$4.55 per 2 h peak event** for the 6-home fleet at assumed prices.
- Under the *cell outage* twist, 2 batteries go quiet and verified capacity drops honestly: 4 of 6 kept powered, 4 kW headroom freed.

These are model outputs from real load data plus labeled assumptions. They are not field results.

## Built with

Vanilla JavaScript, HTML and CSS · MapLibre GL + OpenFreeMap/OSM (optional basemap; SVG fallback offline) · Node built-in test runner · Python `http.server` (local serving only). Data: ORNL/SCE, NWS API, U.S. Census TIGERweb, Open Power System Data. No frameworks and no runtime dependencies.

## Built with IBM Bob

> **TODO (team): fill this in before submitting.** List only the files, functions or features IBM Bob actually generated or refactored, for example: `engine.js budget()`, `advanced.js diagnose()`, `notifications.js`. Do not list anything Bob did not build.

| Part | What IBM Bob did |
|---|---|
| _fill in_ | _fill in_ |

## Not claimed

No real customers or utility partners. No messages sent. No device or port control. No protected ports or critical facilities. Base Core power ratings are not used as specs. Charge power is an assumption.
