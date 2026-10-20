// Hearth learning: folds the household's feedback on suggestions ("loved it", "not for us",
// "already seen") and what they've been opening into a short, updated taste profile.
// The TV keeps the profile and sends it with every request to /api/ask.
//
// Same environment variables as api/ask.js.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const SUPPORTS_FALLBACKS = /^claude-(opus|sonnet)-5-5$/.test(MODEL);

const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    profile: {
      type: "string",
      description: "The updated taste profile: plain sentences, second person ('You like…'), at most 120 words.",
    },
  },
  required: ["profile"],
  additionalProperties: false,
};

const SYSTEM = `You keep the taste profile for a UK household's TV home screen. You are given what they wrote about their own taste, the current learned profile, their recent feedback on suggestions, and what they have been opening.

Write an updated profile that a recommender can use: genres, tone and themes they enjoy or avoid, formats (film length, series length), and titles they have already seen or rejected so they are not suggested again. Their own written notes always win over anything inferred. Keep what is still true from the current profile, drop what the feedback contradicts, and don't invent preferences the evidence doesn't support. At most 120 words, plain sentences, second person.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.HEARTH_ASSISTANT_KEY || req.headers["x-hearth-key"] !== process.env.HEARTH_ASSISTANT_KEY) {
    return res.status(401).json({ error: "Wrong assistant key." });
  }
  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const context = {
    theirOwnNotes: String(body?.taste || "").slice(0, 2000),
    currentProfile: String(body?.profile || "").slice(0, 2000),
    feedback: Array.isArray(body?.feedback) ? body.feedback.slice(0, 40) : [],
    recentlyOpened: Array.isArray(body?.history) ? body.history.slice(0, 20) : [],
  };

  const params = {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: PROFILE_SCHEMA } },
    messages: [{ role: "user", content: JSON.stringify(context) }],
  };

  try {
    const message = SUPPORTS_FALLBACKS
      ? await client.beta.messages.create({ ...params, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] })
      : await client.messages.create(params);
    if (message.stop_reason === "refusal") return res.status(200).json({ profile: context.currentProfile });
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const answer = safeParse(text);
    if (!answer || typeof answer.profile !== "string") return res.status(502).json({ error: "The profile couldn't be read." });
    return res.status(200).json({ profile: answer.profile.trim() });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "The Anthropic key in Vercel isn't valid." });
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Too many requests. Try again in a minute." });
    if (err instanceof Anthropic.APIError) {
      const lowCredit = /credit balance/i.test(err.message || "");
      return res.status(502).json({ error: lowCredit ? "The Anthropic account needs topping up." : "The assistant is unavailable right now." });
    }
    return res.status(502).json({ error: "The assistant is unavailable right now." });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
