// Tado for the energy service: its own sign-in (Tado's one-time code), kept in private storage,
// and a check of what heating history this home's Tado offers. Tado allows about 100 requests
// a day on accounts without Auto-Assist, shared with the TV's bedtime check, so calls are few.

import { put, get } from "@vercel/blob";

const AUTH = "https://login.tado.com/oauth2/";
const API = "https://my.tado.com/api/v2/";
const HOPS = "https://hops.tado.com/";
const CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";   // Tado's own public app id, as the TV uses
const STATE = "energy/tado.json";

async function readState() {
  const r = await get(STATE, { access: "private", useCache: false }).catch(() => null);
  if (!r || r.statusCode !== 200 || !r.stream) return {};
  return new Response(r.stream).json().catch(() => ({}));
}
async function writeState(s) {
  await put(STATE, JSON.stringify(s), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
}

async function form(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, json };
}

/** Step 1: a code and link to approve on the phone. */
export async function startSignIn() {
  const r = await form(AUTH + "device_authorize", { client_id: CLIENT_ID, scope: "offline_access" });
  if (!r.ok) throw new Error("Tado didn't start the sign-in (" + r.status + ").");
  const s = await readState();
  await writeState({ ...s, device: r.json.device_code, deviceExpires: Date.now() + (r.json.expires_in || 300) * 1000 });
  return { code: r.json.user_code, link: r.json.verification_uri_complete || r.json.verification_uri, expiresIn: r.json.expires_in || 300 };
}

/** Step 2, called every few seconds by the page: has the household approved it yet? */
export async function finishSignIn() {
  const s = await readState();
  if (!s.device || Date.now() > s.deviceExpires) return { connected: !!s.refresh, waiting: false };
  const r = await form(AUTH + "token", { client_id: CLIENT_ID, device_code: s.device, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  if (r.ok) {
    await writeState({ refresh: r.json.refresh_token, connectedAt: new Date().toISOString() });
    return { connected: true };
  }
  const err = r.json.error || "";
  if (err === "authorization_pending" || err === "slow_down") return { connected: false, waiting: true };
  await writeState({ ...s, device: null });
  return { connected: false, waiting: false, error: "Tado said: " + (err || r.status) };
}

/** A fresh access token. Tado rotates the refresh token every time, so the new one is kept. */
// The access token lasts about ten minutes; reusing it means the refresh token rotates rarely,
// so two refreshes close together can't trip over each other's rotation.
async function accessToken() {
  const s = await readState();
  if (!s.refresh) throw new Error("Tado isn't connected yet.");
  if (s.access && s.accessUntil > Date.now() + 60000) return s.access;
  const r = await form(AUTH + "token", { client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: s.refresh });
  if (!r.ok) throw new Error("Tado sign-in has expired. Connect it again.");
  await writeState({ ...s, refresh: r.json.refresh_token || s.refresh, access: r.json.access_token, accessUntil: Date.now() + (r.json.expires_in || 600) * 1000 });
  return r.json.access_token;
}

let calls = 0;
async function call(token, url) {
  calls++;
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, left: r.headers.get("ratelimit") || r.headers.get("x-ratelimit-remaining") };
}

const shape = (x) => (Array.isArray(x) ? "list of " + x.length : x && typeof x === "object" ? Object.keys(x).slice(0, 14).join(", ") : String(x));

/**
 * What heating history this home offers: the home and its generation, its rooms, and whether a
 * day report (when each room called for heat) works, Tado X or classic. About 6 requests.
 */
export async function probe() {
  calls = 0;
  const token = await accessToken();
  const out = { checks: [] };
  const note = (what, r) => out.checks.push({ what, status: r.status, shape: shape(r.json), rateLimit: r.left || null });

  const me = await call(token, API + "me");
  note("account", me);
  const home = me.json?.homes?.[0];
  if (!home) throw new Error("No Tado home on this account.");
  out.home = home.name;
  const h = await call(token, API + "homes/" + home.id);
  note("home", h);
  out.generation = h.json?.generation || "unknown";

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let rooms = [];
  if (out.generation === "LINE_X") {
    const r = await call(token, HOPS + "homes/" + home.id + "/rooms");
    note("Tado X rooms", r);
    rooms = (Array.isArray(r.json) ? r.json : []).map((x) => ({ id: x.id ?? x.roomId, name: x.name ?? x.roomName }));
  } else {
    const z = await call(token, API + "homes/" + home.id + "/zones");
    note("zones", z);
    rooms = (Array.isArray(z.json) ? z.json : []).filter((x) => x.type === "HEATING").map((x) => ({ id: x.id, name: x.name }));
  }
  out.rooms = rooms.map((r) => r.name);

  // The day report: the classic path first (it may serve Tado X rooms too), then a Tado X guess.
  if (rooms[0]) {
    const tries = [["day report (classic path)", API + "homes/" + home.id + "/zones/" + rooms[0].id + "/dayReport?date=" + yesterday]];
    if (out.generation === "LINE_X") tries.push(["day report (Tado X path)", HOPS + "homes/" + home.id + "/rooms/" + rooms[0].id + "/dayReport?date=" + yesterday]);
    for (const [what, url] of tries) {
      const r = await call(token, url);
      note(what + " for " + rooms[0].name, r);
      const intervals = r.json?.callForHeat?.dataIntervals;
      if (r.status === 200 && Array.isArray(intervals)) {
        out.dayReport = { path: what, room: rooms[0].name, intervals: intervals.length, levels: [...new Set(intervals.map((i) => i.value))] };
        break;
      }
    }
  }
  out.requestsUsed = calls;
  out.checkedAt = new Date().toISOString();
  const s = await readState();
  await writeState({ ...s, homeId: home.id, generation: out.generation, rooms, probe: out });
  return out;
}

export async function status() {
  const s = await readState();
  return { connected: !!s.refresh, connectedAt: s.connectedAt || null, probe: s.probe || null };
}

// ---------- Heating history ----------
// One day report per room per day says when that room called for heat, and how hard. Each day
// is boiled down to 48 half-hour weights per room and kept, so it's only ever fetched once.

const LEVEL = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const dayPath = (date) => "energy/tado/" + date + ".json";

async function readDay(date) {
  const r = await get(dayPath(date), { access: "private" }).catch(() => null);
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return new Response(r.stream).json().catch(() => null);
}

/** Half-hour weights (0–3, part-hours pro rata) for one room's day report. */
function weights(report, slotOf, date) {
  const w = new Array(48).fill(0);
  for (const iv of report?.callForHeat?.dataIntervals || []) {
    const level = LEVEL[iv.value] || 0;
    if (!level) continue;
    let t = Date.parse(iv.from);
    const end = Date.parse(iv.to);
    while (t < end) {
      const slotStart = Math.floor(t / 1800000) * 1800000, slotEnd = slotStart + 1800000;
      const until = Math.min(end, slotEnd);
      const l = slotOf(slotStart);
      if (l.date === date) w[l.slot] += (level * (until - t)) / 1800000;
      t = until;
    }
  }
  return w.map((x) => Math.round(x * 100) / 100);
}

/**
 * Room weights for each date asked for: { date: { room: [48] } }. Stored days come from storage;
 * missing ones are fetched newest first, up to `budget` requests, so a 90-day catch-up spreads
 * over a few nights. Today is never stored, as it isn't finished.
 */
export async function heatHistory(dates, slotOf, budget = 100) {
  const s = await readState();
  if (!s.refresh) return { days: {}, connected: false, missing: dates.length };
  if (!s.homeId || !s.rooms?.length) await probe();                 // learn the home and rooms first
  Object.assign(s, await readState());
  const out = {};
  const todo = [];
  for (const d of dates) {
    const kept = await readDay(d);
    if (kept) out[d] = kept;
    else todo.push(d);
  }
  todo.sort().reverse();
  const today = slotOf(Date.now()).date;
  let token = null, used = 0, left = null;
  for (const d of todo) {
    if (used + s.rooms.length > budget) break;
    if (left !== null && left < 300) break;                       // leave plenty for the TV
    token = token || (await accessToken());
    const day = {};
    const replies = await Promise.all(s.rooms.map((room) => call(token, API + "homes/" + s.homeId + "/zones/" + room.id + "/dayReport?date=" + d).catch(() => null)));
    used += s.rooms.length;
    replies.forEach((r, i) => {
      if (!r) return;
      const m = /r=(\d+)/.exec(r.left || "");
      if (m) left = left === null ? Number(m[1]) : Math.min(left, Number(m[1]));
      if (r.status === 200) day[s.rooms[i].name] = weights(r.json, slotOf, d);
    });
    if (Object.keys(day).length) {
      out[d] = day;
      if (d < today) await put(dayPath(d), JSON.stringify(day), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
    }
  }
  return { days: out, connected: true, rooms: s.rooms.map((r) => r.name), fetched: used, missing: dates.filter((d) => !out[d]).length, requestsLeft: left };
}
