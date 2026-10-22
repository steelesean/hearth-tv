// Runs every morning (vercel.json), or on demand with the Hearth key.
// Needs OCTOPUS_API_KEY, OCTOPUS_ACCOUNT and ANTHROPIC_API_KEY in Vercel. CRON_SECRET is set for us.

import { refresh } from "../lib/run.js";
import { save } from "../lib/store.js";

export default async function handler(req, res) {
  const cron = process.env.CRON_SECRET && req.headers.authorization === "Bearer " + process.env.CRON_SECRET;
  const hearth = process.env.HEARTH_ASSISTANT_KEY && req.headers["x-hearth-key"] === process.env.HEARTH_ASSISTANT_KEY;
  if (!cron && !hearth) return res.status(401).json({ error: "Not allowed." });
  try {
    const facts = await refresh();
    await save(facts);
    return res.status(200).json({ ok: true, week: facts.week.label, total: facts.week.total, actions: facts.note.actions.length });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: err.message || "The refresh didn't work." });
  }
}
