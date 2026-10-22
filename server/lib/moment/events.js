// What's coming up that the household cares about: Formula 1 sessions (exact start times) and
// PGA Tour golf events (tournament days). Public sources, no keys; cached for an hour.

const TZ = "Europe/London";
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
let cache = { at: 0, events: [] };

async function json(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(url.split("/")[2] + " said " + r.status);
  return r.json();
}

/** F1 sessions this season (practice, sprint, qualifying, race) as {kind, name, session, start}. */
async function f1() {
  const d = await json("https://api.jolpi.ca/ergast/f1/current.json");
  const out = [];
  for (const race of d?.MRData?.RaceTable?.Races || []) {
    const add = (session, x) => x?.date && out.push({ kind: "f1", name: race.raceName, session, start: Date.parse(x.date + "T" + (x.time || "12:00:00Z")) });
    add("first practice", race.FirstPractice); add("second practice", race.SecondPractice); add("third practice", race.ThirdPractice);
    add("sprint qualifying", race.SprintQualifying || race.SprintShootout); add("sprint", race.Sprint);
    add("qualifying", race.Qualifying); add("race", { date: race.date, time: race.time });
  }
  return out;
}

/** PGA Tour events from ESPN's public schedule as {kind, name, start, end} (days, no times). */
async function golf() {
  const d = await json("https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard");
  const cal = d?.leagues?.[0]?.calendar || [];
  return cal.map((e) => ({ kind: "golf", name: e.label || e.name, start: Date.parse(e.startDate), end: Date.parse(e.endDate) }))
    .filter((e) => e.name && e.start);
}

export async function upcoming(now = Date.now()) {
  if (now - cache.at > HOUR) {
    const [a, b] = await Promise.all([f1().catch(() => null), golf().catch(() => null)]);
    cache = { at: now, events: [...(a || []), ...(b || [])], sources: { f1: !!a, golf: !!b } };
  }
  return {
    sources: cache.sources,
    events: cache.events.filter((e) => e.kind === "f1"
      ? e.start > now - 2 * HOUR && e.start < now + 2 * DAY           // a session soon, or just started
      : e.start < now + 2 * DAY && (e.end || e.start) + DAY > now),    // golf: starts soon, or on now
  };
}

const local = (t, opts) => new Date(t).toLocaleString("en-GB", { timeZone: TZ, ...opts });
const dayKey = (t) => local(t, { year: "numeric", month: "2-digit", day: "2-digit" });

/** "today", "tomorrow" or the weekday, in UK time. */
export function whichDay(t, now) {
  if (dayKey(t) === dayKey(now)) return "today";
  if (dayKey(t) === dayKey(now + DAY)) return "tomorrow";
  return "on " + local(t, { weekday: "long" });
}

/** Plain facts, one per event, with every time already worked out in UK time. */
export function facts(events, now) {
  return events.map((e) => {
    if (e.kind === "f1") {
      const mins = Math.round((e.start - now) / 60000);
      const time = local(e.start, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      const when = mins <= 0 ? "started " + (-mins < 60 ? -mins + " minutes ago" : "at " + time)
        : mins <= 90 ? "starts in " + mins + " minutes (" + time + ")"
        : "starts at " + time + " " + whichDay(e.start, now);
      return { kind: "f1", text: "Formula 1, " + e.name + ": " + e.session + " " + when + ".", minsAway: mins, plain: "F1 " + e.session + " " + (mins > 0 && mins <= 90 ? "in " + mins + " minutes" : mins <= 0 ? "is on now" : "at " + time + " " + whichDay(e.start, now)) };
    }
    const started = e.start <= now, ends = e.end || e.start;
    const text = started ? "Golf, PGA Tour: " + e.name + " is on now (until " + local(ends, { weekday: "long" }) + ")."
      : "Golf, PGA Tour: " + e.name + " starts " + whichDay(e.start, now) + ".";
    return { kind: "golf", text, minsAway: Math.round((e.start - now) / 60000), plain: started ? e.name + " is on" : e.name + " starts " + whichDay(e.start, now) };
  });
}
