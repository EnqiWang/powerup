POWERUP / GEOGRAPHIC FLEET COMMAND

RUN
Stop the previous server with Ctrl+C. Extract this whole ZIP into a new folder.
Run start-windows.bat and open http://localhost:8004. Refresh with Ctrl+F5.

REAL MAP
The center panel now uses MapLibre GL JS 6.14.0 and OpenFreeMap's dark style
with OpenStreetMap data. Drag to pan, scroll to zoom, Fit ZIPs to show all loaded
areas, and 3D view to tilt/zoom to mapped buildings where height data exists.
Real map assets require internet and WebGL. No map API key is configured.
No decorative/fake geography is substituted on failure. A status message
reports failures; source demand profiles remain usable independently.

ZIP GEOGRAPHY
Load SCE API in Data sources. One validated Census query requests all selected
ZIP-area polygons through U.S. Census TIGERweb's 2020 Census ZCTA layer.
The local /api/geography?zips=90002,90008 endpoint returns simplified GeoJSON
in EPSG:4326, with Census internal-point coordinates for marker placement.
Areas and markers retain the exact ZIP identifier from the source.
Click a ZIP marker, boundary, or bottom chip to select it and zoom to its real
area. Selected profiles appear in the right-hand panel. No connecting feeder
lines or invented battery addresses are drawn.
ZCTAs are statistical approximations of ZIP areas, not USPS delivery boundaries,
individual addresses, utility territories, or electrical feeder membership.
Unmatched ZIPs stay unlocated; no nearby substitute is guessed.
Successful Census responses cache in memory for 24 hours; stale responses are
explicitly labeled when a refresh fails. Export scenario retains loaded
Census polygons with the demand source. Saved polygons can restore locations,
but an online street basemap is still required.

DEMAND DATA
SCE monthly ZIP aggregates arrive from ORNL OpenEnergy Hub without customer
account access. Monthly average kWh / calendar days / 24 supplies a constant
average kW benchmark. These are not measured individual household profiles.
Use saved SCE usage loads the six real June 2024 ZIP records supplied in the
user's successful API response; it does not issue a fresh SCE request.
This saves a demand-data download only. Census lookup and street-map assets
still need internet unless their required resources are already available.
OPSD imports remain supported and retain their German historical provenance;
they are not placed on the LA map without verified geography.

MODEL
Each representative ZIP scenario models one 39.2 kWh battery. Starting charge,
charge/export limits, load categories, priority, consent, headroom and outage
timing are assumptions. This does not represent an actual battery per ZIP or
backup for every account in a ZIP. No Base or SCE customer dispatch API is used.
Preparation, consent windows, outage depletion, unknown-device exclusions and
ordinary-day reserve protection remain operational local simulations.

RESIDENT ALERT DEMO
Use the left rail's message icon -> Load demo subscribers -> Review preparation
alert -> Send to demo outbox -> Jump to next reminder. All email/SMS delivery
is simulated. Opt-in and registered home ZIP determine recipients; phone area
codes do not locate residents. No messages are sent and no jobs run after
page closure. Reminders can prompt EV charging pause/unplugging when safe and
manual deferral of nonessential loads. Utilities control actual shutoffs.

SOURCES
https://openfreemap.org/quick_start/
https://github.com/hyperknot/openfreemap-styles
https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2
https://openenergyhub.ornl.gov/explore/dataset/sce-energy-data/
https://www.basepowercompany.com/specs/core

VALIDATION
Model, local server, Census response parsing, coordinate validation, map adapter
and UI routing are checked with labeled synthetic test fixtures. Live Census,
CDN and map rendering could not be verified in this environment because
external requests/browser downloads were blocked. Verify on the demo laptop.
No test fixture is included as real demo geography.
