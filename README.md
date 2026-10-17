# PoweruP: Malibu circuit replay

The home page now follows the supplied Malibu Replay reference: circuit map, hour-by-hour timeline, battery simulation and adjustable assumptions. Light is the default theme.

Start the local server with `npm start`, then open `http://localhost:8004/`. Use Play or the timeline to explore. Open **Public SCE circuit data** to inspect records fetched directly from SCE.

| URL | Purpose |
|---|---|
| `/` | Circuit replay using a saved scenario, plus separate public SCE API evidence |
| `/planner.html?demo=1&map=0` | Previous detailed planner with saved example data and offline outline map |
| `/planner.html` | Previous detailed planner with its existing data-source options |
| `/poster.html` | Redirects to the home page; no poster button |

The simulation is not live household telemetry or a utility dispatch system. Live SCE queries provide historical circuit evidence; they do not replace the saved simulation's assumptions. See [DATA_SOURCES.md](DATA_SOURCES.md) for endpoints, limitations, and the verified duplicate-file cleanup.

The launch scripts also open the new home page; its saved replay does not require an API response to run. Public SCE evidence and optional web fonts do require network access.

Tests use Node's built-in runner and need no install:

```bash
npm test
```

---

## The 3-minute demo script (Best Demo: working thing first)

Press **▶ Run demo**. Keys: **Space** = pause, **→** = next, **Esc** = stop.

A caption bar narrates each step, and a timeline strip shows the Bryson events. Each event is marked **REAL** with its source, and each Grace action is marked **INFERRED**.

| # | Step (s) | On screen | Say |
|---|---|---|---|
| 1 | Ordinary Tuesday · 6 PM (20) | *Ordinary Tuesday* tab + value card | "Normal day. The fleet sells SCE peak relief only from energy above each home's reserve. That's customer one." |
| 2 | Oct 9, 2:14 AM · **WATCH** (20) | Six circuits flagged, batteries reporting | "NWS first mentions Santa Ana winds. That's six days out. Grace flags Cuthbert, Galahad, Merlin, Maguire, Serra and Tuna: about 6,400 customers." |
| 3 | Oct 12 · **ASK** (22) | Resident alert (simulated) + Medical Baseline consent | "SCE warns the City. Grace texts residents and gets Medical Baseline consent to hold batteries at 100%. Nothing is actually sent." |
| 4 | Oct 13–14 · **FILL** (26) | Red vs green charging chart, charging order | "Red Flag Warning at 5 PM. Everyone charging at once would hit 18 kW on 8 kW of spare capacity. Grace staggers charging, Medical Baseline homes first, with export paused." |
| 5 | Oct 15, 4:41 PM · **HOLD** (24) | Human approval → outage clock → hours budget per home | "Bryson Fire starts and Malibu is dark by 5 PM. Each home islands with an hours budget: **48 h** instead of 28 h for a full battery with no plan." |
| 6 | Oct 16, 3 AM · network loss (24) | Classifier card + 69,746 out | "Four batteries go quiet, but each keeps its local rule. Grace sorts them: not talking, tripped, broken. By 7 AM SCE has 69,746 customers out." |
| 7 | **HAND OFF** (24) | Restoration surge vs staggered recharge + handoff list | "Restoration takes 8+ hours. Grace proposes a staggered recharge for the SCE shutoff officer to approve: no cold-start surge. Everything else is handed to a human, logged." |

**After the replay:**
- Switch **REGION** to run the same engine on another region.
- Open **Pilot & Funding** in the left rail.

**If something breaks on stage:** press → (each step sets up what it needs), or reload `/?demo=1&map=0`.

---

## Metrics bar (always visible)

Bryson base case: 6 representative homes, 48 h horizon, 24 h fill window, 8 kW spare headroom.

| Metric | Value | Badge | Built from |
|---|---|---|---|
| Hours of backup | **48 h** with budget vs **28 h** full battery, no plan | MIXED | real SCE ZIP 90265 load (1.28 kW avg, June 2024) + Base Core 39.2 kWh; assumed charge, load shares, consent |
| Homes kept on | **6 / 6** through 48 h vs 0 without a plan; during the outage it counts only verified batteries | MIXED | same |
| Medical Baseline homes protected | **2 / 2** | ASSUMED | which homes are enrolled is assumed |
| Peak headroom freed | **10 kW** (18 → 8 kW) | ASSUMED | 3 kW charge power and 8 kW headroom are assumptions |
| Ordinary-day value | **$9.06 per 2 h peak event** (6 homes) | ASSUMED | assumed $0.15 buy / $0.40 sell |

> Note: your brief expected a baseline of about 36 h. The model computes 28 h: 39.2 kWh × 90% ÷ 1.28 kW (Malibu's real June-2024 average). We kept the computed number.

---

## The three twists

| Twist | Where | Proof |
|---|---|---|
| **1 · Funding** | **Pilot & Funding** rail tab, driven by `config/funding.json`. DOE SBIR/STTR is primary; DoD SBIR (AFWERX / Army, base housing) is the alternative. Each phase maps to a metric the app computes (Phase I = 500-home SCE pilot → homes kept on and backup hours). | Values recompute live from the current fleet and region |
| **2 · Global** | `config/regions/*.json`: hazard feed, shutoff rules, critical loads, units, currency, fleet. The **REGION** picker replays the same engine for LA wildfire (default), Australian bushfire (BoM fire-danger ratings), a Japan typhoon, and community-battery mode (clinics and cell towers). Non-LA data is **SYNTHETIC**. | `tests/regions.test.js`; `engine.js` and `advanced.js` are unchanged |
| **3 · Poster** | `poster.html`: 24×36 in portrait, computed from the app's data. Export PNG (in-browser, no library) or PDF (print, page size preset). | Exported files are in `poster/` |

### Poster export

- Already exported: `poster/powerup-poster-24x36.pdf` (one 24×36 in page) and `poster/powerup-poster-24x36.png` (2304×3456).
- Team names live in `config/poster.json`. **Replace the placeholders**, then re-export with either option:
  - in the browser: open `/poster.html` and click **Export PNG** or **Export PDF**.
  - headless, with the server running:

```bash
chrome --headless=new --virtual-time-budget=15000 --no-pdf-header-footer --print-to-pdf=poster/powerup-poster-24x36.pdf "http://localhost:8004/poster.html?print=1"
```

```bash
chrome --headless=new --hide-scrollbars --virtual-time-budget=15000 --window-size=2304,3456 --screenshot=poster/powerup-poster-24x36.png "http://localhost:8004/poster.html?print=1"
```

---

## Layout

| Path | Role |
|---|---|
| `engine.js`, `advanced.js` | Planning engine: budgets, staggered prep, outage replay, relief, `classifySilent` |
| `demo-model.js` | Pure helpers: offline snapshot router, headline metrics, scenario/region loaders and validators, fleet builder, recharge model, `runScenario` |
| `demo.js`, `demo.css` | Metrics bar, region picker, Run-demo replay, timeline strip, Pilot & Funding, decision-trail export |
| `scenarios/bryson_malibu_2026.json` | Hero scenario: events with sources, circuits, fleet, demo captions |
| `config/regions/`, `config/funding.json`, `config/poster.json` | Twist configs |
| `data/twists.json` | Critical loads + extra twists (harbor night, heat wave, spoofed telemetry, cell outage) |
| `data/snapshots/` | Bundled real data, each with `source` and `fetchedAt` |
| `poster.html`, `assets/qr-demo.svg` | Poster and a static QR code for the demo URL |
| `tests/` | Engine, classifier, demo mode, scenario loader, region config |

## Honesty rules

- Base Core capacity is **39.2 kWh**. Power (3 kW) is an **assumption**.
- SCE data is ZIP-level monthly averages, not household telemetry.
- Bryson event facts are from public reports (sources on every event). Grace's actions are **INFERRED**.
- No real Base customers, no messages sent, no device or port control. Non-LA regions are **SYNTHETIC**.
