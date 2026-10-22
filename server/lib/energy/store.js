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
  const r = await get(LATEST, { access: "private" });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return new Response(r.stream).json();
}
