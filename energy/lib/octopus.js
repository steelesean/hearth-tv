// Octopus Energy's official API: the account, half-hourly consumption and tariff rates.
// OCTOPUS_API_KEY and OCTOPUS_ACCOUNT are set in Vercel (Octopus account > Personal details > API access).

const BASE = "https://api.octopus.energy/v1";

async function get(path, { auth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (auth) headers.Authorization = "Basic " + Buffer.from(process.env.OCTOPUS_API_KEY + ":").toString("base64");
  const url = path.startsWith("http") ? path : BASE + path;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (r.status === 401 || r.status === 403) throw new Error("Octopus didn't accept the API key.");
  if (!r.ok) throw new Error("Octopus said " + r.status + " for " + path.split("?")[0]);
  return r.json();
}

/** Follows Octopus's "next" links until every page is in. */
async function all(path, opts) {
  let out = [];
  let next = path;
  for (let i = 0; next && i < 40; i++) {
    const page = await get(next, opts);
    out = out.concat(page.results || []);
    next = page.next;
  }
  return out;
}

/** The meters we care about: electricity import, and gas if there is any. */
export async function account() {
  const acct = await get("/accounts/" + encodeURIComponent(process.env.OCTOPUS_ACCOUNT) + "/", { auth: true });
  const property = (acct.properties || []).find((p) => !p.moved_out_at) || (acct.properties || [])[0];
  if (!property) throw new Error("No property on this Octopus account.");
  const elec = (property.electricity_meter_points || []).find((m) => !m.is_export);
  const gas = (property.gas_meter_points || [])[0];
  return {
    elec: elec && { id: elec.mpan, serials: (elec.meters || []).map((m) => m.serial_number), agreements: elec.agreements || [] },
    gas: gas && { id: gas.mprn, serials: (gas.meters || []).map((m) => m.serial_number), agreements: gas.agreements || [] },
  };
}

/** Half-hourly readings between two dates, from whichever meter serial has data. */
export async function consumption(kind, point, from, to) {
  const base = kind === "elec" ? "/electricity-meter-points/" : "/gas-meter-points/";
  for (const serial of point.serials) {
    const rows = await all(
      base + point.id + "/meters/" + serial + "/consumption/?page_size=25000&order_by=period" +
        "&period_from=" + from.toISOString() + "&period_to=" + to.toISOString(),
      { auth: true }
    );
    if (rows.length) return rows.map((r) => ({ t: new Date(r.interval_start).getTime(), v: Number(r.consumption) }));
  }
  return [];
}

/** "E-1R-AGILE-24-10-01-C" → "AGILE-24-10-01". */
export function productOf(tariffCode) {
  const parts = tariffCode.split("-");
  return parts.slice(2, -1).join("-");
}

/** Unit rates (pence, inc VAT) and standing charges for a tariff over a period. */
export async function rates(kind, tariffCode, from, to) {
  const product = productOf(tariffCode);
  const base = "/products/" + product + "/" + (kind === "elec" ? "electricity" : "gas") + "-tariffs/" + tariffCode;
  const q = "?page_size=1500&period_from=" + from.toISOString() + "&period_to=" + to.toISOString();
  const [unit, standing] = await Promise.all([all(base + "/standard-unit-rates/" + q), all(base + "/standing-charges/" + q)]);
  const tidy = (list) =>
    list
      .filter((r) => !r.payment_method || r.payment_method === "DIRECT_DEBIT")
      .map((r) => ({ from: new Date(r.valid_from).getTime(), to: r.valid_to ? new Date(r.valid_to).getTime() : Infinity, p: r.value_inc_vat }))
      .sort((a, b) => a.from - b.from);
  return { unit: tidy(unit), standing: tidy(standing) };
}

/** Octopus's current household tariffs that are worth comparing against. */
export async function alternatives() {
  const products = await all("/products/?brand=OCTOPUS_ENERGY&is_business=false&page_size=100");
  const want = [
    ["Agile", /^Agile Octopus/i],
    ["Octopus Go", /^Octopus Go\b/i],
    ["Intelligent Octopus Go", /^Intelligent Octopus Go\b/i],
    ["Flexible Octopus", /^Flexible Octopus\b/i],
    ["Octopus Tracker", /^Octopus Tracker\b/i],
  ];
  const out = [];
  for (const [label, re] of want) {
    const p = products.filter((x) => re.test(x.display_name || "") && (x.direction || "IMPORT") === "IMPORT")
      .sort((a, b) => String(b.available_from).localeCompare(String(a.available_from)))[0];
    if (p) out.push({ label, product: p.code });
  }
  return out;
}

/** A product's everyday name, e.g. "Flexible Octopus October 2025 v1". */
export async function productName(code) {
  try { return (await get("/products/" + code + "/")).display_name || code; } catch { return code; }
}
