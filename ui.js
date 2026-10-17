/* Presentation only: themes and progressive disclosure. No dispatch/data mutations. */
(function (root) {
  "use strict";
  const key = "powerup-theme",
    doc = document,
    html = doc.documentElement;
  let saved = null;
  try {
    saved = localStorage.getItem(key);
  } catch (_) {}
  function theme(name, persist = false) {
    name = name === "dark" ? "dark" : "light";
    html.dataset.theme = name;
    if (persist) {
      saved = name;
      try {
        localStorage.setItem(key, name);
      } catch (_) {}
    }
    doc
      .querySelectorAll("[data-theme-choice]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === name)));
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = name === "dark" ? "#0c1520" : "#f3f7fa";
    root.PowerupScene?.setTheme?.(name);
  }
  doc
    .querySelectorAll("[data-theme-choice]")
    .forEach((b) => b.addEventListener("click", () => theme(b.dataset.themeChoice, true)));
  theme(saved === "light" || saved === "dark" ? saved : "light");

  // Keep native details state when the existing planner redraws controls.
  const states = new Map();
  function fold(id, title, nodes, forceOpen = false) {
    const box = doc.createElement("details");
    box.className = "profile-section";
    box.dataset.uiSection = id;
    box.open = forceOpen || (states.get(id) ?? false);
    const summary = doc.createElement("summary");
    summary.textContent = title;
    box.appendChild(summary);
    const body = doc.createElement("div");
    body.className = "section-body";
    nodes.forEach((n) => body.appendChild(n));
    box.appendChild(body);
    box.addEventListener("toggle", () => states.set(id, box.open));
    return box;
  }
  // Move existing controls rather than recreating them: their listeners and IDs stay intact.
  const settings = fold("session", "More options", [
    doc.querySelector(".controlbar"),
    ...["demoToggle", "guided", "jumpNotify", "reset", "export"].map((id) => doc.getElementById(id)),
  ]);
  settings.classList.add("session-options");
  doc.querySelector(".pagehead").after(settings);
  doc.getElementById("guided").textContent = "Step-by-step practice";
  const run = doc.getElementById("runDemo");
  run.textContent = "Watch walkthrough";
  run.classList.remove("primary");
  run.title = "Watch a 3-minute simulated outage replay";
  const operations = doc.querySelector('[data-app-view="operations"]');
  const estimates = fold("estimates", "More estimates & assumptions", [doc.getElementById("headline")]);
  estimates.classList.add("extra-estimates");
  operations.insertBefore(estimates, operations.querySelector(".advanced-disclosure"));
  const stress = doc.getElementById("stress");
  doc.querySelector(".charging-settings").appendChild(stress);
  const approve = doc.getElementById("approve");
  doc.querySelector(".charging-settings").before(approve);
  // The empty workspace stays out of the way until data or examples have been loaded.
  doc.body.classList.toggle("has-homes", homes.length > 0);
  doc.body.dataset.mode = mode;
  const updateHint = () => {
    doc.getElementById("planningHint").textContent = !homes.length
      ? ""
      : mode === "prepare"
        ? approved
          ? "Plan approved for this simulation. Choose During an outage to see how the backup lasts."
          : "Choose your backup hours in Your plan, then select Review plan. Estimates update automatically."
        : mode === "outage"
          ? "Choose Start outage simulation, then advance the clock to see how long backup lasts."
          : mode === "shield"
            ? "Adjust the nearby services below to estimate how much help the batteries can provide."
            : "Set example prices and the backup hours to keep, then compare the estimated earnings.";
  };
  new MutationObserver(updateHint).observe(doc.getElementById("banner"), { childList: true });
  updateHint();
  function decorate() {
    const target = doc.getElementById("detail"),
      first = target?.firstElementChild;
    if (!first || first.dataset.uiDecorated || !doc.getElementById("soc")) return;
    first.dataset.uiDecorated = "true";
    first.classList.add("profile-summary");
    const source = first.firstElementChild;
    if (source?.classList.contains("insight"))
      first.appendChild(fold("source", "Source & model assumptions", [source]));
    const fields = doc.getElementById("soc").closest(".fields");
    const priority = doc.getElementById("priority").closest("label"),
      disconnect = doc.getElementById("disconnect");
    first.appendChild(fold("battery", "Battery scenario settings", [fields, priority, disconnect]));
    const flex = Array.from(target.children).find(
      (n) => n !== first && !n.classList.contains("extra-detail") && n.querySelector("#requestFlex"),
    );
    if (flex) {
      const box = fold("permissions", "Resident permissions & load estimates", [flex]);
      target.appendChild(box);
    }
    const extra = target.querySelector(".extra-detail");
    if (extra) {
      const groups = [];
      let current = null;
      Array.from(extra.childNodes).forEach((n) => {
        if (n.nodeType === 1 && n.tagName === "H3") {
          current = { title: n.textContent, nodes: [] };
          groups.push(current);
          n.remove();
        } else if (current) current.nodes.push(n);
      });
      groups.forEach((g, i) =>
        target.appendChild(
          fold(
            "extra-" + i,
            g.title,
            g.nodes,
            i === 2 && doc.getElementById("selectedStatus").textContent === "UNKNOWN",
          ),
        ),
      );
      extra.remove();
    }
  }
  const detail = doc.getElementById("detail");
  if (detail) new MutationObserver(decorate).observe(detail, { childList: true, subtree: true });
  decorate();
  root.PowerupUI = { setTheme: (name) => theme(name, true), decorate };
})(globalThis);
