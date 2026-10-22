// Claude's weekly note: it explains the calculated facts in plain words and picks what's worth
// doing. It can't change a number; the yearly figure for each action comes from the candidate.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const SUPPORTS_FALLBACKS = /^claude-(opus|sonnet)-5-5$/.test(MODEL);

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "The week in one short sentence, at most 10 words." },
    summary: { type: "string", description: "Two sentences at most on how the week went." },
    actions: {
      type: "array",
      description: "Up to 3 candidates worth doing, most valuable first. Only candidates with per_year_gbp above 0.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The candidate id." },
          title: { type: "string", description: "One action, as an instruction, at most 7 words. E.g. 'Try Agile for a quarter'." },
          detail: { type: "string", description: "One or two sentences with the figures that back it up." },
        },
        required: ["id", "title", "detail"],
        additionalProperties: false,
      },
    },
    odd_days: {
      type: "array",
      description: "One line for each odd-day candidate.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          line: { type: "string", description: "One sentence: what was different and when. Offer a likely cause only as a possibility." },
        },
        required: ["id", "line"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "summary", "actions", "odd_days"],
  additionalProperties: false,
};

const SYSTEM = `You write the weekly energy note for Hearth, a UK family's TV home screen. You get facts that have already been calculated from their Octopus meter. Your job is to put them into plain, calm British English.

Rules:
- Use only the numbers you are given. Never work out new figures, and never mention data you weren't given (no temperatures, door sensors, room-by-room use or comparisons with other homes).
- Each action is one specific thing to do, worth doing, and checkable next week.
- A candidate with per_year_gbp 0 is information, not an action: work it into the summary if it matters (for example, that they're already on the cheapest tariff).
- Never tell them to do something the facts show they already do, and never assume a habit the facts don't show. If they're doing something well, say so plainly.
- If you name a cause (an immersion heater, a tumble dryer), say it's a possibility, not a fact.
- No exclamation marks, no jargon such as "baseload". Pounds as £12 or £12.40.`;

export async function weeklyNote(facts) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const brief = {
    week: {
      label: facts.week.label, total: facts.week.total, house: facts.week.house, car: facts.week.car, gas: facts.week.gas,
      electricity: facts.week.elec, usualElectricityWeek: facts.week.usualElec,
      gasNote: "Gas isn't compared with earlier weeks yet: it depends on the weather, which we don't have. Don't call gas high or low.",
    },
    monthForecast: facts.forecast,
    candidates: facts.candidates.map(({ id, per_year_gbp, facts: f }) => ({ id, per_year_gbp, facts: f })),
  };
  const params = {
    model: MODEL,
    max_tokens: 3000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: JSON.stringify(brief) }],
  };
  const message = SUPPORTS_FALLBACKS
    ? await client.beta.messages.create({ ...params, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] })
    : await client.messages.create(params);
  if (message.stop_reason === "refusal") return null;
  let note;
  try { note = JSON.parse(message.content.filter((b) => b.type === "text").map((b) => b.text).join("")); } catch { return null; }

  // Attach the calculated money and evidence; drop anything Claude made up an id for.
  const byId = Object.fromEntries(facts.candidates.map((c) => [c.id, c]));
  note.actions = (note.actions || []).filter((a) => byId[a.id]?.per_year_gbp > 0).slice(0, 3)
    .map((a) => ({ ...a, per_year_gbp: byId[a.id].per_year_gbp, how_we_know: byId[a.id].how_we_know }));
  note.odd_days = (note.odd_days || []).filter((o) => byId[o.id])
    .map((o) => ({ ...o, how_we_know: byId[o.id].how_we_know }));
  return note;
}

/** If Claude isn't available, the candidates still make a usable, plainer note. */
export function plainNote(facts) {
  const money = facts.candidates.filter((c) => c.per_year_gbp > 0).sort((a, b) => b.per_year_gbp - a.per_year_gbp).slice(0, 3);
  return {
    headline: "Energy last week: £" + facts.week.total.toFixed(2),
    summary: facts.week.usualElec ? "Electricity £" + facts.week.elec.toFixed(2) + ", against a usual £" + facts.week.usualElec.toFixed(2) + "." : "",
    actions: money.map((c) => ({ id: c.id, title: { tariff: "Look at " + (facts.tariff.best?.name || "another tariff"), baseline: "Find what's always on", peak: "Run big appliances on a delay timer" }[c.id], detail: c.facts, per_year_gbp: c.per_year_gbp, how_we_know: c.how_we_know })),
    odd_days: facts.candidates.filter((c) => c.id.startsWith("odd-")).map((c) => ({ id: c.id, line: c.facts, how_we_know: c.how_we_know })),
    plain: true,
  };
}
