// Heating efficiency before and after a change to the house (here, the roof insulation).
// Gas used each day against how cold it was that day: kWh of gas per "degree day" (how far the
// day's average temperature fell below 15.5°C). A colder spell uses more gas whatever the house
// is like, so this compares the house, not the weather. Daily temperatures come from Open-Meteo's
// free weather archive for the home's postcode (looked up with postcodes.io).

import * as octopus from "./octopus.js";
import { local } from "./analyse.js";

export const CHANGE = { what: "roof insulation", from: "2026-01-01", to: "2026-01-31" };   // the work, January
const BASE_C = 15.5;            // UK convention: below this, a house needs heating
const HEATING_DAY = 2;          // degree days; milder days are mostly hot water and noise
const MIN_DAYS = 30;
const GAS_KWH_PER_M3 = 11.22;
const DAY = 24 * 60 * 60 * 1000;
const round = (x, dp = 1) => Math.round(x * 10 ** dp) / 10 ** dp;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(new URL(url).hostname + " said " + r.status);
  return r.json();
}

async function place(postcode) {
  const j = await json("https://api.postcodes.io/postcodes/" + encodeURIComponent(postcode));
  return { lat: j.result.latitude, lon: j.result.longitude, area: j.result.admin_district };
}

/** Average temperature for each day: the archive, topped up with the last fortnight. */
async function temperatures({ lat, lon }, from, to) {
  const q = "latitude=" + lat + "&longitude=" + lon + "&daily=temperature_2m_mean&timezone=Europe%2FLondon";
  const [arch, recent] = await Promise.all([
    json("https://archive-api.open-meteo.com/v1/archive?" + q + "&start_date=" + from + "&end_date=" + to),
    json("https://api.open-meteo.com/v1/forecast?" + q + "&past_days=14&forecast_days=16").catch(() => null),
  ]);
  const t = new Map();
  for (const src of [arch, recent]) (src?.daily?.time || []).forEach((d, i) => { const v = src.daily.temperature_2m_mean[i]; if (v != null && !t.has(d)) t.set(d, v); });
  return t;
}

/** Straight line through (degree days, gas): base load plus kWh per degree day. */
function fit(days) {
  const n = days.length, mx = sum(days.map((d) => d.dd)) / n, my = sum(days.map((d) => d.kwh)) / n;
  const sxx = sum(days.map((d) => (d.dd - mx) ** 2)), sxy = sum(days.map((d) => (d.dd - mx) * (d.kwh - my)));
  const slope = sxy / sxx, base = my - slope * mx;
  const ssr = sum(days.map((d) => (d.kwh - (base + slope * d.dd)) ** 2)), sst = sum(days.map((d) => (d.kwh - my) ** 2));
  return { slope, base, r2: 1 - ssr / sst };
}

const describe = (days, f) => ({
  from: days[0].date, to: days[days.length - 1].date, days: days.length,
  kwhPerDegreeDay: round(f.slope, 2), baseKwh: round(f.base, 1), fit: round(f.r2, 2),
  meanTemp: round(sum(days.map((d) => d.temp)) / days.length),
});

/**
 * Before and after the change, from as much gas history as Octopus holds (asks for two years).
 * gasPence: today's gas unit rate, to put the difference in pounds.
 */
export async function heatingEfficiency(meters, gasPence, now = Date.now(), unit = null) {
  if (!meters.gas) return { available: false, reason: "No gas meter on this account." };
  if (!meters.postcode) return { available: false, reason: "Octopus didn't give the home's postcode, so there's no local weather." };
  const from = new Date(now - 730 * DAY);
  const [rows, where] = await Promise.all([octopus.consumption("gas", meters.gas, from, new Date(now), "day"), place(meters.postcode)]);
  if (!rows.length) return { available: false, reason: "Octopus has no daily gas readings." };

  const gas = new Map();
  for (const r of rows) { const d = local(r.t).date; gas.set(d, (gas.get(d) || 0) + r.v); }
  // Same units as the main analysis (m³ or kWh). Failing that, a typical day: a few m³, or tens of kWh.
  const forced = (process.env.GAS_UNITS || "").toLowerCase();
  const typical = [...gas.values()].sort((a, b) => a - b)[gas.size >> 1];
  const isKwh = forced ? forced === "kwh" : unit ? unit === "kWh" : typical > 8;
  const dates = [...gas.keys()].sort();
  const temps = await temperatures(where, dates[0], local(now - DAY).date);

  const all = dates.filter((d) => temps.has(d) && gas.get(d) > 0).map((d) => {
    const temp = temps.get(d);
    return { date: d, temp, dd: Math.max(0, BASE_C - temp), kwh: gas.get(d) * (isKwh ? 1 : GAS_KWH_PER_M3) };
  });
  const heating = all.filter((d) => d.dd >= HEATING_DAY);
  const before = heating.filter((d) => d.date < CHANGE.from), after = heating.filter((d) => d.date > CHANGE.to);
  const out = {
    available: false, change: CHANGE, unit: isKwh ? "kWh" : "m³, converted to kWh", area: where.area, historyFrom: dates[0],
    heatingDays: { before: before.length, after: after.length },
  };
  if (before.length < MIN_DAYS || after.length < MIN_DAYS) {
    out.reason = before.length < MIN_DAYS
      ? `Octopus's gas history starts ${dates[0]}, which leaves ${before.length} cold days before the ${CHANGE.what}; it needs ${MIN_DAYS}.`
      : `Only ${after.length} cold days since the ${CHANGE.what} so far; it needs ${MIN_DAYS}.`;
    return out;
  }
  const fb = fit(before), fa = fit(after);
  out.available = true;
  out.before = describe(before, fb);
  out.after = describe(after, fa);
  out.change.pct = round(((fa.slope - fb.slope) / fb.slope) * 100, 0);
  const pts = (days) => days.map((d) => [round(d.dd), round(d.kwh)]);
  out.points = { before: pts(before), after: pts(after) };

  // The same weather both ways: this year's cold days so far this season, as the house was before.
  const seasonStart = local(now).date.slice(0, 4) + "-09-01";
  const season = after.filter((d) => d.date >= seasonStart);
  if (season.length >= 7) {
    const actual = sum(season.map((d) => d.kwh)), wouldHave = sum(season.map((d) => fb.base + fb.slope * d.dd));
    out.thisSeason = {
      from: season[0].date, days: season.length, actualKwh: Math.round(actual), beforeKwh: Math.round(wouldHave),
      savedKwh: Math.round(wouldHave - actual), savedPct: round(((wouldHave - actual) / wouldHave) * 100, 0),
      savedGbp: gasPence ? round(((wouldHave - actual) * gasPence) / 100, 0) : null,
    };
  }
  // A year's worth: the last twelve months' cold, at the difference in gas per degree day.
  const yearDd = sum(heating.filter((d) => d.date >= local(now - 365 * DAY).date).map((d) => d.dd));
  out.perYear = { degreeDays: Math.round(yearDd), kwh: Math.round((fb.slope - fa.slope) * yearDd) };
  if (gasPence) out.perYear.gbp = Math.round((out.perYear.kwh * gasPence) / 100);
  out.gasPence = gasPence ? round(gasPence, 2) : null;
  // The days ahead, for the month forecast: forecast temperatures and the gas this house needs for them.
  const today = local(now).date;
  out.ahead = [...temps].filter(([d]) => d >= today).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, temp]) => {
    const dd = Math.max(0, BASE_C - temp);
    return { date, temp: round(temp), kwh: round(dd >= HEATING_DAY ? fa.base + fa.slope * dd : Math.max(0, fa.base)) };
  });
  return out;
}
