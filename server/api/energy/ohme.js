// Connects the Ohme charger. The dashboard asks for a QR code (Hearth key); the phone page
// it opens signs in with Ohme once, using the one-time code in the link instead of the key.

import QRCode from "qrcode";
import { startPairing, signInWithPassword, status } from "../../lib/energy/ohme.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    if (body.step === "login") {
      await signInWithPassword(String(body.pair || ""), String(body.email || "").trim(), String(body.password || ""));
      return res.status(200).json({ ok: true });
    }
    if (!process.env.HEARTH_ASSISTANT_KEY || req.headers["x-hearth-key"] !== process.env.HEARTH_ASSISTANT_KEY) {
      return res.status(401).json({ error: "Wrong Hearth key." });
    }
    if (body.step === "start") {
      const pair = await startPairing();
      const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
      const link = origin + "/ohme?pair=" + pair;
      const qr = await QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
      return res.status(200).json({ link, qr, expiresIn: 600 });
    }
    return res.status(200).json(await status());
  } catch (err) {
    console.error("Ohme " + body.step + ":", err.message);
    return res.status(body.step === "login" ? 400 : 502).json({ error: err.message || "Ohme didn't answer." });
  }
}
