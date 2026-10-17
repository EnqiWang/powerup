/* Public SCE DRPEP circuit evidence. No credentials, household telemetry or dispatch. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PowerupCircuitAPI = api;
})(globalThis, function () {
  "use strict";
  const BASE = "https://drpep.sce.com/arcgis_server/rest/services/Hosted/";
  const CIRCUITS = ["Galahad", "Maguire", "Cuthbert", "Merlin", "Serra", "Tuna", "Nicholas"];
  const LAYERS = {
    geometry: "Distribution_circuits/FeatureServer/0",
    load: "ICA_Tables/FeatureServer/1",
    shutoffs: "DRP_PSPS_Layer/FeatureServer/1",
  };
  function queries(name) {
    const circuit = CIRCUITS.find((c) => c.toLowerCase() === String(name).toLowerCase());
    if (!circuit) throw Error("Choose a listed Malibu circuit.");
    const where = (field) => `UPPER(${field})='${circuit.toUpperCase()}'`;
    const specs = {
      geometry: { f: "geojson", where: where("circt_nam"), outFields: "circt_nam,sub_name,circuit_voltage,objectid", returnGeometry: "true", outSR: "4326", geometryPrecision: "5", maxAllowableOffset: "0.00005" },
      load: { f: "json", where: where("circuit_name") + " AND year >= 2023", outFields: "circuit_name,substation,year,month,hour,min_load_mw,max_load_mw,monthlabel,objectid", returnGeometry: "false" },
      shutoffs: { f: "json", where: where("circuit_name"), outFields: "circuit_name,substation_name,psps_event,total_customers,deenergization_datetime,reenergization_datetime,minutes_deenergized,year,objectid", returnGeometry: "false" },
    };
    return Object.fromEntries(Object.entries(specs).map(([key, params]) => [key, BASE + LAYERS[key] + "/query?" + new URLSearchParams({ ...params, orderByFields: "objectid ASC", resultRecordCount: "2000", resultOffset: "0" })]));
  }
  async function readPages(url, fetcher, signal) {
    const features = [];
    for (let page = 0; page < 10; page++) {
      const u = new URL(url);
      u.searchParams.set("resultOffset", String(page * 2000));
      const response = await fetcher(u.href, { signal, credentials: "omit" });
      if (!response.ok) throw Error(`SCE returned HTTP ${response.status}.`);
      const data = await response.json();
      if (data.error) throw Error(data.error.message || "SCE rejected the query.");
      if (!Array.isArray(data.features)) throw Error("Unexpected SCE response.");
      features.push(...data.features);
      if (!data.exceededTransferLimit && data.features.length < 2000) return features;
      if (!data.features.length && data.exceededTransferLimit) throw Error("SCE returned an incomplete page.");
    }
    throw Error("Circuit response exceeded the page limit; results were not used.");
  }
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  function summarizeLoad(features) {
    const rows = features.map((f) => f.attributes).filter((r) => r && Number.isInteger(r.year) && Number.isInteger(r.month) && r.month >= 0 && r.month <= 11);
    rows.sort((a, b) => b.year - a.year || b.month - a.month || a.hour - b.hour);
    if (!rows.length) return null;
    const first = rows[0];
    const period = rows.filter((r) => r.year === first.year && r.month === first.month);
    const lows = period.map((r) => r.min_load_mw).filter((v) => finite(v) && v >= 0);
    const highs = period.map((r) => r.max_load_mw).filter((v) => finite(v) && v >= 0);
    return {
      year: first.year, month: first.month + 1, // SCE: 0=JAN; verified against monthlabel.
      minMw: lows.length ? Math.min(...lows) : null,
      maxMw: highs.length ? Math.max(...highs) : null,
      hours: new Set(period.map((r) => r.hour)).size,
      rows: period,
    };
  }
  function summarizeShutoffs(features) {
    return features.map((f) => {
      const r = f.attributes;
      if (!r) return null;
      const validDates = finite(r.deenergization_datetime) && finite(r.reenergization_datetime) && r.deenergization_datetime > Date.UTC(2000, 0, 1) && r.reenergization_datetime >= r.deenergization_datetime;
      const minutes = validDates ? (r.reenergization_datetime - r.deenergization_datetime) / 60000 : null;
      return { ...r, hoursFromDates: minutes === null ? null : minutes / 60, durationMismatch: minutes !== null && finite(r.minutes_deenergized) && Math.abs(minutes - r.minutes_deenergized) > 1 };
    }).filter(Boolean).sort((a, b) => (b.deenergization_datetime || 0) - (a.deenergization_datetime || 0));
  }
  async function fetchCircuit(name, { fetcher = globalThis.fetch, signal } = {}) {
    const sources = queries(name);
    const entries = Object.entries(sources);
    const results = await Promise.allSettled(entries.map(([, url]) => readPages(url, fetcher, signal)));
    if (signal?.aborted) throw signal.reason || Error("Request cancelled.");
    const data = {}, errors = {};
    results.forEach((r, i) => {
      const key = entries[i][0];
      if (r.status === "fulfilled") data[key] = r.value;
      else errors[key] = r.reason?.message || "Request failed.";
    });
    return {
      circuit: name, fetchedAt: new Date().toISOString(), sources, errors,
      geometry: data.geometry ? { type: "FeatureCollection", features: data.geometry } : null,
      load: data.load ? summarizeLoad(data.load) : null,
      shutoffs: data.shutoffs ? summarizeShutoffs(data.shutoffs) : null,
    };
  }
  return { CIRCUITS, LAYERS, queries, fetchCircuit, summarizeLoad, summarizeShutoffs };
});
