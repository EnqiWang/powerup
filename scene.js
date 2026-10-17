/* Real geography: OpenFreeMap/OSM basemap + U.S. Census ZCTA boundaries. */
(function (root) {
  "use strict";
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>\"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  let theme =
    (typeof document.documentElement !== "undefined" && document.documentElement.dataset.theme) || "dark";
  function styleUrl() {
    return "https://tiles.openfreemap.org/styles/" + (theme === "light" ? "positron" : "dark");
  }
  let handlersBound = false;
  const MODULE = "https://unpkg.com/maplibre-gl@6.14.0/dist/maplibre-gl.mjs";
  let host = null,
    options = null,
    map = null,
    lib = null,
    ready = false,
    loading = null,
    markers = [],
    geo = null,
    geoKey = "",
    requested = "",
    lastFit = "",
    lastSelected = null,
    fallbackReason = root.POWERUP_DEMO ? "Demo mode: street basemap is optional." : null;
  function zipOf(h) {
    if (h.measurement?.kind !== "zip-benchmark") return null;
    return (
      [h.measurement.zip, h.measurement.location, h.name]
        .map(String)
        .join(" ")
        .match(/\b\d{5}\b/)?.[0] || null
    );
  }
  root.PowerupScene = { render, resize, zipOf, setTheme };
})(globalThis);
})(globalThis);
