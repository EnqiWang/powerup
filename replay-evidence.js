/* Read-only live API evidence, deliberately separate from the saved replay's assumptions. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let controller, requestId = 0;
  const row = (label, value) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label; dd.textContent = value;
    $("sceEvidenceFacts").append(dt, dd);
  };
  async function refresh() {
    controller?.abort();
    controller = new AbortController();
    const requestController = controller;
    const current = ++requestId, signal = requestController.signal;
    const timeout = setTimeout(() => requestController.abort(Error("SCE request timed out.")), 15000);
    const name = window.PowerupReplayUI.selectedCircuit;
    $("refreshSceEvidence").disabled = true;
    $("sceEvidenceStatus").classList.remove("evidence-error");
    $("sceEvidenceStatus").textContent = `Checking public SCE records for ${name}…`;
    $("sceEvidenceFacts").replaceChildren();
    $("sceEvidenceLinks").replaceChildren();
    try {
      const result = await PowerupCircuitAPI.fetchCircuit(name, { signal });
      if (current !== requestId) return;
      const errors = Object.entries(result.errors);
      $("sceEvidenceStatus").textContent = `${name} · ${errors.length ? "Some sources unavailable" : "Fetched from SCE"} · ${new Date(result.fetchedAt).toLocaleString()}. These are published historical records, not current outage status.`;
      $("sceEvidenceStatus").classList.toggle("evidence-error", errors.length > 0);
      row("Circuit map", result.geometry ? `${result.geometry.features.length} published line features` : "Unavailable");
      if (result.load) {
        row("Latest load period", `${result.load.year}-${String(result.load.month).padStart(2, "0")} · ${result.load.hours}/24 hourly positions`);
        row("Published circuit load", result.load.minMw !== null && result.load.maxMw !== null ? `${result.load.minMw.toFixed(2)}–${result.load.maxMw.toFixed(2)} MW (whole circuit, not one home)` : "MW values missing; no conversion was guessed");
      } else row("Load profile", result.errors.load ? "Unavailable" : "No matching profile returned");
      row("Past shutoff records", result.shutoffs === null ? "Unavailable" : String(result.shutoffs.length));
      const latest = result.shutoffs?.[0];
      if (latest) {
        row("Latest recorded shutoff", new Date(latest.deenergization_datetime).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " Pacific");
        row("Duration from timestamps", latest.hoursFromDates === null ? "Not available" : latest.hoursFromDates.toFixed(1) + " hours");
        if (latest.durationMismatch) row("Data quality note", "The supplied duration field disagrees with start/end timestamps. Duration above uses the timestamps.");
      }
      for (const [key, error] of errors) row(key + " error", error);
      for (const [key, url] of Object.entries(result.sources)) {
        const li = document.createElement("li"), a = document.createElement("a");
        a.href = url; a.textContent = `Open SCE ${key} API response`; a.target = "_blank"; a.rel = "noopener";
        li.append(a); $("sceEvidenceLinks").append(li);
      }
      window.PowerupCircuitEvidence = result;
    } catch (error) {
      if (current !== requestId) return;
      $("sceEvidenceStatus").classList.add("evidence-error");
      $("sceEvidenceStatus").textContent = `Public API unavailable: ${error.message}. The saved replay still works; it has not been relabeled as fresh data.`;
    } finally {
      clearTimeout(timeout);
      if (current === requestId) $("refreshSceEvidence").disabled = false;
    }
  }
  $("refreshSceEvidence").addEventListener("click", refresh);
  // Do not fetch on every hover or replay tick. Switching the selected circuit clears stale results.
  window.addEventListener("powerup:circuit-change", () => {
    controller?.abort(); ++requestId;
    $("sceEvidenceFacts").replaceChildren(); $("sceEvidenceLinks").replaceChildren();
    $("refreshSceEvidence").disabled = false;
    $("sceEvidenceStatus").textContent = `Select Refresh to check public records for ${window.PowerupReplayUI.selectedCircuit}. The saved replay remains active.`;
    window.PowerupCircuitEvidence = null;
  });
  refresh();
})();
