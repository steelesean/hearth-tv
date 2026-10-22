// Connects Tado to the energy service, and checks what heating history it offers.
// POST { step: "start" | "poll" | "probe" | "status" } with the Hearth key.

import { startSignIn, finishSignIn, probe, status } from "../../lib/energy/tado.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.HEARTH_ASSISTANT_KEY || req.headers["x-hearth-key"] !== process.env.HEARTH_ASSISTANT_KEY) {
    return res.status(401).json({ error: "Wrong Hearth key." });
  }
  const step = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}).step;
  try {
    if (step === "start") return res.status(200).json(await startSignIn());
    if (step === "poll") return res.status(200).json(await finishSignIn());
    if (step === "probe") return res.status(200).json(await probe());
    return res.status(200).json(await status());
  } catch (err) {
    console.error("Tado " + step + ":", err);
    return res.status(502).json({ error: err.message || "Tado didn't answer." });
  }
}
