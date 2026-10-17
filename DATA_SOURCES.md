# Circuit data and duplicate audit

## App entry points

`index.html` is the reference-style Malibu circuit replay. `planner.html` preserves the earlier detailed planner. The replay uses `data/replay-malibu.js`, extracted from the supplied reference HTML: it is a saved simulation, not live battery telemetry. The reference itself made no live data requests.

The public SCE evidence panel fetches circuit-level records directly, without a key. Those records do not silently replace the replay's historical inputs or send dispatch commands. The earlier ZIP-based planner remains separate.

## Official public APIs

All queries use `https://drpep.sce.com/arcgis_server/rest/services/Hosted/`:

| Layer | Purpose |
|---|---|
| `Distribution_circuits/FeatureServer/0` | Circuit lines; name field `circt_nam` |
| `ICA_Tables/FeatureServer/1` | Historical hourly circuit load; name field `circuit_name` |
| `DRP_PSPS_Layer/FeatureServer/1` | Historical distribution-circuit shutoffs |

Implementation: `sce-circuits.js`, with paginated queries, partial-error handling and cancellation. API responses use explicit `min_load_mw` / `max_load_mw`; raw `min_load` must not be interpreted as household kW. Months are zero-based. Shutoff duration is calculated from timestamps because the supplied duration field can disagree with them.

Verified Cuthbert query: one line feature, 24 hourly positions for February 2026, and 17 historical shutoff records. Published historical data is not current outage status. The saved simulation still uses the reference's inferred load conversion and synthetic homes; these assumptions are not validated by the live API.

## Duplicates removed at the user's request

Moved to Windows Recycle Bin, not permanently erased. Comparisons checked all property rows, normalizing number and date representations.

| Removed | Retained equivalent | Verification |
|---|---|---|
| `data/Circuit_Load_Profile.geojson` (307,608,191 bytes) | `data/Circuit_Load_Profile.csv` | 1,231,196 matching rows; every geometry null |
| `data/sce-energy-data.csv` (384,531 bytes) | `data/sce-energy-data.json` | 8,340 matching rows |
| `data/PSPS_Circuit.csv` (213,897 bytes) | `data/PSPS_Circuit.geojson` | 901 matching property rows; retained GeoJSON also contains circuit lines |

No application references to these removed filenames were found. Total removed from the workspace: 308,206,619 bytes.

Kept both 2025 Q1 and Q4 spreadsheets: different quarters, not duplicates. Kept `PSPS_Subtransmission.geojson`: distinct higher-voltage records. Kept `sce-energy-data.parquet`: contents were not decoded, so duplication is unverified. Kept all `data/snapshots/` files and the new replay snapshot because the apps use them. Large raw source exports are archival inputs, not required downloads for the replay.
