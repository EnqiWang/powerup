/* PoweruP model: kW, kWh, hours. All dispatch is simulated. */
(function (root) {
  "use strict";
  const ETA = 0.9;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function finite(n, min, max, label) {
    if (!Number.isFinite(n) || n < min || n > max) throw Error("Invalid " + label);
  }
  function config(c) {
    finite(c.duration, 0.25, 168, "duration");
    finite(c.lead, 0.25, 48, "lead");
    finite(c.headroom, 0, 10000, "headroom");
    finite(c.floor, 0, 1, "reserve floor");
  }
  function home(h) {
    finite(h.capacity, 0.1, 1000, "capacity");
    finite(h.energy, 0, h.capacity, "energy");
    finite(h.rate, 0.1, 100, "charge cap");
    for (const l of h.loads) {
      finite(l.kw, 0, 100, "load");
      if (!["required", "unasked", "accepted", "declined"].includes(l.consent))
        throw Error("Invalid consent");
      finite(l.reduction, 0, 1, "reduction");
    }
  }
  function makeHome(i, name, mean = 1.5, measurement = null) {
    return {
      id: i,
      name,
      capacity: 39.2,
      energy: 11.76,
      rate: 3,
      priority: 2,
      online: true,
      measurement,
      meanKw: mean,
      loads: [
        {
          id: "essential",
          name: "Essential devices",
          kw: mean * 0.3,
          reduction: 0,
          consent: "required",
          rank: 99,
        },
        {
          id: "cooling",
          name: "Heating and cooling",
          kw: mean * 0.45,
          reduction: 0.5,
          consent: "unasked",
          rank: 2,
        },
        {
          id: "ev",
          name: "Optional charging",
          kw: mean * 0.15,
          reduction: 1,
          consent: "unasked",
          rank: 1,
        },
        {
          id: "other",
          name: "Other optional uses",
          kw: mean * 0.1,
          reduction: 1,
          consent: "unasked",
          rank: 0,
        },
      ],
    };
  }
  function defaults() {
    return [1.9, 0.85, 2.3, 1.1, 2.7, 1.5].map((kw, i) => makeHome(i + 1, "Test profile " + (i + 1), kw));
  }
  function total(h) {
    return h.loads.reduce((s, l) => s + l.kw, 0);
  }
  function budget(h, c, energy = h.energy) {
    home(h);
    config(c);
    finite(energy, 0, h.capacity, "budget energy");
    const base = total(h),
      allow = (energy * ETA) / c.duration;
    let demand = base;
    const actions = [];
    for (const l of h.loads
      .filter(
        (l) =>
          l.id !== "essential" &&
          l.consent === "accepted" &&
          l.reduction > 0 &&
          (l.consentHours ?? 0) >= c.duration,
      )
      .sort((a, b) => a.rank - b.rank)) {
      if (demand <= allow + 1e-9) break;
      const saved = l.kw * l.reduction;
      demand -= saved;
      if (saved > 0) actions.push({ id: l.id, name: l.name, savedKw: saved, reduction: l.reduction });
    }
    demand = Math.max(0, demand);
    const runtime = demand > 0 ? (energy * ETA) / demand : null;
    return {
      baseKw: base,
      budgetKw: allow,
      plannedKw: demand,
      actions,
      runtime,
      baselineRuntime: base > 0 ? (energy * ETA) / base : null,
      targetMet: demand * c.duration <= energy * ETA + 1e-8,
      shortfallKwh: Math.max(0, (demand * c.duration) / ETA - energy),
      requiredKwh: (demand * c.duration) / ETA,
      unknown: !h.online,
    };
  }
  function prepare(homes, c) {
    config(c);
    homes.forEach(home);
    // First establish consent-aware demand using a fully charged battery as the budget.
    const hs = homes.map((h) => {
      const b = budget(h, c, h.capacity),
        required = Math.max(h.capacity * c.floor, b.requiredKwh);
      return {
        ...clone(h),
        start: h.energy,
        target: Math.min(h.capacity, required),
        required,
        projection: b,
      };
    });
    const trace = [];
    for (let t = 0; t < c.lead - 1e-9; t += 0.25) {
      const dt = Math.min(0.25, c.lead - t);
      let remaining = c.headroom;
      const allocations = {};
      const queue = hs
        .filter((h) => h.online && h.energy < h.target - 1e-9)
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            (a.energy * ETA) / Math.max(0.001, a.projection.plannedKw) -
              (b.energy * ETA) / Math.max(0.001, b.projection.plannedKw) ||
            a.id - b.id,
        );
      for (const h of queue) {
        const kw = Math.max(0, Math.min(h.rate, remaining, (h.target - h.energy) / (ETA * dt)));
        h.energy = Math.min(h.capacity, h.energy + kw * ETA * dt);
        remaining -= kw;
        allocations[h.id] = kw;
      }
      trace.push({ hour: t, dt, total: c.headroom - remaining, allocations });
    }
    return {
      homes: hs.map((h) => ({
        ...h,
        budget: budget(h, c, h.energy),
        addedKwh: h.energy - h.start,
        shortfallKwh: Math.max(0, h.required - h.energy),
      })),
      trace,
    };
  }
  function everyday(homes, c, p) {
    config(c);
    finite(p.buy, 0, 10, "charge price");
    finite(p.sell, 0, 10, "export price");
    finite(p.eventHours, 0.25, 24, "event hours");
    const hs = homes.map((h) => {
      home(h);
      const protection = budget(h, c, h.capacity),
        reserve = Math.min(h.capacity, Math.max(h.capacity * c.floor, protection.requiredKwh)),
        available = h.online ? Math.max(0, h.energy - reserve) : 0;
      const delivered = available * ETA,
        revenue = delivered * p.sell,
        rechargeCost = (available / ETA) * p.buy;
      return {
        id: h.id,
        online: h.online,
        reserveKwh: reserve,
        availableStoredKwh: available,
        exportKwh: delivered,
        averageKw: delivered / p.eventHours,
        revenue,
        rechargeCost,
        margin: revenue - rechargeCost,
        unmetReserveKwh: Math.max(0, protection.requiredKwh - h.energy),
      };
    });
    return {
      homes: hs,
      exportKwh: hs.reduce((s, h) => s + h.exportKwh, 0),
      margin: hs.reduce((s, h) => s + h.margin, 0),
    };
  }
  function startOutage(homes, c, preparation = null) {
    config(c);
    return {
      elapsed: 0,
      duration: c.duration,
      devices: homes.map((h) => {
        const prepared = preparation?.homes.find((x) => x.id === h.id);
        const energy = prepared && h.online ? prepared.energy : h.energy;
        const b = budget(h, c, energy);
        return {
          id: h.id,
          energy,
          initialEnergy: energy,
          baseKw: b.baseKw,
          plannedKw: b.plannedKw,
          actions: b.actions,
          offline: !h.online,
          policy: "Store accepted load reductions and preserve required loads",
          unservedKwh: 0,
        };
      }),
    };
  }
  function advance(state, hours) {
    finite(hours, 0.01, 24, "advance hours");
    const out = clone(state);
    const dt = Math.max(0, Math.min(hours, out.duration - out.elapsed));
    out.elapsed += dt;
    for (const d of out.devices) {
      const wanted = d.plannedKw * dt,
        supplied = Math.min(wanted, d.energy * ETA);
      d.unservedKwh += Math.max(0, wanted - supplied);
      d.energy = Math.max(0, d.energy - supplied / ETA);
    }
    return out;
  }
  const api = { ETA, makeHome, defaults, total, budget, prepare, everyday, startOutage, advance, clone };
  root.Powerup = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
