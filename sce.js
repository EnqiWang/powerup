"use strict";
// Historical ZIP aggregates inform scenarios; they are never labeled as home telemetry.
let sceSnapshots = [];
function sceCards(items) {
  $("sceRecords").innerHTML = items
    .map((data) => {
      const r = data.latest;
      return `<div class="sce-record"><b>ZIP ${safe(data.zip)}</b><div class="small">${r ? safe(r.year) + "-" + String(r.month).padStart(2, "0") : "No residential records"}</div>${r?.usable ? `<strong>${r.averagekwh.toFixed(1)} kWh / month</strong><div class="small">${r.dailyKwh.toFixed(2)} kWh/day · ${r.meanKw.toFixed(3)} kW average<br>${safe(r.totalaccounts ?? "Unreported")} SCE accounts · combined flag ${safe(r.combined ?? "unknown")}</div>` : '<strong>Unavailable</strong><div class="small">Latest value is missing or suppressed. No earlier month is silently substituted.</div>'}<div class="small">Fetched ${safe(new Date(data.fetchedAt).toLocaleString())}${data.stale ? " · saved data · refresh to check for updates" : data.cached ? " · cached" : " · API response"}</div></div>`;
    })
    .join("");
}
function labelSceSource() {
  if (source?.kind !== "zip-benchmark") return;
  $("source").textContent =
    `${homes.length} example homes based on SCE electricity averages by ZIP code. Battery charge, appliance use and resident choices are demo settings.`;
  $("sourceMini").textContent = homes.length + " example homes from ZIP data";
  $("dataBadge").textContent = "PAST ZIP ELECTRICITY USE / DEMO HOMES";
  if (Array.isArray(source.benchmarks)) {
    sceSnapshots = source.benchmarks.map((d) => ({ ...d, stale: true }));
    sceCards(sceSnapshots);
    $("sceStatus").textContent =
      "Showing saved electricity data. Load electricity data again to check for updates. Each card shows the date of the readings.";
  }
}
$("loadSce").onclick = async () => {
  if (location.protocol === "file:") {
    $("sceStatus").textContent = "Run start-windows.bat or start-mac.sh, then open http://localhost:8004 to use the API.";
    return;
  }
  const zips = [
    ...new Set(
      $("sceZips")
        .value.split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  if (!zips.length || zips.length > 6 || zips.some((x) => !/^\d{5}$/.test(x))) {
    $("sceStatus").textContent = "Enter one to six five-digit ZIP codes, separated by commas.";
    return;
  }
  $("loadSce").disabled = true;
  $("applySce").disabled = true;
  sceSnapshots = [];
  $("sceRecords").replaceChildren();
  $("sceStatus").textContent = "Requesting public SCE monthly aggregates… Current fleet is unchanged.";
  try {
    const results = await Promise.allSettled(
      zips.map(async (zip) => {
        const response = await fetch("/api/sce?zip=" + encodeURIComponent(zip), {
            signal: AbortSignal.timeout(30000),
          }),
          data = await response.json();
        if (!response.ok) throw Error(data.error || "API request failed");
        if (data.kind !== "zip-benchmark" || data.zip !== zip || !Array.isArray(data.records))
          throw Error("Unexpected API schema");
        return data;
      }),
    );
    const failures = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") sceSnapshots.push(r.value);
      else failures.push(zips[i] + ": " + r.reason.message);
    });
    sceCards(sceSnapshots);
    const usable = sceSnapshots.filter((d) => d.latest?.usable).length;
    $("applySce").disabled = !usable;
    $("sceStatus").textContent =
      `${usable} usable ZIP benchmarks; ${sceSnapshots.length - usable} unavailable. Observation months are shown on each card. ` +
      (failures.length
        ? "Failed requests: " + failures.join(" | ")
        : "Review, then build the representative fleet.");
    if (usable) {
      $("applySce").onclick();
      if (failures.length) $("sceStatus").textContent += " Some ZIP requests failed: " + failures.join(" | ");
    }
  } catch (error) {
    $("sceStatus").textContent = "SCE data NOT loaded: " + error.message + ". No data was substituted.";
  } finally {
    $("loadSce").disabled = false;
  }
};
$("applySce").onclick = () => {
  const available = sceSnapshots.filter(
    (d) =>
      d.latest?.usable && Number.isFinite(d.latest.meanKw) && d.latest.meanKw > 0 && d.latest.meanKw <= 100,
  );
  if (!available.length) {
    $("sceStatus").textContent = "No usable average is available. Existing fleet retained.";
    return;
  }
  homes = available.map((d, i) => {
    const r = d.latest,
      period = r.year + "-" + String(r.month).padStart(2, "0");
    return decorate(
      P.makeHome(i + 1, "ZIP " + d.zip + " · Usage scenario", r.meanKw, {
        kind: "zip-benchmark",
        location: "SCE residential account average · ZIP " + d.zip,
        first: period,
        last: period,
        source: d.source,
        monthlyKwh: r.averagekwh,
        accounts: r.totalaccounts,
        combined: r.combined,
        apiUrl: d.apiUrl,
      }),
    );
  });
  source = {
    kind: "zip-benchmark",
    source: "SCE monthly ZIP aggregates via ORNL OpenEnergy Hub",
    location: "Selected LA-area ZIP benchmarks; no verified common feeder",
    method:
      "Monthly average kWh divided by calendar days and 24; constant-load representative scenarios, not measured household profiles.",
    benchmarks: available,
  };
  selected = 1;
  changed(
    "ZIP scenarios created from real historical SCE averages. Battery state and resident permissions reset as scenario inputs.",
  );
  labelSceSource();
  sceSnapshots = available;
  sceCards(available);
  $("sceStatus").textContent =
    "ZIP usage scenarios applied. Real monthly benchmarks inform the model; individual homes, hourly behavior and battery state are simulated. Start the guided demo.";
};
