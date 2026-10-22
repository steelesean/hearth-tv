// Turns half-hourly readings and tariff rates into the week's facts. Every number Hearth shows
// is calculated here; Claude only puts them into words afterwards.

const TZ = "Europe/London";
const HALF_HOUR = 30 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const EV_SLOT_KWH = 2.5;          // over 5 kW for half an hour is the car, not the house
const GAS_KWH_PER_M3 = 11.22;     // 1.02264 volume correction × 39.5 MJ/m³ ÷ 3.6

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});
const cache = new Map();
/** UK local date, weekday and half-hour slot (0–47) for a timestamp. */
export function local(t) {
  let v = cache.get(t);
  if (v) return v;
  const p = Object.fromEntries(parts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  v = { date: p.year + "-" + p.month + "-" + p.day, weekday: p.weekday, slot: Number(p.hour) * 2 + (Number(p.minute) >= 30 ? 1 : 0) };
  cache.set(t, v);
  return v;
}

const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round = (x, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;
const gbp = (pence) => round(pence / 100);

/**
 * A lookup from time to price (pence), for a list of {from, to, p} sorted by from. Octopus can
 * return overlapping periods for time-of-use tariffs (an all-day rate plus cheap hours), so the
 * shortest period that covers the time wins.
 */
function priceAt(list) {
  const longest = list.reduce((m, r) => Math.max(m, r.to - r.from), 0);
  return (t) => {
    let lo = 0, hi = list.length - 1, last = -1;
    while (lo <= hi) {                       // last entry starting at or before t
      const mid = (lo + hi) >> 1;
      if (list[mid].from <= t) { last = mid; lo = mid + 1; } else hi = mid - 1;
    }
    let best;
    for (let i = last; i >= 0; i--) {
      const r = list[i];
      if (t - r.from > longest) break;       // nothing earlier can reach t
      if (t < r.to && (!best || r.to - r.from < best.to - best.from)) best = r;
    }
    return best?.p;
  };
}

/**
 * Prices readings on a tariff, or on whichever agreement applied at each moment.
 * pricing: [{from, to, rates: {unit, standing}}]. Returns cost per day plus how much was covered.
 */
function price(readings, pricing) {
  const lookups = pricing.map((a) => ({ from: a.from, to: a.to, unit: priceAt(a.rates.unit), standing: priceAt(a.rates.standing) }));
  const find = (t) => lookups.find((a) => t >= a.from && t < a.to);
  const days = new Map();
  let priced = 0;
  for (const r of readings) {
    const a = find(r.t);
    const p = a && a.unit(r.t);
    const d = local(r.t).date;
    if (!days.has(d)) days.set(d, { pence: 0, missing: 0, noon: r.t });
    const day = days.get(d);
    if (p === undefined) { day.missing++; continue; }
    day.pence += r.v * p;
    priced++;
  }
  for (const [d, day] of days) {
    const a = find(day.noon);
    day.standing = (a && a.standing(day.noon)) || 0;
  }
  return { days, coverage: readings.length ? priced / readings.length : 0 };
}

/**
 * Splits electricity into house and car. A half-hour over 5 kW is the car; so is a smaller one
 * next to it that's still 2 kW above the house's usual for that time (the start and end of a
 * charge, or a short smart-charging burst). A car half-hour keeps that time's typical house use.
 */
function splitCar(elec) {
  const typical = [];
  for (let s = 0; s < 48; s++) typical[s] = median(elec.filter((r) => r.v < EV_SLOT_KWH && local(r.t).slot === s).map((r) => r.v)) || 0;
  const rows = [...elec].sort((a, b) => a.t - b.t);
  const isCar = rows.map((r) => r.v >= EV_SLOT_KWH);
  const above = (i) => rows[i].v - typical[local(rows[i].t).slot] >= 1.0;
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < rows.length; i++) {
      if (isCar[i] || !above(i)) continue;
      const next = (j) => j >= 0 && j < rows.length && isCar[j] && Math.abs(rows[j].t - rows[i].t) === HALF_HOUR;
      if (next(i - 1) || next(i + 1)) { isCar[i] = true; changed = true; }
    }
  }
  const house = [], car = [];
  rows.forEach((r, i) => {
    if (isCar[i]) {
      const h = Math.min(r.v, typical[local(r.t).slot]);
      house.push({ t: r.t, v: h });
      car.push({ t: r.t, v: r.v - h });
    } else {
      house.push(r);
    }
  });
  return { house, car };
}

/** Each half-hour of a day, house and car, for the dashboard's day view (kWh, 0 to 47). */
function dayProfile(house, car, date) {
  const h = new Array(48).fill(0), c = new Array(48).fill(0);
  for (const r of house) { const l = local(r.t); if (l.date === date) h[l.slot] += r.v; }
  for (const r of car) { const l = local(r.t); if (l.date === date) c[l.slot] += r.v; }
  return { house: h.map((x) => round(x, 2)), car: c.map((x) => round(x, 2)) };
}

/** Gas meters report m³ or kWh. A day over 15 can only be kWh. GAS_UNITS overrides. */
function gasToKwh(gas) {
  const forced = (process.env.GAS_UNITS || "").toLowerCase();
  const daily = new Map();
  for (const r of gas) { const d = local(r.t).date; daily.set(d, (daily.get(d) || 0) + r.v); }
  const isKwh = forced ? forced === "kwh" : Math.max(0, ...daily.values()) > 15;
  return { readings: isKwh ? gas : gas.map((r) => ({ t: r.t, v: r.v * GAS_KWH_PER_M3 })), unit: isKwh ? "kWh" : "m³" };
}

function byDay(readings) {
  const m = new Map();
  for (const r of readings) { const d = local(r.t).date; m.set(d, (m.get(d) || 0) + r.v); }
  return m;
}

const addDays = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const weekdayOf = (date) => new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const longDate = (date) => new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const hhmm = (slot) => String(Math.floor(slot / 2)).padStart(2, "0") + ":" + (slot % 2 ? "30" : "00");

/**
 * input: {
 *   elec: [{t, v}], gas: [{t, v}],
 *   elecPricing, gasPricing: [{from, to, rates}],   the household's own agreements
 *   currentName: "Flexible Octopus",
 *   alternatives: [{label, pricing}],                electricity only
 *   now: ms
 * }
 */
export function analyse(input) {
  const now = input.now || Date.now();
  const { house, car } = splitCar(input.elec);
  const gas = gasToKwh(input.gas || []);

  const housePriced = price(house, input.elecPricing);
  const carPriced = price(car, input.elecPricing);
  const gasPriced = gas.readings.length ? price(gas.readings, input.gasPricing || []) : { days: new Map() };
  const houseKwh = byDay(house), carKwh = byDay(car), gasKwh = byDay(gas.readings);
  const slotsPerDay = new Map();
  for (const r of input.elec) { const d = local(r.t).date; slotsPerDay.set(d, (slotsPerDay.get(d) || 0) + 1); }

  // Cost of each day: house includes both standing charges, so car and gas are just their units.
  const allDates = [...slotsPerDay.keys()].sort();
  const daily = new Map();
  for (const d of allDates) {
    const h = housePriced.days.get(d), c = carPriced.days.get(d), g = gasPriced.days.get(d);
    const housePence = (h ? h.pence + h.standing : 0) + (g ? g.standing : 0);
    daily.set(d, {
      date: d,
      complete: slotsPerDay.get(d) >= 46,
      house: gbp(housePence),
      houseElec: gbp(h ? h.pence + h.standing : 0),
      car: gbp(c ? c.pence : 0),
      gas: gbp(g ? g.pence : 0),
      houseKwh: round(houseKwh.get(d) || 0, 1),
      carKwh: round(carKwh.get(d) || 0, 1),
      gasKwh: round(gasKwh.get(d) || 0, 1),
    });
  }
  for (const v of daily.values()) v.total = round(v.house + v.car + v.gas);

  // The most recent Monday to Sunday with every day in.
  const today = local(now).date;
  let monday = addDays(today, -((["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekdayOf(today)) + 7) % 7));
  const weekDates = (m) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(m, i));
  for (let i = 0; i < 3; i++) {
    monday = addDays(monday, -7);
    if (weekDates(monday).every((d) => daily.get(d)?.complete)) break;
  }
  const week = weekDates(monday).map((d) => daily.get(d)).filter(Boolean);
  const weekTotal = round(sum(week.map((d) => d.total)));
  // "Usual" is electricity only: gas follows the weather, and we don't have the weather yet.
  const weekElec = round(sum(week.map((d) => d.houseElec + d.car)));
  const earlierWeeks = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => weekDates(addDays(monday, -7 * n)).map((d) => daily.get(d)))
    .filter((w) => w.every((d) => d?.complete)).map((w) => sum(w.map((d) => d.houseElec + d.car)));
  const usualWeek = round(median(earlierWeeks));

  // Odd days: house electricity well above the same weekday over the previous eight weeks,
  // with the block that did it. Gas is left out until it can be adjusted for the weather.
  const odd = [];
  for (const d of week) {
    const same = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => daily.get(addDays(d.date, -7 * n))).filter((x) => x?.complete);
    if (same.length < 3) continue;
    const usualKwh = median(same.map((x) => x.houseKwh));
    if (d.houseKwh - usualKwh > Math.max(3, 0.35 * usualKwh)) {
      const usual = median(same.map((x) => x.houseElec));
      odd.push({
        date: d.date, day: longDate(d.date),
        kwh: d.houseKwh, usualKwh: round(usualKwh, 1), extraKwh: round(d.houseKwh - usualKwh, 1),
        cost: d.houseElec, usual: round(usual), extra: round(d.houseElec - usual),
        block: oddBlock(house, d.date, same.map((x) => x.date)),
      });
    }
  }
  const oddDates = new Set(odd.map((o) => o.date));

  // Always-on: the lowest house half-hour between 1am and 5am, typical over the last 28 nights.
  const nights = new Map();
  for (const r of house) {
    if (r.t < now - 28 * DAY) continue;
    const l = local(r.t);
    if (l.slot < 2 || l.slot >= 10) continue;
    nights.set(l.date, Math.min(nights.get(l.date) ?? Infinity, r.v));
  }
  const baseWatts = Math.round(median([...nights.values()]) * 2 * 1000);
  const recentUnit = averageUnitPence(input.elecPricing, now);
  const baseline = Number.isFinite(baseWatts) ? {
    watts: baseWatts,
    nights: nights.size,
    perYear: Math.round((baseWatts / 1000) * 8760 * recentUnit / 100),
    per100WPerYear: Math.round(0.1 * 8760 * recentUnit / 100),
    unitPence: round(recentUnit, 1),
  } : null;

  // 4 to 7pm: the share of house electricity used then.
  const last28 = house.filter((r) => r.t >= now - 28 * DAY);
  const peakKwh = sum(last28.filter((r) => { const s = local(r.t).slot; return s >= 32 && s < 38; }).map((r) => r.v));
  const peak = { share: round(peakKwh / (sum(last28.map((r) => r.v)) || 1), 2), kwhPerDay: round(peakKwh / 28, 1) };

  // Car: share of electricity over the whole period.
  const carTotalKwh = sum(car.map((r) => r.v)), elecTotalKwh = sum(input.elec.map((r) => r.v));
  const carSlots = car.filter((r) => r.v > 0).map((r) => local(r.t).slot);
  const nightCharging = carSlots.filter((s) => s < 11 || s >= 47).length / (carSlots.length || 1);
  const carSummary = {
    share: round(carTotalKwh / (elecTotalKwh || 1), 2),
    kwh: Math.round(carTotalKwh),
    cost: round(sum([...carPriced.days.values()].map((d) => d.pence)) / 100),
    nightShare: round(nightCharging, 2),
    nightsCharged: new Set(car.filter((r) => r.v > 0).map((r) => local(r.t - 12 * 3600 * 1000).date)).size,
  };

  // Tariff fit: the same half-hours, re-priced on each tariff. Standing charges included.
  const fitFrom = now - 90 * DAY;
  const fitElec = input.elec.filter((r) => r.t >= fitFrom);
  const fitDays = new Set(fitElec.map((r) => local(r.t).date)).size;
  const tariffCost = (pricing) => {
    const p = price(fitElec, pricing);
    return { cost: round(sum([...p.days.values()].map((d) => d.pence + d.standing)) / 100), coverage: p.coverage, days: p.days };
  };
  const mine = tariffCost(input.elecPricing);
  // Any half-hours Octopus had no price for are filled at the tariff's own average, as for the
  // alternatives below; the workings show how much that was.
  // Only small gaps are filled; with more missing, the figures are flagged and no advice is given.
  const priced = mine.coverage >= 0.95;
  if (priced && mine.coverage < 1) mine.cost = round(mine.cost / mine.coverage);
  const rows = [{ name: input.currentName || "Your tariff", cost: mine.cost, yours: true }];
  let worstDay = null;
  for (const alt of input.alternatives || []) {
    const t = tariffCost(alt.pricing);
    if (t.coverage < 0.8) continue;                        // too little price history to be fair
    const scale = 1 / t.coverage;                          // fill small gaps at that tariff's average
    const row = { name: alt.label, cost: round(t.cost * scale) };
    if (alt.label === "Agile") {
      let worst = { extra: -Infinity };
      for (const [d, v] of t.days) {
        const m = mine.days.get(d);
        if (m) { const extra = (v.pence + v.standing - m.pence - m.standing) / 100; if (extra > worst.extra) worst = { date: d, extra: round(extra) }; }
      }
      if (worst.date) worstDay = worst;
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.cost - b.cost);
  const best = rows[0];
  const tariff = {
    days: fitDays,
    coverage: round(mine.coverage, 3),
    rows,
    incomplete: !priced,
    best: priced && best && !best.yours ? { name: best.name, saving: round(mine.cost - best.cost), perYear: Math.round(((mine.cost - best.cost) / Math.max(fitDays, 1)) * 365) } : null,
    agileWorstDay: worstDay,
  };

  // This month so far, and where it's heading on the last fortnight's pace.
  const month = today.slice(0, 7);
  const monthDays = [...daily.values()].filter((d) => d.date.startsWith(month));
  const soFar = round(sum(monthDays.map((d) => d.total)));
  const pace = median([...daily.values()].filter((d) => d.complete).slice(-14).map((d) => d.total));
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const forecast = { month: new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }), soFar, projected: round(soFar + pace * (daysInMonth - monthDays.length)) };

  // Moving use out of 4 to 7pm: on their own tariff if it has cheap hours, otherwise on Agile.
  const ownShift = shiftSaving(input.elecPricing, now - 28 * DAY, now);
  const agileAlt = (input.alternatives || []).find((a) => a.label === "Agile");
  const shift = ownShift && ownShift.perKwh >= 5 ? { ...ownShift, tariff: input.currentName, own: true }
    : agileAlt ? { ...shiftSaving(agileAlt.pricing, now - 28 * DAY, now), tariff: "Agile", own: false } : null;

  const overnight = shift && shift.own ? overnightRuns(house, car, now, baseWatts, shift) : null;
  const candidates = buildCandidates({ tariff, baseline, peak, carSummary, odd, shift, overnight });

  return {
    generatedAt: new Date(now).toISOString(),
    week: {
      from: monday, to: addDays(monday, 6),
      label: rangeLabel(monday, addDays(monday, 6)),
      total: weekTotal,
      elec: weekElec,
      usualElec: Number.isFinite(usualWeek) ? usualWeek : null,
      house: round(sum(week.map((d) => d.house))),
      car: round(sum(week.map((d) => d.car))),
      gas: round(sum(week.map((d) => d.gas))),
      days: week.map((d) => ({ ...d, day: weekdayOf(d.date), odd: oddDates.has(d.date), profile: dayProfile(house, car, d.date) })),
    },
    odd, baseline, peak, shift, overnight, car: carSummary, tariff, forecast,
    gasUnits: gas.unit,
    hasGas: gas.readings.length > 0,
    candidates,
  };
}

/** The contiguous stretch of the day that ran furthest above that half-hour's usual use. */
function oddBlock(house, date, compareDates) {
  const on = (d) => { const a = new Array(48).fill(0); for (const r of house) { const l = local(r.t); if (l.date === d) a[l.slot] += r.v; } return a; };
  const day = on(date);
  const others = compareDates.map(on);
  const excess = day.map((v, s) => v - median(others.map((o) => o[s])));
  let best = { sum: 0 }, cur = 0, start = 0;
  excess.forEach((x, s) => {
    if (cur <= 0) { cur = 0; start = s; }
    cur += x;
    if (cur > best.sum) best = { sum: cur, from: start, to: s + 1 };
  });
  if (!best.to || best.sum < 0.5) return null;
  const spread = () => ({ spread: true, extraKwh: round(sum(excess.filter((x) => x > 0)), 1) });
  // Trim quiet edges, so the block is when the extra load was actually running.
  const peak = Math.max(...excess.slice(best.from, best.to));
  while (best.from < best.to - 1 && excess[best.from] < 0.3 * peak) best.from++;
  while (best.to > best.from + 1 && excess[best.to - 1] < 0.3 * peak) best.to--;
  best.sum = sum(excess.slice(best.from, best.to));
  const hours = (best.to - best.from) / 2;
  if (hours > 6 || best.sum / hours < 0.5) return spread();   // small and all day: no one culprit
  return { from: hhmm(best.from), to: hhmm(best.to % 48), extraKwh: round(best.sum, 1), extraKw: round(best.sum / hours, 1) };
}

/** Average unit price across the household's last 30 days, for costing the always-on load. */
function averageUnitPence(pricing, now) {
  const xs = [];
  for (let t = now - 30 * DAY; t < now; t += HALF_HOUR) {
    const a = pricing.find((p) => t >= p.from && t < p.to);
    const v = a && priceAt(a.rates.unit)(t);
    if (v !== undefined) xs.push(v);
  }
  return xs.length ? sum(xs) / xs.length : 25;
}

/**
 * What moving one kWh out of 4 to 7pm saves, on average (pence): against the cheapest
 * three hours of the day on this tariff, outside 4 to 7pm. Null if the prices are missing.
 */
function shiftSaving(pricing, from, to) {
  const bySlot = Array.from({ length: 48 }, () => []);
  for (let t = from; t < to; t += HALF_HOUR) {
    const a = pricing.find((p) => t >= p.from && t < p.to);
    const p = a && priceAt(a.rates.unit)(t);
    if (p !== undefined) bySlot[local(t).slot].push(p);
  }
  const avg = bySlot.map((xs) => (xs.length ? sum(xs) / xs.length : NaN));
  const peak = avg.slice(32, 38);
  if (peak.some((x) => !Number.isFinite(x))) return null;
  let best = null;
  for (let s = 0; s < 48; s++) {
    const win = [0, 1, 2, 3, 4, 5].map((i) => (s + i) % 48);
    if (win.some((x) => x >= 32 && x < 38) || win.some((x) => !Number.isFinite(avg[x]))) continue;
    const mean = sum(win.map((x) => avg[x])) / 6;
    if (!best || mean < best.mean) best = { mean, from: s };
  }
  if (!best) return null;
  // Widen to the whole cheap stretch around it (within 1p of the cheapest), e.g. 23:30 to 05:30.
  const cheap = (x) => Number.isFinite(avg[x]) && avg[x] <= best.mean + 1 && !(x >= 32 && x < 38);
  let a = best.from, b = (best.from + 6) % 48, n = 6;
  while (n < 40 && cheap((a + 47) % 48)) { a = (a + 47) % 48; n++; }
  while (n < 40 && cheap(b)) { b = (b + 1) % 48; n++; }
  return { perKwh: round(sum(peak) / 6 - best.mean, 1), from: hhmm(a), to: hhmm(b), cheapPence: round(best.mean, 1) };
}

/**
 * Nights with an appliance-sized run (0.6 to 2.5 kWh a half-hour above always-on, so not the
 * car) in the tariff's cheap window. Returns how often, how big, and what it saves a year.
 */
function overnightRuns(house, car, now, baseWatts, shift) {
  // Half-hours next to car charging are the start or end of a charge, not an appliance.
  const nearCar = new Set();
  for (const r of car) if (r.v > 0) for (const d of [-1, 0, 1]) nearCar.add(r.t + d * HALF_HOUR);
  const base = (Number.isFinite(baseWatts) ? baseWatts : 200) / 2000;   // kWh per half-hour
  const [fh, fm] = shift.from.split(":").map(Number), [th, tm] = shift.to.split(":").map(Number);
  const fromSlot = fh * 2 + (fm ? 1 : 0), toSlot = th * 2 + (tm ? 1 : 0);
  const inWindow = (s) => (fromSlot < toSlot ? s >= fromSlot && s < toSlot : s >= fromSlot || s < toSlot);
  const nights = new Map();
  for (const r of house) {
    if (r.t < now - 28 * DAY) continue;
    const l = local(r.t);
    if (!inWindow(l.slot) || nearCar.has(r.t)) continue;
    const extra = r.v - base;
    if (extra < 0.6) continue;
    const night = local(r.t - 12 * 3600 * 1000).date;
    nights.set(night, (nights.get(night) || 0) + extra);
  }
  if (!nights.size) return null;
  const kwh = median([...nights.values()]);
  const slots = Math.max(1, Math.round(kwh / 0.9));
  return {
    nights: nights.size,
    kwhPerRun: round(kwh, 1),
    kw: round(kwh / (slots / 2), 1),
    minutes: slots * 30,
    perYear: Math.round((kwh * shift.perKwh * (nights.size / 28) * 365) / 100),
  };
}

/** Things worth doing, each already costed. Claude picks and words them; it can't change the sums. */
function buildCandidates({ tariff, baseline, peak, carSummary, odd, shift, overnight }) {
  const out = [];
  if (tariff.best && tariff.best.perYear >= 20) {
    const mine = tariff.rows.find((r) => r.yours);
    out.push({
      id: "tariff",
      per_year_gbp: tariff.best.perYear,
      facts: `Last ${tariff.days} days of half-hourly electricity, re-priced: ${tariff.best.name} £${tariff.rows.find((r) => r.name === tariff.best.name).cost}, ${mine.name} £${mine.cost}. Standing charges included. Car is ${Math.round(carSummary.share * 100)}% of electricity, ${Math.round(carSummary.nightShare * 100)}% of it charged midnight to 5:30am.`
        + (tariff.agileWorstDay && tariff.best.name === "Agile" ? ` Agile's worst day in the period cost £${tariff.agileWorstDay.extra} more than the current tariff.` : ""),
      how_we_know: `Your own meter readings for the last ${tariff.days} days, priced at each tariff's published rates for those days.`,
    });
  }
  if (!tariff.best && tariff.rows.length > 1) {
    const mine = tariff.rows.find((r) => r.yours), next = tariff.rows[1];
    out.push({
      id: "tariff-ok",
      per_year_gbp: 0,
      facts: `${mine.name} is already the cheapest for how you use electricity: £${Math.round(mine.cost)} over the last ${tariff.days} days, against £${Math.round(next.cost)} on ${next.name}. Nothing to switch.`,
      how_we_know: `Your own meter readings for the last ${tariff.days} days, priced at each tariff's published rates for those days.`,
    });
  }
  if (baseline && baseline.watts >= 200) {
    const cut = Math.min(100, baseline.watts - 100);
    out.push({
      id: "baseline",
      per_year_gbp: Math.round(baseline.per100WPerYear * cut / 100),
      facts: `The house never drops below ${baseline.watts} W, even between 1am and 5am (typical over ${baseline.nights} nights). That always-on use costs about £${baseline.perYear} a year at ${baseline.unitPence}p per kWh. Each 100 W less saves about £${baseline.per100WPerYear} a year.`,
      how_we_know: `The quietest half-hour between 1am and 5am on each of the last ${baseline.nights} nights, with car charging taken out.`,
    });
  }
  // 4 to 7pm is mostly cooking, lights and TV, which can't move. Half-hourly readings can't tell
  // a dishwasher from an oven, so this is information, never an instruction.
  if (shift && shift.own && shift.perKwh > 5 && peak.kwhPerDay >= 1) {
    out.push({
      id: "peak-info",
      per_year_gbp: 0,
      facts: `${Math.round(peak.share * 100)}% of house electricity is used 4 to 7pm (${peak.kwhPerDay} kWh a day), when your tariff is ${shift.perKwh}p per kWh dearer than ${shift.from} to ${shift.to}. Most of this is likely cooking and evening use that can't move; we can't see which appliances it is.`,
      how_we_know: "Your 4 to 7pm use over the last 28 days, and your tariff's prices for the same days.",
    });
  }
  // The other way round: appliance-sized runs already in the cheap hours. Credit them; don't preach.
  if (shift && shift.own && overnight && overnight.nights >= 4) {
    out.push({
      id: "overnight-ok",
      per_year_gbp: 0,
      facts: `On ${overnight.nights} of the last 28 nights something drew about ${overnight.kw} kW for ${overnight.minutes} minutes between ${shift.from} and ${shift.to}, not the car: most likely an appliance on a timer. Run then rather than 4 to 7pm, that already saves about £${overnight.perYear} a year.`,
      how_we_know: "Overnight half-hours well above your always-on use but too small to be the car, over the last 28 nights.",
    });
  }
  for (const o of odd.slice(0, 2)) {
    out.push({
      id: "odd-" + o.date,
      per_year_gbp: 0,
      facts: `${o.day}: the house used ${o.kwh} kWh of electricity against a usual ${o.usualKwh} kWh for that weekday, £${o.extra} more.`
        + (o.block?.spread ? " The extra was spread thinly across the day, with no one stretch standing out." : o.block ? ` Something used an extra ${o.block.extraKw} kW from ${o.block.from} to ${o.block.to}.` : ""),
      how_we_know: "Electricity compared with the same weekday over the previous eight weeks, car charging taken out.",
    });
  }
  // Odd days are measured in kWh, so they stand; anything costed waits for complete prices.
  return tariff.incomplete ? out.filter((c) => c.id.startsWith("odd-")) : out;
}

function rangeLabel(from, to) {
  const f = new Date(from + "T12:00:00Z"), t = new Date(to + "T12:00:00Z");
  const fmt = (d, month) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", ...(month ? { month: "long" } : {}), timeZone: "UTC" });
  return fmt(f, f.getUTCMonth() !== t.getUTCMonth()) + " to " + fmt(t, true);
}
