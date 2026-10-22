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

/**
 * With Ohme's hour-by-hour record, the car is what Ohme says it charged: each hour's kWh is shared
 * between its two half-hours by how far each rose above the house's usual, and never more than
 * the meter read. Without Ohme, the meter-only split above is used.
 */
function splitCarWithOhme(elec, ohmeHours) {
  const typical = [];
  for (let s = 0; s < 48; s++) typical[s] = median(elec.filter((r) => r.v < EV_SLOT_KWH && local(r.t).slot === s).map((r) => r.v)) || 0;
  const byT = new Map(elec.map((r) => [r.t, r]));
  const carAt = new Map();
  for (const h of ohmeHours) {
    const start = Math.floor(h.t / HALF_HOUR) * HALF_HOUR;
    const slots = [start, start + HALF_HOUR].map((t) => byT.get(t)).filter(Boolean);
    if (!slots.length) continue;
    const ex = slots.map((r) => Math.max(0, r.v - typical[local(r.t).slot]));
    const total = sum(ex);
    slots.forEach((r, i) => {
      const share = total > 0 ? ex[i] / total : 1 / slots.length;
      carAt.set(r.t, Math.min(r.v, (carAt.get(r.t) || 0) + h.kwh * share));
    });
  }
  const house = [], car = [];
  for (const r of elec) {
    const c = carAt.get(r.t) || 0;
    house.push({ t: r.t, v: r.v - c });
    if (c > 0) car.push({ t: r.t, v: c });
  }
  return { house, car };
}

/** Each half-hour of a day, house and car, for the dashboard's day view (kWh, 0 to 47). */
function dayProfile(house, car, gas, date, split) {
  const on = (rows) => { const a = new Array(48).fill(0); for (const r of rows) { const l = local(r.t); if (l.date === date) a[l.slot] += r.v; } return a.map((x) => round(x, 2)); };
  const out = { house: on(house), car: on(car), gas: on(gas) };
  if (split) { out.gasHeat = split.heat.map((x) => round(x, 2)); out.gasOther = split.other.map((x) => round(x, 2)); }
  return out;
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
const slotOf = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 2 + (m >= 30 ? 1 : 0); };
const inCheap = (slot, w) => { const a = slotOf(w.from), b = slotOf(w.to); return a < b ? slot >= a && slot < b : slot >= a || slot < b; };
const hhmm = (slot) => String(Math.floor(slot / 2)).padStart(2, "0") + ":" + (slot % 2 ? "30" : "00");

/**
 * Splits each half-hour of gas using Tado: if rooms were calling for heat, it goes to them by how
 * hard each was calling; if none were, it's hot water and cooking (a combi with a gas hob can't
 * tell those apart). Hot water drawn while the heating runs counts as heating. Days without Tado
 * data are left out. Unit costs only; standing charges stay with the house.
 */
function splitGas(gasReadings, gasPricing, heatDays) {
  const lookups = gasPricing.map((a) => ({ from: a.from, to: a.to, unit: priceAt(a.rates.unit) }));
  const pence = (t, kwh) => { const a = lookups.find((x) => t >= x.from && t < x.to); const p = a && a.unit(t); return p === undefined ? 0 : kwh * p; };
  const days = {};
  for (const r of gasReadings) {
    const l = local(r.t);
    const heat = heatDays[l.date];
    if (!heat) continue;
    const d = days[l.date] || (days[l.date] = { heatingKwh: 0, heatingPence: 0, otherKwh: 0, otherPence: 0, rooms: {}, heat: new Array(48).fill(0), other: new Array(48).fill(0) });
    const ws = Object.entries(heat).map(([room, w]) => [room, w[l.slot] || 0]).filter(([, w]) => w > 0);
    const total = sum(ws.map(([, w]) => w));
    const p = pence(r.t, r.v);
    if (total > 0) {
      d.heatingKwh += r.v; d.heatingPence += p; d.heat[l.slot] += r.v;
      for (const [room, w] of ws) {
        const x = d.rooms[room] || (d.rooms[room] = { kwh: 0, pence: 0 });
        x.kwh += (r.v * w) / total; x.pence += (p * w) / total;
      }
    } else {
      d.otherKwh += r.v; d.otherPence += p; d.other[l.slot] += r.v;
    }
  }
  // Hot water used while any room calls for heat lands in heating above. Days when no room
  // called at all show the household's own hot water and cooking; on heating days, at least that
  // much is moved back out of heating, taken from the rooms in proportion.
  const quiet = Object.entries(days).filter(([date, d]) => d.heatingKwh === 0 && Object.values(heatDays[date]).every((w) => w.every((x) => !x)));
  const baseline = quiet.length >= 4 ? median(quiet.map(([, d]) => d.otherKwh)) : null;
  for (const d of Object.values(days)) {
    if (baseline === null || d.heatingKwh === 0 || d.otherKwh >= baseline) continue;
    const move = Math.min(baseline - d.otherKwh, d.heatingKwh);
    const movePence = d.heatingPence * (move / d.heatingKwh);
    const keep = 1 - move / d.heatingKwh;
    for (const x of Object.values(d.rooms)) { x.kwh *= keep; x.pence *= keep; }
    d.heatingKwh -= move; d.heatingPence -= movePence; d.otherKwh += move; d.otherPence += movePence;
    d.baselineMovedKwh = move;
  }
  days.__baseline = { kwhPerDay: baseline, quietDays: quiet.length };
  for (const [date, heat] of Object.entries(heatDays)) {
    const d = days[date];
    if (!d) continue;
    for (const [room, w] of Object.entries(heat)) {
      const x = d.rooms[room] || (d.rooms[room] = { kwh: 0, pence: 0 });
      x.hours = w.filter((v) => v > 0).length / 2;
    }
  }
  return days;
}

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
  const ohme = input.ohme?.length ? input.ohme : null;
  const { house, car } = ohme ? splitCarWithOhme(input.elec, ohme) : splitCar(input.elec);
  const gas = gasToKwh(input.gas || []);

  const gasSplit = input.heat ? splitGas(gas.readings, input.gasPricing || [], input.heat) : {};
  const hotWaterBaseline = gasSplit.__baseline || null;
  delete gasSplit.__baseline;
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
      houseUse: gbp(h ? h.pence : 0),
      standing: gbp((h ? h.standing : 0) + (g ? g.standing : 0)),
      car: gbp(c ? c.pence : 0),
      gas: gbp(g ? g.pence : 0),
      houseKwh: round(houseKwh.get(d) || 0, 1),
      carKwh: round(carKwh.get(d) || 0, 1),
      gasKwh: round(gasKwh.get(d) || 0, 1),
      ...(gasSplit[d] ? {
        gasHeating: gbp(gasSplit[d].heatingPence), gasOther: gbp(gasSplit[d].otherPence),
        gasHeatingKwh: round(gasSplit[d].heatingKwh, 1), gasOtherKwh: round(gasSplit[d].otherKwh, 1),
        rooms: Object.fromEntries(Object.entries(gasSplit[d].rooms).map(([k, v]) => [k, { kwh: round(v.kwh, 1), cost: gbp(v.pence), hours: v.hours ?? 0 }])),
      } : {}),
    });
  }
  for (const v of daily.values()) v.total = round(v.house + v.car + v.gas);

  // The most recent Monday to Sunday with every day in.
  const today = local(now).date;
  // The last 7 days with every reading in: usually up to yesterday, but Octopus can be a day or
  // two behind, so it ends on the latest complete day. Any 7 days in a row hold each weekday
  // once, so comparisons with earlier 7-day stretches stay fair. (Named monday for history: it's
  // the first day of the seven.)
  const weekDates = (m) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(m, i));
  let monday = addDays(today, -7);
  for (let i = 0; i < 6; i++) {
    if (weekDates(monday).every((d) => daily.get(d)?.complete)) break;
    monday = addDays(monday, -1);
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

  // A usual day, for the marker on each bar: the same weekday over the previous four weeks
  // (recent, so the weather is similar), house, gas and standing charges, without the car.
  const usualDay = (date) => {
    const same = [1, 2, 3, 4].map((n) => daily.get(addDays(date, -7 * n))).filter((x) => x?.complete);
    return same.length >= 3 ? round(median(same.map((x) => x.house + x.gas))) : null;
  };

  // The last eight 7-day stretches, for the trend.
  const trend = [7, 6, 5, 4, 3, 2, 1, 0].map((n) => {
    const days = weekDates(addDays(monday, -7 * n)).map((x) => daily.get(x));
    if (!days.every((x) => x?.complete)) return null;
    return { from: addDays(monday, -7 * n), total: round(sum(days.map((x) => x.total))), elec: round(sum(days.map((x) => x.houseElec + x.car))), gas: round(sum(days.map((x) => x.gas))), car: round(sum(days.map((x) => x.car))) };
  }).filter(Boolean);

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
    source: ohme ? "Ohme" : "meter",
  };
  if (ohme) {
    const inRange = ohme.filter((h) => h.t >= (input.elec[0]?.t || 0));
    const ohmeMiles = sum(inRange.map((h) => h.km)) * 0.621371;
    carSummary.ohmeKwh = Math.round(sum(inRange.map((h) => h.kwh)));
    carSummary.ohmeMiles = Math.round(ohmeMiles);
    const eff = carEfficiency(inRange, input.carReadings, input.tripMeter);
    const miles = eff ? carSummary.ohmeKwh / eff.kwhPerMile : ohmeMiles;
    carSummary.miles = Math.round(miles);
    carSummary.milesFrom = eff ? eff.from : "Ohme's estimate";
    if (eff) carSummary.efficiency = eff;
    carSummary.pencePerMile = miles > 0 ? round((carSummary.cost * 100) / miles, 1) : null;
    carSummary.ohmeCost = round(sum(inRange.map((h) => h.ohmePence)) / 100);
    carSummary.charges = new Set(inRange.map((h) => local(h.t - 12 * 3600 * 1000).date)).size;
  }

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
  // Each part on its own pace, so the parts add up to the total: electricity used in the house,
  // gas, the car, and standing charges. Gas can be re-projected from the weather forecast later.
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const recent = [...daily.values()].filter((d) => d.complete).slice(-14);
  const left = daysInMonth - monthDays.length;
  const PARTS = { house: "houseUse", heating: "gas", car: "car", standing: "standing" };
  const parts = {};
  for (const [name, field] of Object.entries(PARTS)) {
    const so = sum(monthDays.map((d) => d[field] || 0)), pace = median(recent.map((d) => d[field] || 0)) || 0;
    parts[name] = { soFar: round(so), pace: round(pace), projected: round(so + pace * left) };
  }
  const soFar = round(sum(monthDays.map((d) => d.total)));
  const lastMonthKey = addDays(month + "-01", -1).slice(0, 7);
  const lastMonthDays = [...daily.values()].filter((d) => d.date.startsWith(lastMonthKey));
  const monthName = (m) => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const forecast = {
    month: monthName(month), soFar, projected: round(sum(Object.values(parts).map((p) => p.projected))), parts,
    daysWithData: monthDays.length, daysInMonth, through: monthDays.at(-1)?.date || null, paceDays: recent.length,
    lastMonth: lastMonthDays.length >= 28 ? { month: monthName(lastMonthKey), total: round(sum(lastMonthDays.map((d) => d.total))) } : null,
    gasFrom: "the last fortnight's pace",
  };

  // Moving use out of 4 to 7pm: on their own tariff if it has cheap hours, otherwise on Agile.
  const ownShift = shiftSaving(input.elecPricing, now - 28 * DAY, now);
  const agileAlt = (input.alternatives || []).find((a) => a.label === "Agile");
  const shift = ownShift && ownShift.perKwh >= 5 ? { ...ownShift, tariff: input.currentName, own: true }
    : agileAlt ? { ...shiftSaving(agileAlt.pricing, now - 28 * DAY, now), tariff: "Agile", own: false } : null;

  if (ohme && shift?.own) carSummary.daytimeHours = ohme.filter((h) => h.t >= (input.elec[0]?.t || 0) && !inCheap(local(h.t).slot, shift)).length;
  const overnight = shift && shift.own ? overnightRuns(house, car, now, baseWatts, shift) : null;
  const roomTotals = (dates) => {
    const t = {};
    let heat = 0, other = 0, n = 0;
    for (const date of dates) {
      const s = gasSplit[date];
      if (!s) continue;
      n++; heat += s.heatingPence; other += s.otherPence;
      for (const [room, v] of Object.entries(s.rooms)) {
        const x = t[room] || (t[room] = { kwh: 0, pence: 0, hours: 0 });
        x.kwh += v.kwh; x.pence += v.pence; x.hours += v.hours || 0;
      }
    }
    if (!n) return null;
    return {
      days: n, heating: gbp(heat), hotWaterAndCooking: gbp(other),
      rooms: Object.entries(t).map(([room, v]) => ({ room, cost: gbp(v.pence), kwh: round(v.kwh, 1), hoursPerDay: round(v.hours / n, 1) })).sort((a, b) => b.cost - a.cost),
    };
  };
  const weekRooms = roomTotals(week.map((d) => d.date));
  if (weekRooms && input.roomTemps) {
    for (const r of weekRooms.rooms) {
      const ts = week.map((d) => input.roomTemps[d.date]?.[r.room]).filter(Boolean);
      const t = ts.map((x) => x.temp).filter((x) => x != null), g = ts.map((x) => x.target).filter((x) => x != null);
      r.temp = t.length ? round(sum(t) / t.length, 1) : null;
      r.target = g.length ? round(sum(g) / g.length, 1) : null;
    }
  }
  const heating = Object.keys(gasSplit).length ? {
    week: weekRooms,
    period: roomTotals(Object.keys(gasSplit)),
    baseline: hotWaterBaseline,
    note: "Gas split by when each room called for heat in Tado, weighted by how hard. Gas with no room calling is hot water and cooking. "
      + (hotWaterBaseline?.kwhPerDay != null
        ? `On heating days, at least your usual ${round(hotWaterBaseline.kwhPerDay, 1)} kWh a day of hot water and cooking (the median of ${hotWaterBaseline.quietDays} days with no heating) is counted as such, not as heating.`
        : "Hot water used while the heating runs counts as heating until there are at least four days with no heating to learn your usual amount."),
  } : null;

  const candidates = buildCandidates({ tariff, baseline, peak, carSummary, odd, shift, overnight, heating });

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
      days: week.map((d) => ({ ...d, day: weekdayOf(d.date), odd: oddDates.has(d.date), usual: usualDay(d.date), profile: dayProfile(house, car, gas.readings, d.date, gasSplit[d.date]) })),
    },
    trend,
    odd, baseline, peak, shift, overnight, heating, car: carSummary, tariff, forecast,
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
function buildCandidates({ tariff, baseline, peak, carSummary, odd, shift, overnight, heating }) {
  const out = [];
  if (tariff.best && tariff.best.perYear >= 20) {
    const mine = tariff.rows.find((r) => r.yours);
    out.push({
      id: "tariff",
      per_year_gbp: tariff.best.perYear,
      facts: `Last ${tariff.days} days of half-hourly electricity, re-priced: ${tariff.best.name} £${tariff.rows.find((r) => r.name === tariff.best.name).cost}, ${mine.name} £${mine.cost}. Standing charges included. Car is ${Math.round(carSummary.share * 100)}% of electricity, ${Math.round(carSummary.nightShare * 100)}% of it charged midnight to 5:30am.`
        + (tariff.agileWorstDay && tariff.best.name === "Agile" ? ` Agile's worst day in the period cost £${tariff.agileWorstDay.extra} more than the current tariff.` : ""),
      how_we_know: `Your own meter readings for the last ${tariff.days} days, priced at each tariff's published rates for those days.`,
      card: { figure: `£${tariff.best.perYear} a year`, caption: `by switching to ${tariff.best.name}` },
    });
  }
  if (!tariff.best && tariff.rows.length > 1) {
    const mine = tariff.rows.find((r) => r.yours), next = tariff.rows[1];
    out.push({
      id: "tariff-ok",
      per_year_gbp: 0,
      card: { figure: `£${Math.round(next.cost - mine.cost)} less`, caption: `than ${next.name} over ${tariff.days} days. You're on the cheapest tariff.` },
      facts: `${mine.name} is already the cheapest for how you use electricity: £${Math.round(mine.cost)} over the last ${tariff.days} days, against £${Math.round(next.cost)} on ${next.name}. Nothing to switch.`,
      how_we_know: `Your own meter readings for the last ${tariff.days} days, priced at each tariff's published rates for those days.`,
    });
  }
  if (baseline && baseline.watts >= 200) {
    const cut = Math.min(100, baseline.watts - 100);
    out.push({
      id: "baseline",
      per_year_gbp: Math.round(baseline.per100WPerYear * cut / 100),
      card: { figure: `${baseline.watts} W`, caption: "always on, even at 4am" },
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
      card: { figure: `${Math.round(peak.share * 100)}%`, caption: "of house electricity is used 4 to 7pm" },
      facts: `${Math.round(peak.share * 100)}% of house electricity is used 4 to 7pm (${peak.kwhPerDay} kWh a day), when your tariff is ${shift.perKwh}p per kWh dearer than ${shift.from} to ${shift.to}. Most of this is likely cooking and evening use that can't move; we can't see which appliances it is.`,
      how_we_know: "Your 4 to 7pm use over the last 28 days, and your tariff's prices for the same days.",
    });
  }
  // The other way round: appliance-sized runs already in the cheap hours. Credit them; don't preach.
  if (shift && shift.own && overnight && overnight.nights >= 4) {
    out.push({
      id: "overnight-ok",
      per_year_gbp: 0,
      card: { figure: `£${overnight.perYear} a year`, caption: "saved by running things overnight" },
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
  if (carSummary.source === "Ohme" && carSummary.miles > 0 && carSummary.pencePerMile != null) {
    out.push({
      id: "car-info",
      per_year_gbp: 0,
      card: { figure: `${carSummary.pencePerMile}p`, caption: "a mile to charge the car" },
      facts: `Over the last 90 days the car charged ${carSummary.ohmeKwh} kWh on ${carSummary.charges} days and added about ${carSummary.miles} miles, costing £${carSummary.cost.toFixed(2)} at your tariff's rates: about ${carSummary.pencePerMile}p a mile.`
        + (carSummary.efficiency && Math.abs(carSummary.ohmeMiles - carSummary.miles) > carSummary.miles * 0.15 ? ` Ohme's own estimate was ${carSummary.ohmeMiles} miles, which is too generous for this car.` : "")
        + (carSummary.daytimeHours ? ` ${carSummary.daytimeHours} hours of charging were outside the usual cheap hours; where Octopus confirmed them, or Ohme priced them at the cheap rate, they're counted as Octopus smart-charging at the cheap rate.` : ""),
      how_we_know: "Ohme's own record of each hour's charging, priced at your Octopus rates for those half-hours. Miles from " + carSummary.milesFrom + ".",
    });
  }
  const hw = heating?.week;
  if (hw && hw.rooms.length) {
    const top = hw.rooms.slice(0, 3).map((r) => `${r.room} £${r.cost.toFixed(2)} (${r.hoursPerDay} hours a day)`).join(", ");
    out.push({
      id: "rooms-info",
      per_year_gbp: 0,
      facts: `Gas over the last 7 days: heating £${hw.heating.toFixed(2)}, hot water and cooking £${hw.hotWaterAndCooking.toFixed(2)}. Rooms that cost most to heat: ${top}.`,
      how_we_know: heating.note,
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

/**
 * Wall kWh per mile for the car. Best: the car's own mileage over at least four weeks and 300 miles,
 * against what Ohme put in over the same stretch. Next: the trip meter's average read off the car,
 * plus about 10% lost while charging. Null leaves Ohme's own estimate of miles.
 */
const CHARGING_LOSS = 1.1;
function carEfficiency(hours, readings, trip) {
  const rs = (readings || []).filter((r) => r.t >= (hours[0]?.t ?? Infinity) - 3 * DAY);
  if (rs.length >= 2) {
    const a = rs[0], b = rs[rs.length - 1], driven = b.miles - a.miles;
    const kwh = sum(hours.filter((h) => h.t >= a.t && h.t < b.t).map((h) => h.kwh));
    if (b.t - a.t >= 28 * DAY && driven >= 300 && kwh > 0) {
      return { kwhPerMile: round(kwh / driven, 3), from: `the car's own mileage, ${driven} miles since ${new Date(a.t).toISOString().slice(0, 10)}` };
    }
  }
  if (trip?.kwhPer100mi) {
    return { kwhPerMile: round((trip.kwhPer100mi / 100) * CHARGING_LOSS, 3), from: `the car's trip meter (${trip.kwhPer100mi} kWh per 100 miles over ${trip.overMiles} miles), plus about 10% lost while charging` };
  }
  return null;
}
