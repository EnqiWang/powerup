# PoweruP: the forecast saw it coming 6 days before Malibu went dark

**Dual-Use Hackathon · Energy track with Base Power**

## Problem

On **Oct 9, 2026 at 2:14 AM**, the National Weather Service first mentioned possible Santa Ana winds. On **Oct 15 at 4:41 PM** the Bryson Fire started, and central and west Malibu were dark by 5 PM. Six circuits were de-energized: Cuthbert, Galahad, Merlin, Maguire, Serra and Tuna, about 6,400 customers on the five with a public count. By 7 AM the next day, **69,746 SCE customers** were out across LA and Ventura counties.

The warning came six days early. Home batteries could have used it, but today:

1. **Everyone charges at once.** On a Red Flag evening, every home tops up together, on the circuit the utility is trying to protect.
2. **Batteries run flat overnight.** A full Base Core at Malibu's real average load (1.28 kW) lasts about **28 h** with no plan.
3. **Silence looks like capacity.** At 3 AM, a battery that stops reporting could be "comms down but running", tripped, or broken.
4. **Restoration causes a surge.** When power returns, every empty battery recharges at once.

## Dual use: one fleet, two customers

| Ordinary Tuesday | Shutoff week |
|---|---|
| **SCE peak relief at 6 PM**, using only energy above each home's protected reserve | **WATCH → ASK → FILL → HOLD → HAND OFF**, driven by the same engine |
| A utility DR dispatcher buys relief from the same fleet | The SCE shutoff officer approves the staggered fill and the restoration recharge |

The resilience feature is paid for by the ordinary-day revenue, so it is never idle hardware waiting for a disaster.

## How it works (Grace, our planner)

| Phase | Trigger (REAL, sourced) | What Grace does (INFERRED) |
|---|---|---|
| WATCH | Oct 9 · NWS mentions Santa Ana winds | Flag high-risk circuits; check which batteries report in |
| ASK | Oct 12 · SCE tells the City of possible cuts | Text residents (simulated); get Medical Baseline consent to hold batteries at 100% |
| FILL | Oct 13–14 · Fire Weather Watch, then a 6-circuit list, Red Flag Warning and heat advisory | Stagger charging inside spare circuit capacity, Medical Baseline homes first; pause export |
| HOLD | Oct 15 · fire starts, power out | Homes island; each gets an hours budget so essential loads last the horizon |
| — | Oct 16, 3 AM · network loss (scenario) | Silent batteries keep their local rule; `classifySilent` labels them not talking / tripped / broken / untrusted, and only verified ones count |
| HAND OFF | After the winds · restoration takes 8+ h | Propose a staggered recharge for the SCE shutoff officer to approve; hand all shortfalls to a human, with a JSON decision trail |

The engine (`engine.js`, `advanced.js`) is a 15-minute scheduler with consent-aware budgets. Essential loads are never reduced, and only loads residents accepted can be.

## Twist responses

### Twist 1 · Funding
- **What changed:**
  - A **Pilot & Funding** tab, driven by `config/funding.json`.
  - Primary: **DOE SBIR/STTR** (reauthorized April 2026 through 2031), for grid resilience and distributed energy.
  - Alternative: **DoD SBIR (AFWERX or Army)**, for keeping base housing powered.
- **Why:** a pilot needs a funder whose milestones match what we can measure.
- **Proof it works:** every phase maps to a metric the app already computes, recomputed live from the current fleet:
  - Phase I is a 500-home SCE pilot: about 500 of 500 homes kept on through 48 h, and 48 h backup vs 28 h.
  - Phase II is 5,000 homes: about 8.3 MW of peak headroom freed, and Medical Baseline homes protected.
  - Phase III is utility contracts, measured by ordinary-day value.
  - All scale-ups are linear and labeled ASSUMED.

### Twist 2 · Global
- **What changed:**
  - Each region lives in `config/regions/*.json`: hazard feed, shutoff rules, critical loads, units and currency.
  - A **REGION** picker replays LA wildfire (default) plus three SYNTHETIC regions:
    - Australian bushfire, using Bureau of Meteorology fire-danger ratings
    - Japan typhoon
    - **community-battery mode** for clinics and cell towers, for places without home batteries
- **Why:** the hard part (budgets, staggering, triage, handoff) is the same everywhere. Only hazard, rules, loads and money differ.
- **Proof it works:**
  - `engine.js` and `advanced.js` were not modified.
  - `tests/regions.test.js` runs every region through the same `runScenario` and checks that all non-LA data is labeled SYNTHETIC.
  - Yen prices go through a config `engineScale` instead of an engine edit.

### Twist 3 · Poster
- **What changed:** `poster.html` is a 24×36 in portrait poster, generated from the app's own data at load time:
  - **Left:** the Bryson timeline with Grace's steps.
  - **Center:** the Census map of ZIP 90265 and three big numbers.
  - **Right:** the two customers, funding, and "one engine, any region".
  - **Bottom:** a QR code to the demo, plus team names.
- **Why:** the poster can't drift from the demo, because they compute from the same files.
- **Proof it works:**
  - `poster/powerup-poster-24x36.pdf` is a single 1728×2592 pt page (24×36 in).
  - `poster/powerup-poster-24x36.png` is 2304×3456.
  - The in-browser **Export PNG** uses SVG foreignObject, with no library.

## Impact (model output; Bryson case, 6 representative homes)

| | Without a plan | With PoweruP |
|---|---|---|
| Backup per home | 28 h (full battery) | **48 h** (hours budget) |
| Homes kept on through 48 h | 0 / 6 | **6 / 6** |
| Medical Baseline homes protected | — | **2 / 2** |
| Charging peak before shutoff | 18 kW | **8 kW** (10 kW freed) |
| Restoration peak | 25.7 kW surge | **15.7 kW** staggered |
| Ordinary-day value | — | **$9.06 per 2 h peak event** |

These are model outputs from real load data plus labeled assumptions. They are not field results.

## Real vs assumed

| REAL (sourced) | ASSUMED / INFERRED / SYNTHETIC |
|---|---|
| Bryson timeline: NWS, SCE, City of Malibu, Cal Fire public reports | Grace's actions (**INFERRED**) |
| Circuit customer counts (Tuna: no record) | One representative home per circuit; starting charge; Medical Baseline enrollment |
| SCE/ORNL ZIP 90265 residential average (June 2024) | 3 kW charge power; 8 kW spare headroom; 48 h horizon; prices; consent |
| NWS snapshot, Census 2020 ZCTA outlines, OPSD households (DE) | The 3 AM network loss and its evidence |
| Base Core capacity 39.2 kWh | All non-LA regions (**SYNTHETIC**) |

## Built with

- **App:** vanilla JavaScript, HTML and CSS.
- **Map:** MapLibre GL with OpenFreeMap/OSM tiles (optional), plus an SVG Census fallback for offline use.
- **Testing and serving:** Node's built-in test runner; Python `http.server` for local serving only.
- **Data:** NWS API, ORNL OpenEnergy Hub (SCE), U.S. Census TIGERweb, Open Power System Data.
- **Poster:** QR code pre-rendered to a static SVG.
- No frameworks and no runtime dependencies.

## Built with IBM Bob

> **TODO (team): fill in before submitting.** List only what IBM Bob actually generated or refactored, by file or function. Do not list anything Bob did not build.

| Part | What IBM Bob did |
|---|---|
| _fill in_ | _fill in_ |

## Not claimed

- No real Base customers or utility partners.
- No messages sent.
- No device or port control.
- No Base power-rating spec (the 3 kW charge power is an assumption).
