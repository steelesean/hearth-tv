// Works out the energy week again. Vercel's cron calls it each morning at 5:30 (vercel.json);
// the dashboard can call it with the Hearth key. Anyone else can only trigger it if the stored
// week is over 20 hours old, so the cron needs no secret and nobody can run up the Claude bill.
// Needs OCTOPUS_API_KEY and OCTOPUS_ACCOUNT in Vercel, and the Blob store connected.

import { refresh } from "../../lib/energy/run.js";
import { save, age } from "../../lib/energy/store.js";

export default async function handler(req, res) {
  const hearth = process.env.HEARTH_ASSISTANT_KEY && req.headers["x-hearth-key"] === process.env.HEARTH_ASSISTANT_KEY;
  const cron = process.env.CRON_SECRET && req.headers.authorization === "Bearer " + process.env.CRON_SECRET;
  if (!hearth && !cron && (await age()) < 20 * 3600 * 1000) return res.status(200).json({ ok: true, skipped: "Already up to date." });
  try {
    const facts = await refresh();
    await save(facts);
    return res.status(200).json({ ok: true, week: facts.week.label, total: facts.week.total, actions: facts.note.actions.length });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: err.message || "The refresh didn't work." });
  }
}
