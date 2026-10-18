# PowerUP: Wildfire Shutoff Dispatcher

PowerUP is a dispatcher for a fleet of home batteries (Base Core, 39.2 kWh / 20 kW) during a utility wildfire shutoff (PSPS). It replays the real October 2026 Malibu shutoff on six SCE circuits (Cuthbert, Galahad, Maguire, Merlin, Serra, Tuna) and shows what a fleet dispatcher would have done, hour by hour, on a map.

Live demo: https://claude.ai/artifact/2nJavppFPcHFBU1HGg18tC

Built for the InnovateLA Dual-Use Hackathon (USC, Oct 16 to 18 2026), Energy & Grid lens with Base Power.

## What PowerUP does

A ladder of five steps, each the gentlest response that still works:

| Step | Malibu date | What PowerUP does |
| --- | --- | --- |
| Watch | Oct 9, 2:14 AM (first NWS wind signal) | Fills Medical Baseline homes to 100% and holds them. Everyone else has an ordinary day. |
| Ask | Oct 12 (SCE names four circuits) | Fills registered critical-need homes on those circuits; raises the floor for everyone else to 50% and asks for consent to pre-fill. |
| Fill | Oct 14, 6:37 AM (six circuits, shutoff definite) | Fills every consenting battery under each circuit's load headroom, so no new peak. |
| Hold | Oct 15, 4:00 PM (power off) | Every battery islands, never exports, and runs its home on a budget sized to the planned outage. Plans are pushed before the cell towers fail; batteries then talk over a neighbourhood mesh to a Starlink uplink. EV trips to medical homes running low are proposed for a person to approve. |
| Hand to a person | Oct 17, 8:00 PM (winds ease) | PowerUP proposes a staggered restoration recharge plan per circuit, Medical Baseline first, with the cold-load peak shown with and without PowerUP. The utility's shutoff officer approves or holds each circuit. |

On an ordinary day the same battery earns money by shifting energy, as Base and Tesla already do. Readiness costs that revenue, so PowerUP spends it only where the risk is.

## Real data

- SCE DRPEP open data: circuit line shapes, customer counts, 55 past Malibu shutoffs (2019 to 2025), hourly load profiles per circuit (`data/malibu/`, caveats in its README).
- CAISO OASIS day-ahead prices for the SCE load zone (DLAP_SCE-APND), October 2025: the money in the app is the real wholesale value of one battery's best daily schedule at each reserve floor (`data/prices/`). The assumed SCE time-of-use rates are the alternative in the app's drawer.
- NWS forecast discussions, City of Malibu and CAL FIRE notices for the timeline.

Demo data (labelled "assumed" or "demo" in the app): 6,874 homes placed along SCE's lines to match customer counts, 15% with a battery, 5% Medical Baseline (SCE publishes no per-circuit counts), Tuna's 500 customers and line, cell tower backup hours, restoration times (planned, not reported).

## Layout

```
app/        the single-file app: src/page.html + src/engine.js + data/data.json -> index.html (python3 -I build.py)
app/tests/  engine.test.cjs (node), interact.cjs and the other Playwright checks (NODE_PATH=$(npm root -g) node tests/interact.cjs)
data/       data.json (the pack the app inlines), pack.py (builds it from data/malibu and the web pulls), add_prices.py
data/malibu the cleaned SCE extracts for the six circuits
data/prices CAISO Q4 2025 daily arbitrage values per battery and the script that made them
docs/       SPEC.md (rules and views), PRIOR_ART.md (what exists, what PowerUP adds), TWISTS.md (how the hackathon twists are taken in)
```

## Run

```
cd app && python3 -I build.py            # writes app/index.html
node tests/engine.test.cjs               # 22 engine tests
NODE_PATH=$(npm root -g) node tests/interact.cjs   # 126 Playwright checks (needs playwright and Chromium)
```

Open `app/index.html` in a browser. It has no runtime dependencies except the Google Fonts stylesheet.

## Credit what exists

Tesla Storm Watch pre-charges on weather warnings; Base keeps a 20% backup floor and arbitrages daily; SCE gives Medical Baseline customers portable batteries; IEEE 1547 governs reconnection; CSIP covers lost-comms fallback. PowerUP adds the utility's own shutoff list as the trigger, medical priority, per-home outage budgets, a staggered fleet recharge and a utility-approved plan. See `docs/PRIOR_ART.md`.

## Responsible use

PowerUP sees a priority tier per home, not a medical record. It can propose, slow, fill or hold; a person approves every restoration recharge and every EV trip. The replay is a demo of what a dispatcher could do, not a record of what happened.

## License

MIT, see LICENSE.
