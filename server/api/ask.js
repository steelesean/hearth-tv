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
        show: { type: "string", description: "For open_app: the specific film or series they asked for, by its usual title. Empty if they just asked for the app." },
        showKind: { type: "string", enum: ["film", "series", ""], description: "Whether show is a film or a series. Empty if show is empty." },
      },
      required: ["type", "key", "show", "showKind"],
      additionalProperties: false,
    },
    suggestions: {
      type: "array",
      description: "Only for action suggest: up to 6 picks, best first (the TV checks availability and shows 3). Otherwise empty.",
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
- open_app: open one of the installed apps (use its key). If they asked for a particular film or series ("put on Slow Horses"), open the app it streams on in the UK and give its title in show.
- open_channel: start a live channel (use its key).
- open_kid: play one of the children's programmes (use its key).
- suggest: when they ask what to watch, or for something they'd like. Give up to 6 films or series, best first, that are likely streaming in the UK now on one of their installed apps, matched to their taste notes, learned profile, feedback and history. Their own taste notes win over the learned profile. Prefer variety. Never suggest anything they've marked as seen or not for them, or have obviously already watched.
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
    learnedProfile: String(body.profile || "").slice(0, 2000),
    feedbackOnPastSuggestions: Array.isArray(body.feedback) ? body.feedback.slice(0, 40) : [],
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
    if (answer.action?.type === "suggest" && Array.isArray(answer.suggestions)) {
      const installed = (context.catalogue.apps || []).map((a) => a.key);
      const checked = await checkAvailability(answer.suggestions, installed);
      answer.suggestions = checked.suggestions;
      if (checked.attribution) answer.attribution = checked.attribution;
    }
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

// ---------- Where to watch (TMDB, with data from JustWatch) ----------
// Optional: set TMDB_TOKEN (TMDB's "API Read Access Token") or TMDB_API_KEY in Vercel.
// Without either, suggestions go through unchecked.

// TMDB provider names for each Hearth app key.
const PROVIDERS = {
  netflix: ["netflix"],
  disney: ["disney plus", "disney+"],
  prime: ["amazon prime video"],
  appletv: ["apple tv plus", "apple tv+"],
  iplayer: ["bbc iplayer"],
  channel4: ["channel 4", "channel4"],
  itvx: ["itvx"],
  my5: ["my5", "channel 5"],
};

async function tmdb(path) {
  const token = process.env.TMDB_TOKEN;
  const key = process.env.TMDB_API_KEY;
  const url = new URL("https://api.themoviedb.org/3" + path);
  if (!token) url.searchParams.set("api_key", key);
  const r = await fetch(url, {
    headers: token ? { Authorization: "Bearer " + token, Accept: "application/json" } : { Accept: "application/json" },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error("TMDB " + r.status);
  return r.json();
}

/** The installed app keys a title is streaming on in the UK, plus its TMDB year. */
async function whereToWatch(s) {
  const type = s.kind === "series" ? "tv" : "movie";
  const yearParam = type === "tv" ? "first_air_date_year" : "primary_release_year";
  const q = "/search/" + type + "?query=" + encodeURIComponent(s.title) + (s.year ? "&" + yearParam + "=" + encodeURIComponent(s.year) : "");
  let found = (await tmdb(q)).results?.[0];
  if (!found && s.year) found = (await tmdb("/search/" + type + "?query=" + encodeURIComponent(s.title))).results?.[0];
  if (!found) return null;
  const gb = (await tmdb("/" + type + "/" + found.id + "/watch/providers")).results?.GB || {};
  const names = [...(gb.flatrate || []), ...(gb.free || []), ...(gb.ads || [])].map((p) => String(p.provider_name).toLowerCase());
  const apps = Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].some((n) => names.some((x) => x.startsWith(n))));
  const date = found.release_date || found.first_air_date || "";
  return { apps, year: date.slice(0, 4) };
}

async function checkAvailability(suggestions, installed) {
  if (!process.env.TMDB_TOKEN && !process.env.TMDB_API_KEY) return { suggestions: suggestions.slice(0, 3) };
  const results = await Promise.all(suggestions.map((s) => whereToWatch(s).catch(() => undefined)));
  const kept = [];
  results.forEach((r, i) => {
    if (!r) return;                                    // not found, or the check failed
    const onTheirApps = r.apps.filter((a) => installed.includes(a));
    if (!onTheirApps.length) return;                   // not streaming on anything they have
    const s = suggestions[i];
    kept.push({ ...s, app: onTheirApps.includes(s.app) ? s.app : onTheirApps[0], year: r.year || s.year });
  });
  if (!kept.length) return { suggestions: suggestions.slice(0, 3) };   // better unchecked than nothing
  return { suggestions: kept.slice(0, 3), attribution: "Where-to-watch data from JustWatch, via TMDB." };
}

function noAction(reply) {
  return { reply, action: { type: "none", key: "", show: "", showKind: "" }, suggestions: [] };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
export { checkAvailability };
