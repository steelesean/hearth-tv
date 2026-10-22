// The whole refresh: read Octopus, calculate, ask Claude to explain, store.

import * as octopus from "./octopus.js";
import { analyse } from "./analyse.js";
import { weeklyNote, plainNote } from "./note.js";
import { loadFeedback, mergeDispatches } from "./store.js";
import { chargingByHour } from "./ohme.js";
import { mileage, TRIP_METER } from "./polestar.js";
import { heatingEfficiency } from "./efficiency.js";

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
import { heatHistory } from "./tado.js";
import { local } from "./analyse.js";

const QUIET_FOR = 90 * 24 * 60 * 60 * 1000;   // a dismissed suggestion stays away this long

const DAY = 24 * 60 * 60 * 1000;

/**
 * Rates for each agreement that overlaps the window. Some tariffs (e.g. IOG-SMB-VAR-24-10-29)
 * aren't published, so Octopus returns no prices; then borrow from the household's other tariff
 * of the same launch (same date suffix) or failing that any of their tariffs, and say so.
 */
async function pricingFor(kind, agreements, from, to) {
  const out = [];
  for (const a of agreements) {
    const af = Math.max(from, a.valid_from ? Date.parse(a.valid_from) : 0);
    const at = Math.min(to, a.valid_to ? Date.parse(a.valid_to) : Infinity);
    if (af >= at) continue;
    out.push({ from: af, to: at, code: a.tariff_code, rates: await octopus.rates(kind, a.tariff_code, new Date(af), new Date(at)) });
  }
  const launch = (code) => code.match(/\d{2}-\d{2}-\d{2}(?=-[A-Z]$)/)?.[0];
  for (const p of out) {
    if (p.rates.unit.length) continue;
    const donors = out.filter((q) => q !== p && q.rates.unit.length)
      .sort((x, y) => (launch(y.code) === launch(p.code)) - (launch(x.code) === launch(p.code)));
    for (const d of donors) {
      const code = d.code.slice(0, -1) + p.code.slice(-1);          // their region
      const rates = await octopus.rates(kind, code, new Date(p.from), new Date(p.to)).catch(() => null);
      if (rates?.unit.length) { p.rates = rates; p.assumedFrom = code; break; }
    }
  }
  return out;
}

export async function refresh(now = Date.now()) {
  if (!process.env.OCTOPUS_API_KEY || !process.env.OCTOPUS_ACCOUNT) throw new Error("Add OCTOPUS_API_KEY and OCTOPUS_ACCOUNT in Vercel.");
  const to = now, from = now - 92 * DAY;
  const meters = await octopus.account();
  if (!meters.elec) throw new Error("No electricity meter on this Octopus account.");

  const [elec, gas] = await Promise.all([
    octopus.consumption("elec", meters.elec, new Date(from), new Date(to)),
    meters.gas ? octopus.consumption("gas", meters.gas, new Date(from), new Date(to)) : [],
  ]);
  if (!elec.length) throw new Error("Octopus has no half-hourly electricity readings yet. Smart meter data can take a few days to appear.");

  const [elecPricing, gasPricing] = await Promise.all([
    pricingFor("elec", meters.elec.agreements, from, to),
    meters.gas ? pricingFor("gas", meters.gas.agreements, from, to) : [],
  ]);
  // Ohme: its own hour-by-hour record of charging, if connected.
  let ohme = null, ohmeInfo = { connected: false };
  try {
    ohme = await chargingByHour(from, to);
    ohmeInfo = ohme ? { connected: true, hours: ohme.length } : { connected: false };
  } catch (e) {
    ohmeInfo = { connected: true, error: e.message };
  }

  // Polestar: the car's own mileage, read once a day, if connected.
  let carReadings = null, polestarInfo = { connected: false };
  try {
    carReadings = await mileage();
    polestarInfo = carReadings ? { connected: true, readings: carReadings.length, latest: carReadings.at(-1) } : { connected: false };
  } catch (e) {
    polestarInfo = { connected: true, error: e.message };
  }

  // Intelligent Octopus: smart-charge slots are billed at the cheap rate, house included.
  // Confirmed ones come from Octopus (it only lists recent ones, so they're kept). Older ones are
  // inferred where Ohme priced an hour at the cheap rate, which it does for Octopus-scheduled
  // charging but not for a manual boost; those are labelled as assumed.
  let dispatchInfo = { available: false };
  let kept = [];
  try {
    kept = await mergeDispatches(await octopus.completedDispatches());
    dispatchInfo = { available: true, stored: kept.length, since: kept[0] ? new Date(kept[0].from).toISOString().slice(0, 10) : null };
  } catch (e) {
    kept = await mergeDispatches([]).catch(() => []);
    dispatchInfo = { available: false, error: e.message, stored: kept.length };
  }
  const inferred = ohme ? inferFromOhme(ohme, elecPricing, kept) : [];
  dispatchInfo.halfHoursRepriced = applyDispatches(elecPricing, [...kept, ...inferred]);
  dispatchInfo.inferredHours = inferred.length;

  const current = elecPricing[elecPricing.length - 1];
  const region = current.code.slice(-1);
  const currentProduct = octopus.productOf(current.code);

  const options = (await octopus.alternatives()).filter((o) => o.product !== currentProduct);
  const alternatives = (await Promise.all(options.map(async (o) => {
    const code = "E-1R-" + o.product + "-" + region;
    try { return { label: o.label, pricing: [{ from, to, code, rates: await octopus.rates("elec", code, new Date(from), new Date(to)) }] }; }
    catch { return null; }
  }))).filter(Boolean);

  // Tado: which rooms called for heat, for each day of gas readings. Optional.
  let heat = null, roomTemps = null, tadoInfo = { connected: false };
  if (gas.length) {
    const dates = [...new Set(gas.map((r) => local(r.t).date))];
    try {
      const h = await heatHistory(dates, local);
      tadoInfo = { connected: h.connected, rooms: h.rooms, fetched: h.fetched, missingDays: h.missing, requestsLeft: h.requestsLeft };
      if (Object.keys(h.days).length) { heat = h.days; roomTemps = h.temps; }
    } catch (e) {
      tadoInfo = { connected: true, error: e.message };
    }
  }

  const facts = analyse({
    elec, gas, elecPricing, gasPricing, alternatives, now, heat, roomTemps, ohme, carReadings, tripMeter: TRIP_METER,
    currentName: "Your tariff (" + shortName(await octopus.productName(currentProduct)) + ")",
  });
  // Heating efficiency before and after the roof insulation, from up to two years of daily gas.
  try {
    facts.efficiency = await heatingEfficiency(meters, gasPricing.at(-1)?.rates?.unit?.at(-1)?.p, now, facts.gasUnits);
  } catch (e) {
    facts.efficiency = { available: false, reason: "Couldn't work it out: " + e.message };
  }
  const ef = facts.efficiency;
  // Gas for the rest of the month from the weather forecast and this house's own response to cold.
  const fc = facts.forecast, gasPence = ef.gasPence;
  if (ef.available && fc?.through && gasPence && ef.ahead?.length) {
    const monthEnd = fc.through.slice(0, 8) + String(fc.daysInMonth).padStart(2, "0");
    const rest = ef.ahead.filter((d) => d.date > fc.through && d.date <= monthEnd);
    const uncovered = fc.daysInMonth - fc.daysWithData - rest.length;
    const heat = fc.parts.heating;
    heat.projected = Math.round((heat.soFar + sum(rest.map((d) => d.kwh)) * gasPence / 100 + Math.max(0, uncovered) * heat.pace) * 100) / 100;
    fc.projected = Math.round(Object.values(fc.parts).reduce((a, p) => a + p.projected, 0) * 100) / 100;
    fc.gasFrom = "the weather forecast for " + (ef.area || "your area") + (uncovered > 0 ? ", and the recent pace beyond it" : "");
    fc.aheadTemp = rest.length ? Math.round(rest.reduce((a, d) => a + d.temp, 0) / rest.length * 10) / 10 : null;
  }
  if (ef.available) {
    facts.candidates.push({
      id: "insulation-info",
      per_year_gbp: 0,
      facts: `Since the ${ef.change.what} in January, the house uses ${ef.after.kwhPerDegreeDay} kWh of gas per degree day of cold, against ${ef.before.kwhPerDegreeDay} before: ${Math.abs(ef.change.pct)}% ${ef.change.pct <= 0 ? "less" : "more"} for the same weather.`
        + (ef.thisSeason ? ` This autumn so far (${ef.thisSeason.days} cold days) it used ${ef.thisSeason.actualKwh} kWh, where the house as it was would have used about ${ef.thisSeason.beforeKwh} kWh.` : "")
        + (ef.perYear?.gbp != null ? ` Over a year like the last one, that's about ${ef.perYear.kwh} kWh, or £${ef.perYear.gbp} at today's gas rate.` : ""),
      how_we_know: `Daily gas from Octopus against daily average temperatures for ${ef.area || "the home"} (Open-Meteo), ${ef.before.days} cold days before and ${ef.after.days} after. Anything else that changed, like thermostat settings or who was home, is mixed in.`,
    });
  }
  // Leave out anything the household said they already do, or that isn't for them.
  const feedback = await loadFeedback().catch(() => ({}));
  facts.dismissed = facts.candidates.filter((c) => feedback[c.id] && now - Date.parse(feedback[c.id].at) < QUIET_FOR).map((c) => c.id);
  facts.candidates = facts.candidates.filter((c) => !facts.dismissed.includes(c.id));
  let note = null;
  try { note = await weeklyNote(facts); } catch (e) { console.error("Note failed:", e.message); }
  facts.note = note || plainNote(facts);
  // What Octopus returned for the household's own tariff, so gaps can be diagnosed from the page.
  const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16) : "open");
  facts.source_pricing = elecPricing.map((a) => ({
    code: a.code, from: iso(a.from), to: iso(a.to), assumedFrom: a.assumedFrom || null,
    unitRates: a.rates.unit.length, standing: a.rates.standing.length,
    first: a.rates.unit[0] && { from: iso(a.rates.unit[0].from), to: iso(a.rates.unit[0].to), p: a.rates.unit[0].p },
    last: a.rates.unit.at(-1) && { from: iso(a.rates.unit.at(-1).from), to: iso(a.rates.unit.at(-1).to), p: a.rates.unit.at(-1).p },
    distinctPrices: [...new Set(a.rates.unit.map((r) => r.p))].slice(0, 6),
  }));
  facts.tado = tadoInfo;
  facts.ohme = ohmeInfo;
  facts.polestar = polestarInfo;
  facts.dispatches = dispatchInfo;
  facts.source = { elecDays: Math.round(elec.length / 48), gasDays: gas.length ? Math.round(gas.length / 48) : 0, alternativesPriced: alternatives.map((a) => a.label) };
  return facts;
}

/** "Flexible Octopus October 2025 v1" → "Flexible Octopus". */
function shortName(name) {
  return String(name).replace(/\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b.*$/i, "").replace(/\s+v\d+$/i, "").trim();
}

/**
 * Adds a half-hour cheap-rate entry for each half-hour a confirmed smart-charge slot touched, so
 * the price lookup (shortest period wins) uses it. The cheap rate is the lowest unit rate within
 * twelve hours on that agreement. Returns how many half-hours changed.
 */
function applyDispatches(pricing, dispatches) {
  const HH = 30 * 60 * 1000;
  let n = 0;
  for (const a of pricing) {
    const add = [];
    for (const d of dispatches) {
      if (/bump/i.test(d.source)) continue;                         // a manual boost is billed normally
      for (let t = Math.floor(d.from / HH) * HH; t < d.to; t += HH) {
        if (t < a.from || t >= a.to) continue;
        const near = a.rates.unit.filter((r) => r.from < t + 12 * 3600e3 && r.to > t - 12 * 3600e3).map((r) => r.p);
        if (!near.length) continue;
        add.push({ from: t, to: t + HH, p: Math.min(...near), dispatch: true });
      }
    }
    if (add.length) {
      const seen = new Set(add.map((x) => x.from));
      a.rates.unit = [...a.rates.unit.filter((r) => !(r.dispatch && seen.has(r.from))), ...add].sort((x, y) => x.from - y.from);
      n += seen.size;
    }
  }
  return n;
}

/**
 * Hours Ohme charged at about the cheap rate (within 1p a kWh of the lowest nearby rate) that
 * Octopus hasn't confirmed: treated as smart-charge slots, marked as inferred.
 */
function inferFromOhme(ohme, pricing, confirmed) {
  const out = [];
  for (const h of ohme) {
    if (!(h.kwh > 0.2) || !(h.ohmePence > 0)) continue;
    if (confirmed.some((d) => h.t < d.to && h.t + 3600e3 > d.from)) continue;
    const a = pricing.find((p) => h.t >= p.from && h.t < p.to);
    if (!a) continue;
    const near = a.rates.unit.filter((r) => r.from < h.t + 12 * 3600e3 && r.to > h.t - 12 * 3600e3).map((r) => r.p);
    if (!near.length) continue;
    if (h.ohmePence / h.kwh <= Math.min(...near) + 1) out.push({ from: h.t, to: h.t + 3600e3, source: "inferred-from-ohme" });
  }
  return out;
}
