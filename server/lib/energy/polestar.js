// Polestar: the car's own mileage, so cost per mile uses miles actually driven, not an estimate.
// Unofficial: the same sign-in and GraphQL calls the Home Assistant integration uses (pypolestar).
// Signed in once from the phone page: the password goes to Polestar's sign-in and is never kept;
// only the sign-in token Polestar returns is stored privately, as the Polestar app itself does.

import { put, get } from "@vercel/blob";
import { randomBytes, createHash } from "node:crypto";

const ID = "https://polestarid.eu.polestar.com";
const CLIENT_ID = "l3oopkc_10";                       // Polestar's own web sign-in
const REDIRECT_URI = "https://www.polestar.com/sign-in-callback";
const SCOPE = "openid profile email customer:attributes";
const API = "https://pc-api.polestar.com/eu-north-1/mystar-v2/";
const STATE = "energy/polestar.json";
const KM_TO_MILES = 0.621371;

// Read off the car's screen on 22 October 2026: the manual trip meter's average and its odometer.
// Used until Hearth has a few weeks of its own mileage readings.
export const TRIP_METER = { kwhPer100mi: 35.8, overMiles: 4490, readOn: "2026-10-22" };
const FIRST_READING = { t: Date.parse("2026-10-22T14:00:00Z"), miles: 15174, from: "car screen" };

async function readState() {
  const r = await get(STATE, { access: "private", useCache: false }).catch(() => null);
  if (!r || r.statusCode !== 200 || !r.stream) return {};
  return new Response(r.stream).json().catch(() => ({}));
}
async function writeState(s) {
  await put(STATE, JSON.stringify(s), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Polestar's sign-in moves between pages with cookies, so keep them as a browser would. */
function cookieJar() {
  const jar = new Map();
  return {
    take(res) { for (const c of res.headers.getSetCookie?.() || []) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i).trim(), pair.slice(i + 1)); } },
    header() { return [...jar].map(([k, v]) => k + "=" + v).join("; "); },
  };
}

async function oidc() {
  const r = await fetch(ID + "/.well-known/openid-configuration", { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Polestar's sign-in isn't answering (" + r.status + ").");
  return r.json();
}

/** Email and password → tokens. The password is used here and not kept. */
async function passwordSignIn(email, password) {
  const conf = await oidc();
  const jar = cookieJar();
  const verifier = b64url(randomBytes(32));
  const params = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPE,
    state: b64url(randomBytes(32)), code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256", response_mode: "query",
  });
  const send = async (url, init = {}) => {
    const res = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers || {}), Cookie: jar.header() }, signal: AbortSignal.timeout(15000) });
    jar.take(res);
    return res;
  };

  // The sign-in page names the path the form posts to.
  let page = await send(conf.authorization_endpoint + "?" + params);
  for (let hops = 0; page.status >= 300 && page.status < 400 && hops < 5; hops++) page = await send(new URL(page.headers.get("location"), ID).href);
  const resume = (await page.text()).match(/(?:url|action):\s*"(.+?)"/)?.[1];
  if (!resume) throw new Error("Polestar's sign-in page has changed, so Hearth can't sign in.");
  const formUrl = new URL(resume, ID).href + "?" + params;
  const form = (data) => send(formUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data) });

  let res = await form({ "pf.username": email, "pf.pass": password });
  if (res.status !== 302 && res.status !== 303) {
    if ((await res.text()).includes('authMessage: "ERR001"')) throw new Error("Polestar didn't accept that email and password.");
    throw new Error("Polestar's sign-in said " + res.status + ".");
  }
  let next = new URL(res.headers.get("location"), ID);
  // A first sign-in can stop to accept terms; confirm and carry on, as the app does.
  if (!next.searchParams.get("code") && next.searchParams.get("uid")) {
    res = await form({ "pf.submit": "true", subject: next.searchParams.get("uid") });
    next = new URL(res.headers.get("location") || "", ID);
  }
  const code = next.searchParams.get("code");
  if (!code) throw new Error("Polestar signed in but didn't hand back a code.");
  return token(conf, { grant_type: "authorization_code", client_id: CLIENT_ID, code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
}

async function token(conf, body) {
  const r = await fetch(conf.token_endpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body), signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(body.grant_type === "refresh_token" ? "Polestar sign-in has expired. Connect it again." : "Polestar wouldn't issue a token.");
  return j;
}

async function graphql(access, query, variables = {}) {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors?.length) throw new Error("Polestar said " + (j.errors?.[0]?.message || r.status) + ".");
  return j.data;
}

const CARS = `query { getConsumerCarsV2 { vin modelName modelYear } }`;
const TELEMATICS = `query T($vins: [String!]!) { carTelematicsV2(vins: $vins) {
  odometer { vin odometerMeters timestamp { seconds } }
  battery { vin batteryChargeLevelPercentage estimatedDistanceToEmptyKm timestamp { seconds } } } }`;

/** What the car reports now: its mileage and battery. */
async function readCar(access, vin) {
  const d = await graphql(access, TELEMATICS, { vins: [vin] });
  const odo = (d.carTelematicsV2?.odometer || []).find((o) => o.vin === vin);
  const bat = (d.carTelematicsV2?.battery || []).find((b) => b.vin === vin);
  return {
    miles: odo?.odometerMeters ? Math.round((odo.odometerMeters / 1000) * KM_TO_MILES) : null,
    odometerAt: odo?.timestamp?.seconds ? Number(odo.timestamp.seconds) * 1000 : null,
    batteryPercent: bat?.batteryChargeLevelPercentage ?? null,
    rangeMiles: bat?.estimatedDistanceToEmptyKm != null ? Math.round(bat.estimatedDistanceToEmptyKm * KM_TO_MILES) : null,
  };
}

/** Step 1 (dashboard): a one-time code for the phone page, valid ten minutes. */
export async function startPairing() {
  const pair = randomBytes(9).toString("base64url");
  const s = await readState();
  await writeState({ ...s, pair, pairUntil: Date.now() + 10 * 60 * 1000 });
  return pair;
}

/** Step 2 (phone page): sign in once, find the car, keep only the token. Returns what the car said. */
export async function signInWithPassword(pair, email, password) {
  const s = await readState();
  if (!pair || pair !== s.pair || Date.now() > s.pairUntil) throw new Error("This sign-in link has expired. Make a new QR code on the dashboard.");
  const t = await passwordSignIn(email, password);
  const cars = (await graphql(t.access_token, CARS)).getConsumerCarsV2 || [];
  if (!cars.length) throw new Error("Signed in, but Polestar lists no cars on this account.");
  const car = cars[0];
  const now = await readCar(t.access_token, car.vin).catch((e) => ({ error: e.message }));
  const readings = addReading(s.readings, now);
  await writeState({
    refresh: t.refresh_token, vin: car.vin, model: [car.modelName, car.modelYear].filter(Boolean).join(" "),
    connectedAt: new Date().toISOString(), email: String(email).replace(/^(.).*(@.*)$/, "$1…$2"), readings, last: now,
  });
  return { model: car.modelName, ...now };
}

export async function status() {
  const s = await readState();
  return { connected: !!s.refresh, connectedAt: s.connectedAt || null, email: s.email || null, model: s.model || null, last: s.last || null, readings: (s.readings || []).length };
}

/** One reading a day is plenty; keep about two years. */
function addReading(readings = [], now) {
  const out = [...readings];
  if (now?.miles) {
    const t = now.odometerAt || Date.now();
    const day = new Date(t).toISOString().slice(0, 10);
    if (!out.some((r) => new Date(r.t).toISOString().slice(0, 10) === day)) out.push({ t, miles: now.miles, battery: now.batteryPercent });
  }
  return out.sort((a, b) => a.t - b.t).slice(-750);
}

/**
 * Called by the daily refresh: records today's mileage and returns every reading so far,
 * starting with the one read off the car's screen. Null if the car isn't connected.
 */
export async function mileage() {
  const s = await readState();
  if (!s.refresh) return null;
  const conf = await oidc();
  const t = await token(conf, { grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: s.refresh });
  const now = await readCar(t.access_token, s.vin);
  const readings = addReading(s.readings, now);
  await writeState({ ...s, refresh: t.refresh_token || s.refresh, readings, last: now });
  return [FIRST_READING, ...readings].sort((a, b) => a.t - b.t);
}
