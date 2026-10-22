// The TV home screen's question, when something is on: a followed show out today, Formula 1, or
// PGA Tour golf. The service gathers the facts; Claude only picks and phrases them (a short
// headline, and which of the TV's own answers to show). Every time or day in the headline is
// checked against the facts, else a plain wording built from them is used. Nothing on: the TV
// keeps its own time-of-day question, and Claude isn't asked.
//
// POST, with x-hearth-key: { now, local, base: { headline }, answers: [{ id, label }],
//   shows: [{ title, days }] }  →  { use, headline, answers, until, source }
// GET /api/moment?check=1 shows the public sport facts only, for checking the schedules.

import Anthropic from "@anthropic-ai/sdk";
import { upcoming, facts } from "../lib/moment/events.js";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const SUPPORTS_FALLBACKS = /^claude-(opus|sonnet)-5-5$/.test(MODEL);
const remembered = new Map();   // facts and answers → Claude's choice, for half an hour

const SYSTEM = `You write the one-line greeting at the top of a UK family's TV home screen, and choose which answer buttons sit under it.

You get the time, the facts about what's on (already worked out: trust them exactly), and the buttons available.
- Headline: at most 34 characters, calm British English, no exclamation marks. A short question or a plain statement, e.g. "Qualifying starts in 10 minutes", "The Traitors is new tonight", "The Scottish Open starts tomorrow".
- Use only the facts given. Never add a time, channel, score or detail that isn't in them. "Tonight" is fine for something out today in the evening.
- Pick the single most relevant fact for right now: something starting within the hour first, then things on today, then tomorrow.
- If nothing in the facts is worth the household's attention right now, use the usual greeting exactly as given.
- Choose up to three button ids, most useful first. Include a button for the show in the headline if there is one.`;

export default async function handler(req, res) {
  const now = Date.now();
  if (req.method === "GET") {
    const u = await upcoming(now);
    return res.status(200).json({ sources: u.sources, facts: facts(u.events, now).map((f) => f.text) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.HEARTH_ASSISTANT_KEY || req.headers["x-hearth-key"] !== process.env.HEARTH_ASSISTANT_KEY) {
    return res.status(401).json({ error: "Wrong assistant key." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const answers = (Array.isArray(body.answers) ? body.answers : []).filter((a) => a && a.id && a.label).slice(0, 8);
  const ids = answers.map((a) => String(a.id));

  // The facts: shows the household follows, then sport.
  const list = [];
  for (const s of (body.shows || []).slice(0, 6)) {
    if (s.days === 0) list.push({ kind: "show", text: s.title + ": a new episode is out today.", minsAway: 60, plain: s.title + " is new tonight", show: s.title });
    else if (s.days === 1) list.push({ kind: "show", text: s.title + ": a new episode is out tomorrow.", minsAway: 24 * 60, plain: s.title + " is new tomorrow", show: s.title });
  }
  const sport = await upcoming(now).catch(() => ({ events: [] }));
  list.push(...facts(sport.events, now));
  if (!list.length) return res.status(200).json({ use: false });

  // Without Claude, or if its answer doesn't check out: the most pressing fact, plainly.
  const rank = (f) => (f.minsAway <= 90 && f.minsAway > -120 ? 0 : f.minsAway < 12 * 60 ? 1 : 2) * 1e6 + Math.abs(f.minsAway);
  const top = [...list].sort((a, b) => rank(a) - rank(b))[0];
  const plain = {
    use: true, source: "plain", until: now + 30 * 60000,
    headline: top.plain.charAt(0).toUpperCase() + top.plain.slice(1),
    answers: orderAnswers(ids, answers, top),
  };

  if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json(plain);
  const memoKey = JSON.stringify([list.map((f) => f.text), ids, Math.floor(now / (30 * 60000))]);
  if (remembered.has(memoKey)) return res.status(200).json(remembered.get(memoKey));

  try {
    const params = {
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            answers: { type: "array", items: { type: "string", enum: ids.length ? ids : ["none"] } },
          },
          required: ["headline", "answers"], additionalProperties: false,
        } },
      },
      messages: [{ role: "user", content: JSON.stringify({ now: body.local, facts: list.map((f) => f.text), buttons: answers.map((a) => ({ id: a.id, label: a.label })), usualGreeting: body.base?.headline || "" }) }],
    };
    const msg = SUPPORTS_FALLBACKS
      ? await client.beta.messages.create({ ...params, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] })
      : await client.messages.create(params);
    const out = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    const headline = String(out.headline || "").trim().replace(/!+/g, "");
    const chosen = (out.answers || []).filter((id) => ids.includes(id)).slice(0, 3);
    const usual = String(body.base?.headline || "");
    if (headline === usual) { const r = { use: false }; remembered.set(memoKey, r); return res.status(200).json(r); }
    const result = checks(headline, list) && chosen.length
      ? { use: true, source: "claude", until: now + 30 * 60000, headline, answers: chosen }
      : plain;
    remembered.set(memoKey, result);
    if (remembered.size > 50) remembered.delete(remembered.keys().next().value);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Moment:", err.message);
    return res.status(200).json(plain);
  }
}

/** Short enough, and every number and day it names is in the facts. */
function checks(headline, list) {
  if (!headline || headline.length > 40) return false;
  const all = list.map((f) => f.text).join(" ").toLowerCase();
  const numbers = headline.match(/\d+/g) || [];
  if (numbers.some((n) => !new RegExp("\\b" + n + "\\b").test(all.replace(/:/g, " ")))) return false;
  const days = headline.toLowerCase().match(/\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g) || [];
  return days.every((d) => (d === "tonight" ? all.includes("today") : all.includes(d)));
}

/** For the plain version: the headline's show first if there's a button for it, then the TV's order. */
function orderAnswers(ids, answers, top) {
  const first = top.show ? answers.find((a) => a.label.toLowerCase().startsWith(top.show.toLowerCase())) : null;
  return [...(first ? [first.id] : []), ...ids.filter((id) => !first || id !== first.id)].slice(0, 3);
}
