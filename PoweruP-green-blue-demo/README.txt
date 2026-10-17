PoweruP — Green & Blue / Complete Guided Demo

QUICK START (WINDOWS)
1. Extract this ZIP fully.
2. Stop old PoweruP servers (Ctrl+C in their terminal).
3. Double-click start-windows.bat. Python 3.10+ is required.
4. The browser opens http://localhost:8004. Keep the terminal open.
Terminal alternative: py -3 server.py --port 8004 --open
Mac/Linux: python3 server.py --port 8004 --open
No npm/build step. Optional truststore helps use native certificate trust:
py -3 -m pip install --upgrade truststore

LOAD REAL HOUSEHOLD INPUTS
If already downloaded, copy your old project's data folder into this folder.
The cached six-profile summary loads automatically.
Otherwise expand Household measurements & live weather and click
Load six measured profiles (~15 MB on first request).

If the request fails, download the official 60-minute CSV in your browser:
https://data.open-power-system-data.org/household_data/2020-04-15/household_data_60min_singleindex.csv
Then click Load downloaded OPSD CSV and select it. No conversion command needed.
The local server validates/converts it and caches six profiles.
JSON import and prepare_households.py remain available for other supported data.

DATA PROVENANCE
Six distinct residential IDs from Open Power System Data / CoSSMic, historical
Southern Germany. NOT actual LA household records, feeder membership or Base
battery telemetry. The input is cumulative grid-import kWh, differenced into
hourly energy and averaged over valid observations. Missing/reset and
publisher-marked interpolated endpoints are skipped. The publisher also fills
some missing records; residual interpolation effects may remain.
Grid import omits self-consumed solar and can understate whole-home demand.
Essential needs, device shares and consent are never inferred from this data.
All battery state and equipment actions remain scenario inputs/simulations.
No measured records are bundled: external downloads must succeed on your
computer or you must provide the official CSV / a saved measured snapshot.

ATTRIBUTION
Open Power System Data. 2020. Data Package Household Data. Version 2020-04-15.
https://data.open-power-system-data.org/household_data/2020-04-15/
Primary source CoSSMic. Creative Commons Attribution-International.
Actual LA data requires an authorized anonymized household interval export.
Do not relabel German records as LA households.

LIVE WEATHER
Load NWS for a selected point. Source times and active alerts are shown.
Readiness categories are a transparent mapping of alert types, NOT calibrated
outage probabilities or utility PSPS notifications. Failed calls remain unknown;
stale responses remain labeled. No claim to predict fires or shutoffs.
SCE PSPS and LADWP territory are not interchangeable. Utility notices and
feeder limits need operator verification before real use.

GUIDED DEMO (ABOUT 3 MINUTES)
After measured profiles are loaded, click Start guided demo.
The app labels every injected event as a scenario action.
1. Real household provenance + hypothetical 72-hour target.
2. Simulated resident responses; accepted optional prep tasks.
3. Staggered battery charging, EV top-up and preconditioning within shared
   headroom. Tasks that cannot finish remain visible.
4. Simulated dispatcher approval, then outage replay from projected charge.
5. Shared network loss. Dispatcher sees unknown states; separate local observer
   shows the simulator following previously stored time-limited policies.
6. Ordinary Tuesday. Clears the outage replay and assumes 80% charge plus
   grid-support enrollment to show indicative economics above reserves.

SAVING FOR AN OFFLINE DEMO
Load measured profiles and weather once, then Export scenario.
Use Open saved demo to load that JSON later. It retains household provenance,
weather issue time, scenario settings and recorded permissions.
Saved weather is labeled STALE. Restored approval requires review.
You can open index.html directly to run a saved JSON demo with Wi-Fi off;
new external fetches and raw CSV import require the local server.
No account, cloud deployment, backend keys, or actual messaging needed.

ALL FIVE MODEL AREAS
Storm Prep: weather review, battery reserves, staggered preparation tasks.
Who Can Wait: request preview, accept/decline, time-limited permissions.
Outage Budget: piecewise load restoration when consent expires, energy
accounting, depletion and unmet-service reporting. No 72-hour guarantee.
Neighborhood Shield: voluntary grid reductions, then battery support above
reserves, then human handoff for unresolved constraints. External critical
loads are modeled constraints, never remotely controlled.
Silent Battery: missing heartbeat is unknown; fresh auxiliary meter/breaker/
fault observations and provider correlation only support tentative triage.

NEIGHBORHOOD SHIELD
Cold storage, communications and port/security are scaled hypothetical loads.
This single-bus model does not verify any real shared feeder or power flow.
Only residents with the additional grid-reduction permission participate in
voluntary grid cuts. Battery support requires scenario grid enrollment and
retains protected reserves. Export cap defaults to an assumed 3 kW per home.
No grid support is modeled during an active outage replay: isolated batteries
cannot power neighbors through a de-energized feeder. No claim of actual
outages prevented, port protection or remote islanding.

EV / PRECONDITIONING
Optional preparation tasks have editable kWh and kW, sharing the same
headroom as batteries. Batteries are scheduled first; tasks use residual
capacity. They require explicit scenario permission. Preconditioning energy
is not automatically converted into thermal comfort or future cooling savings:
there is no validated building thermal model. EV energy is not V2H storage.

BUDGET / CONSENT
All essential loads remain selected. Only accepted nonessential reductions
are considered. Permission duration is hours from outage start. At expiry,
the load returns; the energy engine integrates the resulting piecewise profile.
Declined or missing permission never authorizes a reduction.
Changing the target duration resets accepted responses for renewed review.
Grid-support permission is separate from outage-reduction consent.
When stored energy runs out, even required service may become unserved.
Policies continue only in the LOCAL SIMULATOR, not proven ESP32/Base firmware.

BATTERY AND GRID ASSUMPTIONS
Base Core total capacity: 39.2 kWh, from published specifications.
No Base API, customer contract, remote island command or actual hardware link.
Starting charge, usable-energy approximation, charge cap and reserve floor are
operator scenarios; exact deployed equipment limits need verification.
90% charge and discharge efficiency each; constant load allowances, no battery
wear or solar. Charging headroom excludes background household demand; no
additional household energy depletion during preparation is modeled.
Quarter-hour greedy scheduling, not a globally optimal allocation.
Historical LA stress button rounds the 43h 2m ACROBAT circuit outage on
January 8-10, 2025. It is neither typical nor a current forecast.

ORDINARY TUESDAY
Second customer: utility demand-response operator evaluating peak relief.
Reserve horizon and credit/recharge prices are user assumptions, not SCE rates.
Contribution = export credit minus future recharge cost, including conversion
loss. Not a promise of homeowner bill savings or a wholesale-market return.
Fees, wear, event household load, export eligibility and verified power limits
are outside the economics model. Grid support is disabled during outage replay.

VALIDATION
node test_engine.js
node test_advanced.js
node test_ui.js
python -m unittest -v test_six test_import test_server
Includes consent expiration, exact energy integration, preparation task
accounting, provider loss, unresolved relief, essential-load protection,
measured CSV normalization, server routes and guided-demo smoke checks.
The UI test is a lightweight DOM stub, NOT a real browser screenshot test.
Full browser rendering and live external downloads remain unverified here.
No test fixtures are saved or displayed as measured household data.

IBM BOB
Open this entire folder. Use Bob for an actual review, feature or test task
and document only its real contribution on Devpost. This code alone does not
establish Bob use. DEMO-PITCH.txt contains a factual pitch checklist.


SCE PUBLIC API (NEW)
Start start-windows.bat and open http://localhost:8004.
In Real LA-area demand benchmarks, enter up to six ZIP codes and click Load SCE API.
Review observation months, account counts, missing values and fetched timestamps.
Build representative fleet explicitly, then Start guided demo.
The server GET /api/sce?zip=90002 calls the public ORNL OpenEnergy Hub Explore 2.1
SCE dataset. No customer login or API key is sent. Successful results cache for
six hours in memory. Failed refreshes retain labeled stale cache; otherwise an
error is returned with no substituted data. Only the latest published row per
ZIP is eligible; missing latest averages are never replaced with older months.
Six ZIPs need not represent the same month or share a feeder.

Monthly kWh / calendar days / 24 yields a constant average kW benchmark.
Representative household scenarios are NOT measured individual LA households.
Shares, priorities, battery SOC, charge limits, consent and outages are simulated.
The imported benchmark records and source URLs are retained in Export scenario,
which can be reopened offline. The UI marks restored records as saved/stale.
SCE source: https://openenergyhub.ornl.gov/explore/dataset/sce-energy-data/
This is an ORNL public-data integration, not a Base/SCE account or dispatch API.
Live API access was blocked in the build environment; upstream parsing, local
routes, calendar arithmetic, failures, cache and UI flows were tested using
clearly identified synthetic test fixtures. Test fixtures are not demo inputs.


RESIDENT ALERTS DEMO
Click Resident alerts in the header, then Load demo subscribers. Six fictional
residents use example.com emails and reserved 555-01xx phone numbers.
Target their registered home ZIP, choose an operator readiness level and set
a future expected shutoff time. The time is entered in your browser local time;
preview and outbox display your timezone. ZIP demand/NWS are not outage forecasts.
Review preparation alert, then Send to demo outbox. No network request, email,
SMS, utility notification or equipment command is made by this feature.
Jump to next reminder twice to demonstrate the one-hour and 15-minute notices.
Advance 30 min moves only the notification clock. The battery outage simulator
has its own explicitly controlled replay clock. No jobs run after page closure.
Only opted-in subscribers in the selected home ZIP receive simulated messages;
phone area codes do not determine location. A real-looking test contact is still
local-only and will never be messaged. Opt-outs cancel pending reminders when
the demo clock processes them. A revised ZIP alert supersedes pending reminders
for that ZIP. Past reminder times are omitted. Monitoring alerts have no timed
reminders. Notification readiness levels and shutoff times are manual scenarios.
Export demo outbox creates a separate JSON with masked destinations. This panel
resets when the page reloads; its state is not restored by the fleet snapshot.
Real SMS/email integration and verified utility notices are future work.


ZIP VIEW UPDATE
No fictional starter houses load at startup. The planner begins empty.
Load SCE API fetches the selected ZIPs and applies usable historical monthly
benchmarks directly. ZIP cards display actual ZIP, reporting month, account
count and monthly average. Each backup calculation models one battery against
a representative per-account average. It is not a real home or backup for all
accounts in the ZIP. A failed API request preserves existing loaded records and
never creates substitute households. Household profile imports remain supported.
