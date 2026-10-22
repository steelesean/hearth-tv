// "Already doing this" or "Not for us" on a suggestion. It stays out of the note for 90 days.

import { loadFeedback, saveFeedback, load, save } from "../../lib/energy/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.HEARTH_ASSISTANT_KEY || req.headers["x-hearth-key"] !== process.env.HEARTH_ASSISTANT_KEY) {
    return res.status(401).json({ error: "Wrong Hearth key." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const id = String(body.id || "").slice(0, 40);
  const verdict = ["doing", "not-for-us", "undo"].includes(body.verdict) ? body.verdict : null;
  if (!/^[a-z0-9-]+$/.test(id) || !verdict) return res.status(400).json({ error: "Which suggestion, and what about it?" });
  try {
    const feedback = await loadFeedback();
    if (verdict === "undo") delete feedback[id];
    else feedback[id] = { verdict, at: new Date().toISOString() };
    await saveFeedback(feedback);
    // Take it off the stored week straight away, so the TV stops showing it before tomorrow's run.
    const week = await load();
    if (week?.note && verdict !== "undo") {
      week.note.actions = (week.note.actions || []).filter((a) => a.id !== id);
      week.note.odd_days = (week.note.odd_days || []).filter((o) => o.id !== id);
      await save(week);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Couldn't save that." });
  }
}
