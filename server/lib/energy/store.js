// Keeps the latest week in a private Vercel Blob, so the TV's request is instant.

import { put, get } from "@vercel/blob";

const LATEST = "energy/latest.json";

export async function save(data) {
  const body = JSON.stringify(data);
  await put(LATEST, body, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  await put("energy/weeks/" + data.week.from + ".json", body, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
}

/** How long ago the stored week was worked out (Infinity if never). */
export async function age() {
  const d = await load().catch(() => null);
  return d ? Date.now() - Date.parse(d.generatedAt) : Infinity;
}

export async function load() {
  const r = await get(LATEST, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return new Response(r.stream).json();
}

// What the household has said about suggestions: { [id]: { verdict, at } }.
const FEEDBACK = "energy/feedback.json";

export async function loadFeedback() {
  const r = await get(FEEDBACK, { access: "private", useCache: false }).catch(() => null);
  if (!r || r.statusCode !== 200 || !r.stream) return {};
  return new Response(r.stream).json().catch(() => ({}));
}

export async function saveFeedback(feedback) {
  await put(FEEDBACK, JSON.stringify(feedback), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
}

// Octopus only lists recent smart-charge slots, so every one seen is kept here.
const DISPATCHES = "energy/dispatches.json";

export async function mergeDispatches(fresh) {
  const r = await get(DISPATCHES, { access: "private", useCache: false }).catch(() => null);
  const kept = r && r.statusCode === 200 && r.stream ? await new Response(r.stream).json().catch(() => []) : [];
  const byStart = new Map(kept.map((d) => [d.from, d]));
  for (const d of fresh || []) byStart.set(d.from, d);
  const all = [...byStart.values()].sort((a, b) => a.from - b.from);
  if (fresh?.length) await put(DISPATCHES, JSON.stringify(all), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  return all;
}
