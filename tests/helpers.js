const fs = require("fs"),
  path = require("path");
const P = require("../advanced"); // loads engine.js and installs the extended model
const M = require("../demo-model");
const root = path.join(__dirname, "..");
const json = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const snaps = Object.fromEntries(M.SNAPSHOTS.map((n) => [n, json(`data/snapshots/${n}.json`)]));
const config = json("data/twists.json");

// Six homes built the same way sce.js/app.js do from the bundled SCE snapshot.
function fleet() {
  return Object.values(snaps.sce.zips).filter((d) => d.zip !== "90265").map((d, i) => {
    const h = P.makeHome(i + 1, "ZIP " + d.zip + " · Usage scenario", d.latest.meanKw, {
      kind: "zip-benchmark",
      zip: d.zip,
    });
    h.provider = "Scenario Network " + (h.id % 2 ? "A" : "B");
    h.evidence = { fresh: false, voltage: 120, breaker: "unknown", fault: false };
    h.gridParticipation = true;
    h.exportCap = 3;
    return h;
  });
}
function consent(homes, hours) {
  homes.forEach((h) =>
    h.loads.forEach((l) => {
      if (l.id !== "essential") Object.assign(l, { consent: "accepted", consentHours: hours, gridAccepted: true });
    }),
  );
  return homes;
}
module.exports = { P, M, snaps, config, fleet, consent, root, fs, path };
