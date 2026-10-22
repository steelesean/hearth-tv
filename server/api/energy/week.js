// What the TV and the dashboard read: the latest calculated week.

import { load } from "../../lib/energy/store.js";

export default async function handler(req, res) {
  if (!process.env.HEARTH_ASSISTANT_KEY || req.headers["x-hearth-key"] !== process.env.HEARTH_ASSISTANT_KEY) {
    return res.status(401).json({ error: "Wrong Hearth key." });
  }
  try {
    const data = await load();
    if (!data) return res.status(404).json({ error: "No energy week yet. It's worked out each morning at 5:30." });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Couldn't read the stored week." });
  }
}
