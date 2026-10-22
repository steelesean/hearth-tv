// Ohme charger: hour-by-hour charging from Ohme's own records (kWh, range added, Ohme's cost).
// Unofficial: the same sign-in and summary call the Home Assistant integration uses (ohmepy).
// Signed in once from the phone page: the password goes to Ohme's sign-in and is never kept;
// only the sign-in token Ohme returns is stored privately, as the Ohme app itself does.

import { put, get } from "@vercel/blob";
import { randomBytes } from "node:crypto";

const GOOGLE_API_KEY = "AIzaSyC8ZeZngm33tpOXLpbXeKfwtyZ1WrkbdBY";   // Ohme app's public sign-in key
const WEEK = 7 * 24 * 60 * 60 * 1000;
const STATE = "energy/ohme.json";

async function readState() {
  const r = await get(STATE, { access: "private", useCache: false }).catch(() => null);
  if (!r || r.statusCode !== 200 || !r.stream) return {};
  return new Response(r.stream).json().catch(() => ({}));
}
async function writeState(s) {
  await put(STATE, JSON.stringify(s), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
}

const userIdOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).user_id;

/** Step 1 (dashboard): a one-time code for the phone page, valid ten minutes. */
export async function startPairing() {
  const pair = randomBytes(9).toString("base64url");
  const s = await readState();
  await writeState({ ...s, pair, pairUntil: Date.now() + 10 * 60 * 1000 });
  return pair;
}

/** Step 2 (phone page): sign in with Ohme once and keep only the token. */
export async function signInWithPassword(pair, email, password) {
  const s = await readState();
  if (!pair || pair !== s.pair || Date.now() > s.pairUntil) throw new Error("This sign-in link has expired. Make a new QR code on the dashboard.");
  const r = await fetch("https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=" + GOOGLE_API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("Ohme didn't accept that email and password.");
  const j = await r.json();
  await writeState({ refresh: j.refreshToken, connectedAt: new Date().toISOString(), email: String(email).replace(/^(.).*(@.*)$/, "$1…$2") });
  return true;
}

export async function status() {
  const s = await readState();
  return { connected: !!s.refresh, connectedAt: s.connectedAt || null, email: s.email || null };
}

/** A fresh Ohme token from the stored one; Ohme may hand back a new refresh token, which is kept. */
async function signIn() {
  const s = await readState();
  if (!s.refresh) return null;
  const r = await fetch("https://securetoken.googleapis.com/v1/token?key=" + GOOGLE_API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refresh }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("Ohme sign-in has expired. Connect it again.");
  const j = await r.json();
  if (j.refresh_token && j.refresh_token !== s.refresh) await writeState({ ...s, refresh: j.refresh_token });
  return { token: j.id_token, userId: j.user_id || userIdOf(j.id_token) };
}

async function api(token, path) {
  const r = await fetch("https://api.ohme.io" + path, { headers: { Authorization: "Firebase " + token, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("Ohme said " + r.status + " for " + path.split("?")[0]);
  return r.json();
}

/**
 * Charging by the hour between two times: [{ t (hour start, ms), kwh, km, ohmePence }].
 * Fetched a week at a time, in parallel.
 */
export async function chargingByHour(from, to) {
  const auth = await signIn();
  if (!auth) return null;
  const { token, userId } = auth;
  const windows = [];
  for (let s = from; s < to; s += WEEK) windows.push([s, Math.min(to, s + WEEK)]);
  const pages = await Promise.all(windows.map(([s, e]) =>
    api(token, `/v1/chargeSessions/summary/users/${userId}?endTs=${e}&granularity=HOUR&startTs=${s}`)));
  const hours = [];
  for (const page of pages) {
    for (const st of page.stats || []) {
      const wh = st.energyChargedTotalWh || 0;
      if (!wh) continue;
      hours.push({
        t: st.startTime,
        kwh: wh / 1000,
        km: st.batteryStats?.rangeAddedKm || 0,
        ohmePence: Number(st.costStats?.moneyCostTotal?.amount || 0),   // Ohme reports pence
      });
    }
  }
  return hours.sort((a, b) => a.t - b.t);
}
