// Hearth assistant: the TV sends a request it couldn't understand on its own ("something calm
// before bed", "suggest a film we'd like"), plus what it can do. Claude picks one action.
//
// Deployed on Vercel. Two environment variables, set in Vercel's settings, never in code:
//   ANTHROPIC_API_KEY     the Anthropic key
//   HEARTH_ASSISTANT_KEY  a long random string the TV sends with every request
// Optional: CLAUDE_MODEL to try a different model.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
// Server-side fallbacks re-run a declined request on another model. Not offered for Haiku.
const SUPPORTS_FALLBACKS = /^claude-(opus|sonnet)-5-5$/.test(MODEL);

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "One short sentence for the TV screen, British English, at most 12 words." },
    action: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["open_app", "open_channel", "open_kid", "suggest", "none"] },
        key: { type: "string", description: "The app, channel or kid key from the catalogue. Empty for suggest and none." },
      },
      required: ["type", "key"],
      additionalProperties: false,
    },
    suggestions: {
      type: "array",
      description: "Only for action suggest: up to 3 picks. Otherwise empty.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: ["film", "series"] },
          year: { type: "string", description: "Release year, or empty if unsure." },
          app: { type: "string", description: "App key where it's most likely streaming in the UK." },
          reason: { type: "string", description: "Why this household would like it, at most 12 words." },
        },
        required: ["title", "kind", "year", "app", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "action", "suggestions"],
  additionalProperties: false,
};

const SYSTEM = `You are the assistant inside Hearth, the TV home screen of a UK family. The TV sends you one spoken or typed request, the catalogue of things it can do, what the household has opened recently, and notes on their taste.

Choose exactly one action:
- open_app: open one of the installed apps (use its key).
- open_channel: start a live channel (use its key).
- open_kid: play one of the children's programmes (use its key).
- suggest: when they ask what to watch, or for something they'd like. Give up to 3 films or series that are likely streaming in the UK now on one of their installed apps, matched to their taste notes and history. Prefer variety. Never suggest something they have obviously already watched.
- none: when nothing fits, and say briefly what you can do instead.

Only use keys that appear in the catalogue, and only installed apps. If you're unsure a title is on a service, pick another title. Keep the reply warm and brief, no exclamation marks.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.HEARTH_ASSISTANT_KEY || req.headers["x-hearth-key"] !== process.env.HEARTH_ASSISTANT_KEY) {
    return res.status(401).json({ error: "Wrong assistant key." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const request = String(body?.request || "").slice(0, 300).trim();
  if (!request) return res.status(400).json({ error: "Nothing was asked." });

  const context = {
    now: String(body.now || ""),
    catalogue: body.catalogue || {},
    recentlyOpened: Array.isArray(body.history) ? body.history.slice(0, 20) : [],
    tasteNotes: String(body.taste || "").slice(0, 2000),
  };

  const params = {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: ANSWER_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Household context:\n${JSON.stringify(context)}\n\nRequest: ${request}`,
      },
    ],
  };

  try {
    const message = SUPPORTS_FALLBACKS
      ? await client.beta.messages.create({ ...params, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] })
      : await client.messages.create(params);

    if (message.stop_reason === "refusal") {
      return res.status(200).json(noAction("Sorry, I can’t help with that one."));
    }
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const answer = safeParse(text);
    if (!answer) return res.status(502).json({ error: "The assistant's answer couldn't be read." });
    return res.status(200).json(answer);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: "The Anthropic key in Vercel isn't valid." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Too many requests. Try again in a minute." });
    }
    if (err instanceof Anthropic.APIError) {
      const lowCredit = /credit balance/i.test(err.message || "");
      return res.status(502).json({ error: lowCredit ? "The Anthropic account needs topping up." : "The assistant is unavailable right now." });
    }
    return res.status(502).json({ error: "The assistant is unavailable right now." });
  }
}

function noAction(reply) {
  return { reply, action: { type: "none", key: "" }, suggestions: [] };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
