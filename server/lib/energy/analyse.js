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

/** A lookup from time to price (pence), for a sorted list of {from, to, p}. */
function priceAt(list) {
  return (t) => {
    let lo = 0, hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = list[mid];
      if (t < r.from) hi = mid - 1;
      else if (t >= r.to) lo = mid + 1;
      else return r.p;
    }
    return undefined;
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

/** Splits electricity into house and car. A car slot keeps that hour's typical house use. */
function splitCar(elec) {
  const typical = [];
  for (let s = 0; s < 48; s++) typical[s] = median(elec.filter((r) => r.v < EV_SLOT_KWH && local(r.t).slot === s).map((r) => r.v)) || 0;
  const house = [], car = [];
  for (const r of elec) {
    if (r.v >= EV_SLOT_KWH) {
      const h = Math.min(r.v, typical[local(r.t).slot]);
      house.push({ t: r.t, v: h });
      car.push({ t: r.t, v: r.v - h });
    } else {
      house.push(r);
    }
  }
  return { house, car };
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
  const earlierWeeks = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => weekDates(addDays(monday, -7 * n)).map((d) => daily.get(d)))
    .filter((w) => w.every((d) => d?.complete)).map((w) => sum(w.map((d) => d.total)));
  const usualWeek = round(median(earlierWeeks));

  // Odd days: well above the same weekday over the previous eight weeks, with the block that did it.
  const odd = [];
  for (const d of week) {
    const same = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => daily.get(addDays(d.date, -7 * n))).filter((x) => x?.complete);
    if (same.length < 3) continue;
    const usual = median(same.map((x) => x.house + x.gas));
    const extra = d.house + d.gas - usual;
    if (extra > Math.max(1.5, 0.35 * usual)) {
      odd.push({ date: d.date, day: longDate(d.date), cost: round(d.house + d.gas), usual: round(usual), extra: round(extra), block: oddBlock(house, d.date, same.map((x) => x.date)) });
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
      row.shiftPerKwh = agileShift(alt.pricing, fitFrom, now);
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.cost - b.cost);
  const best = rows[0];
  const tariff = {
    days: fitDays,
    rows,
    best: best && !best.yours ? { name: best.name, saving: round(mine.cost - best.cost), perYear: Math.round(((mine.cost - best.cost) / Math.max(fitDays, 1)) * 365) } : null,
    agileWorstDay: worstDay,
  };

  // This month so far, and where it's heading on the last fortnight's pace.
  const month = today.slice(0, 7);
  const monthDays = [...daily.values()].filter((d) => d.date.startsWith(month));
  const soFar = round(sum(monthDays.map((d) => d.total)));
  const pace = median([...daily.values()].filter((d) => d.complete).slice(-14).map((d) => d.total));
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const forecast = { month: new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }), soFar, projected: round(soFar + pace * (daysInMonth - monthDays.length)) };

  const candidates = buildCandidates({ tariff, baseline, peak, carSummary, odd });

  return {
    generatedAt: new Date(now).toISOString(),
    week: {
      from: monday, to: addDays(monday, 6),
      label: rangeLabel(monday, addDays(monday, 6)),
      total: weekTotal,
      usual: Number.isFinite(usualWeek) ? usualWeek : null,
      house: round(sum(week.map((d) => d.house))),
      car: round(sum(week.map((d) => d.car))),
      gas: round(sum(week.map((d) => d.gas))),
      days: week.map((d) => ({ ...d, day: weekdayOf(d.date), odd: oddDates.has(d.date) })),
    },
    odd, baseline, peak, car: carSummary, tariff, forecast,
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
  // Trim quiet edges, so the block is when the extra load was actually running.
  const peak = Math.max(...excess.slice(best.from, best.to));
  while (best.from < best.to - 1 && excess[best.from] < 0.3 * peak) best.from++;
  while (best.to > best.from + 1 && excess[best.to - 1] < 0.3 * peak) best.to--;
  best.sum = sum(excess.slice(best.from, best.to));
  const hours = (best.to - best.from) / 2;
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

/** On Agile: what moving one kWh from 4–7pm to 9pm–midnight saves, on average (pence). */
function agileShift(pricing, from, to) {
  const unit = priceAt(pricing[0].rates.unit);
  const peak = [], late = [];
  for (let t = from; t < to; t += HALF_HOUR) {
    const p = unit(t); if (p === undefined) continue;
    const s = local(t).slot;
    if (s >= 32 && s < 38) peak.push(p);
    if (s >= 42) late.push(p);
  }
  return peak.length && late.length ? round(sum(peak) / peak.length - sum(late) / late.length, 1) : null;
}

/** Things worth doing, each already costed. Claude picks and words them; it can't change the sums. */
function buildCandidates({ tariff, baseline, peak, carSummary, odd }) {
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
  if (baseline && baseline.watts >= 200) {
    const cut = Math.min(100, baseline.watts - 100);
    out.push({
      id: "baseline",
      per_year_gbp: Math.round(baseline.per100WPerYear * cut / 100),
      facts: `The house never drops below ${baseline.watts} W, even between 1am and 5am (typical over ${baseline.nights} nights). That always-on use costs about £${baseline.perYear} a year at ${baseline.unitPence}p per kWh. Each 100 W less saves about £${baseline.per100WPerYear} a year.`,
      how_we_know: `The quietest half-hour between 1am and 5am on each of the last ${baseline.nights} nights, with car charging taken out.`,
    });
  }
  const agile = tariff.rows.find((r) => r.name === "Agile");
  if (agile?.shiftPerKwh > 5 && peak.kwhPerDay >= 1) {
    const kwh = Math.min(1, peak.kwhPerDay / 2);
    out.push({
      id: "peak",
      per_year_gbp: Math.round((kwh * agile.shiftPerKwh * 365) / 100),
      facts: `${Math.round(peak.share * 100)}% of house electricity is used 4 to 7pm, ${peak.kwhPerDay} kWh a day. On Agile, 4 to 7pm averaged ${agile.shiftPerKwh}p per kWh more than 9pm to midnight. Moving ${round(kwh, 1)} kWh a day (a dishwasher or dryer run) later saves this, but only on Agile.`,
      how_we_know: "Your 4 to 7pm use over the last 28 days, and Agile's actual prices for the same days.",
    });
  }
  for (const o of odd.slice(0, 2)) {
    out.push({
      id: "odd-" + o.date,
      per_year_gbp: 0,
      facts: `${o.day} cost £${o.cost} against a usual £${o.usual} for that weekday (£${o.extra} more).`
        + (o.block ? ` Something used an extra ${o.block.extraKw} kW from ${o.block.from} to ${o.block.to}.` : ""),
      how_we_know: "Compared with the same weekday over the previous eight weeks, car charging taken out.",
    });
  }
  return out;
}

function rangeLabel(from, to) {
  const f = new Date(from + "T12:00:00Z"), t = new Date(to + "T12:00:00Z");
  const fmt = (d, month) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", ...(month ? { month: "long" } : {}), timeZone: "UTC" });
  return fmt(f, f.getUTCMonth() !== t.getUTCMonth()) + " to " + fmt(t, true);
}
