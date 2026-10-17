# PoweruP — fleet command for home batteries, before and during a shutoff

**Ordinary Tuesday:** a fleet of Base Core home batteries sells peak relief.
**Fire-weather shutoff:** the same fleet prepares early, stays inside the feeder's limit, budgets each home for 72 hours, and hands what it can't cover to a human operator.

Static web app (HTML/CSS/JS). No build step and no runtime dependencies. Every number on screen is labeled **REAL**, **ASSUMED** or **MIXED**.

---

## Run it in 30 seconds

The app is served from the repo root (also the GitHub Pages root). Python 3 is the only requirement.

| OS | Command |
|---|---|
| Windows | double-click `start-windows.bat` |
| macOS / Linux | `./start-mac.sh` |

Either script serves the folder at `http://localhost:8004` and opens **`/?demo=1`**. Then press **▶ Run demo**.

| URL | What it does |
|---|---|
| `/?demo=1` | **Offline demo mode.** Every `/api/*` call is answered from `data/snapshots/` (SCE, NWS, Census ZCTA, OPSD). No waiting on the network. |
| `/?demo=1&map=0` | Same, and the street basemap is never requested. Shows the SVG Census-outline map. Use this at a venue with bad Wi-Fi. |
| `/?demo=1&autoplay` | Starts the narrated timeline on load. |
| `/` | Live mode: browser-direct public APIs (ORNL/SCE, NWS, Census TIGERweb). |

Tests use only Node's built-in runner, with no install step:

```bash
npm test
```

---

## The 3-minute demo script

Press **▶ Run demo**. A caption bar narrates each step and moves on automatically. Controls: **Space** = pause, **→** = next, **Esc** = stop.

| # | Step (~s) | On screen | Say |
|---|---|---|---|
| 1 | Ordinary Tuesday (22) | *Ordinary Tuesday* tab; metrics bar **Ordinary-day value** | "Six real LA ZIPs, June-2024 SCE usage. On a normal day the fleet exports only the energy above each home's protected reserve." |
| 2 | DR dispatcher (22) | *Neighborhood shield* | "Second customer: a utility demand-response dispatcher. Accepted load deferrals come first, battery energy above reserve second, and the rest is handed back. No blanket shutdowns." |
| 3 | Fire-weather warning (22) | Resident alerts + **REAL NWS snapshot** card | "The warning is our scenario. The NWS card is real data. Residents get a reviewed Prepare-now alert. The outbox is simulated." |
| 4 | Staggered vs 4 PM (26) | Red vs green headroom chart | "If everyone plugs in at 4 PM, demand hits 18 kW against 8 kW of spare feeder capacity. PoweruP staggers charging over 18 h, most at-risk homes first. That frees **10 kW**." |
| 5 | Dispatcher approves (18) | Approval dialog | "A human approves. Essential loads are never reduced. Only loads residents accepted can be." |
| 6 | Outage 0→9 h (24) | *Outage budget*, clock ticking | "6 PM, power's out. Each home gets a grace-period budget: the kW it can draw so essentials last 72 h." |
| 7 | 3 AM connection loss (26) | Classifier card | "Four batteries go quiet. They keep running their local plan. We sort them: **not talking**, **tripped**, **broken**, and stop counting them as verified capacity." |
| 8 | Operator handoff (22) | Handoff table + **⇩ Export decision trail** | "What the fleet can't cover goes to a human, logged: silent batteries, home shortfalls, and critical loads with zero grace." |

**Then show adaptability.** Toggle a twist chip: *Harbor night shift*, *Heat wave*, *Spoofed telemetry* or *Cell outage*. The metrics bar recomputes. Click **⇩ trail** to download that twist's decision trail as JSON.

**If something goes wrong on stage:** press → to skip a step. Each step sets up what it needs, so you can jump ahead. Reload `/?demo=1&map=0` for a fully offline view.

---

## Headline metrics bar (always visible)

Demo base case: 6 homes, 72 h horizon, 18 h lead time, 8 kW feeder headroom.

| Metric | Demo value | Badge | Built from |
|---|---|---|---|
| Hours of backup | **72 h** vs 26 h unmanaged (avg per home) | MIXED | real SCE load + Base Core 39.2 kWh; assumed 30% starting charge, load shares, consent |
| Households kept powered | **6 / 6** through 72 h vs 0 unmanaged; live during outage (verified batteries only) | MIXED | same |
| Essential-load hours preserved | **+276 home-hours** | ASSUMED | essential share = 30% of mean load (assumed) |
| Peak headroom freed | **10 kW** (18 kW 4 PM rush → 8 kW staggered) | ASSUMED | 3 kW charge power and 8 kW headroom are assumptions |
| Ordinary-day value | **$4.55 per 2 h peak event** (fleet of 6) | ASSUMED | assumed $0.15 buy / $0.40 sell, resident opt-in |

During an outage the planning numbers freeze at outage start. "Households kept powered" then counts only batteries that are still verified and not short.

---

## Twists are config, not code

`data/twists.json` is the single source for:

- the base case (horizon, lead time, headroom, prices),
- **critical loads**: cold storage, cell site, and a **Port of Long Beach entry labeled ASSUMED** (scaled illustrative load; no port data, no control or protection claimed),
- **twists**: harbor night, heat wave, spoofed telemetry, cell outage,
- the narrated demo script and the 3 AM silent-battery evidence.

To add a twist, append an entry that uses the existing effect types (`cfg`, `shield`, `loadScale`, `criticalLoads`, `silent`, `spoof`). The UI toggle and the per-twist decision-trail export appear automatically.

```json
{ "id": "wind-event", "name": "Wind event", "summary": "...", "provenance": "ASSUMED",
  "effects": { "cfg": { "duration": 96 }, "criticalLoads": { "cell": { "graceHours": 0 } } } }
```

---

## Layout

| File | Role |
|---|---|
| `engine.js`, `advanced.js` | Planning model: budgets, staggered prep, outage replay, relief, diagnosis, **`classifySilent`** |
| `demo-model.js` | Pure helpers: `?demo=1` snapshot router, headline metrics, 4 PM rush curve, twist effects |
| `demo.js` | Metrics bar, twist chips, Run-demo timeline, decision-trail export |
| `app.js`, `experience.js`, `sce.js`, `scene.js`, `notifications.js`, `visual.js` | Existing UI. `scene.js` now draws an SVG Census-outline fallback when map tiles fail |
| `static-api.js` | Live browser-direct public APIs (unchanged) |
| `data/snapshots/` | Bundled real data, each with `source` and `fetchedAt` |
| `tests/` | `node --test`: engine invariants, demo-mode routing, classifier, config integrity |

## Honesty rules the code keeps

- Battery capacity is the Base Core **39.2 kWh**. Charge and export power (3 kW) are **assumptions**.
- SCE data is **ZIP-level monthly averages**, not household telemetry. OPSD households are measured in **Germany**, not LA.
- No real customers. No messages are sent. No device commands. No port or critical-facility control.
- When the fleet can't cover a load, the app hands it to an operator. It never invents capacity.
