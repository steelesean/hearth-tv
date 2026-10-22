// The whole refresh: read Octopus, calculate, ask Claude to explain, store.

import * as octopus from "./octopus.js";
import { analyse } from "./analyse.js";
import { weeklyNote, plainNote } from "./note.js";
import { loadFeedback } from "./store.js";

const QUIET_FOR = 90 * 24 * 60 * 60 * 1000;   // a dismissed suggestion stays away this long

const DAY = 24 * 60 * 60 * 1000;

/** Rates for each agreement that overlaps the window. */
async function pricingFor(kind, agreements, from, to) {
  const out = [];
  for (const a of agreements) {
    const af = Math.max(from, a.valid_from ? Date.parse(a.valid_from) : 0);
    const at = Math.min(to, a.valid_to ? Date.parse(a.valid_to) : Infinity);
    if (af >= at) continue;
    out.push({ from: af, to: at, code: a.tariff_code, rates: await octopus.rates(kind, a.tariff_code, new Date(af), new Date(at)) });
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
  const current = elecPricing[elecPricing.length - 1];
  const region = current.code.slice(-1);
  const currentProduct = octopus.productOf(current.code);

  const options = (await octopus.alternatives()).filter((o) => o.product !== currentProduct);
  const alternatives = (await Promise.all(options.map(async (o) => {
    const code = "E-1R-" + o.product + "-" + region;
    try { return { label: o.label, pricing: [{ from, to, code, rates: await octopus.rates("elec", code, new Date(from), new Date(to)) }] }; }
    catch { return null; }
  }))).filter(Boolean);

  const facts = analyse({
    elec, gas, elecPricing, gasPricing, alternatives, now,
    currentName: "Your tariff (" + shortName(await octopus.productName(currentProduct)) + ")",
  });
  // Leave out anything the household said they already do, or that isn't for them.
  const feedback = await loadFeedback().catch(() => ({}));
  facts.dismissed = facts.candidates.filter((c) => feedback[c.id] && now - Date.parse(feedback[c.id].at) < QUIET_FOR).map((c) => c.id);
  facts.candidates = facts.candidates.filter((c) => !facts.dismissed.includes(c.id));
  let note = null;
  try { note = await weeklyNote(facts); } catch (e) { console.error("Note failed:", e.message); }
  facts.note = note || plainNote(facts);
  facts.source = { elecDays: Math.round(elec.length / 48), gasDays: gas.length ? Math.round(gas.length / 48) : 0, alternativesPriced: alternatives.map((a) => a.label) };
  return facts;
}

/** "Flexible Octopus October 2025 v1" → "Flexible Octopus". */
function shortName(name) {
  return String(name).replace(/\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b.*$/i, "").replace(/\s+v\d+$/i, "").trim();
}
