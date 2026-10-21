// Hearth up next: for the household's top series, when the next episode is out and where.
// Uses TMDB (TMDB_TOKEN or TMDB_API_KEY in Vercel). No Claude call, so it costs nothing.
//
// POST { shows: [{ title, app }], apps: ["netflix", ...] } with the x-hearth-key header.
// Returns { shows: [{ title, app, season, next: {date, season, episode} | null, status, usDate }] }

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
// Services that release in the UK on the same day as everywhere else.
const SAME_DAY = ["netflix", "disney", "prime", "appletv"];

async function tmdb(path) {
  const token = process.env.TMDB_TOKEN;
  const url = new URL("https://api.themoviedb.org/3" + path);
  if (!token) url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  const r = await fetch(url, {
    headers: token ? { Authorization: "Bearer " + token, Accept: "application/json" } : { Accept: "application/json" },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error("TMDB " + r.status);
  return r.json();
}

async function lookUp(show, installed) {
  const found = (await tmdb("/search/tv?query=" + encodeURIComponent(show.title))).results?.[0];
  if (!found) return { title: show.title, app: show.app || "", found: false };
  const [detail, providers] = await Promise.all([
    tmdb("/tv/" + found.id),
    tmdb("/tv/" + found.id + "/watch/providers").catch(() => ({})),
  ]);
  const gb = providers.results?.GB || {};
  const names = [...(gb.flatrate || []), ...(gb.free || []), ...(gb.ads || [])].map((p) => String(p.provider_name).toLowerCase());
  const apps = Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].some((n) => names.some((x) => x.startsWith(n))));
  const onTheirs = apps.filter((a) => installed.includes(a));
  const app = onTheirs.includes(show.app) ? show.app : onTheirs[0] || show.app || "";
  const next = detail.next_episode_to_air;
  return {
    title: detail.name || show.title,
    app,
    found: true,
    season: next?.season_number || detail.last_episode_to_air?.season_number || detail.number_of_seasons || null,
    next: next ? { date: next.air_date, season: next.season_number, episode: next.episode_number } : null,
    status: detail.status || "",          // e.g. "Returning Series", "Ended"
    usDate: !!next && (detail.origin_country || []).includes("US") && !SAME_DAY.includes(app),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.HEARTH_ASSISTANT_KEY || req.headers["x-hearth-key"] !== process.env.HEARTH_ASSISTANT_KEY) {
    return res.status(401).json({ error: "Wrong assistant key." });
  }
  if (!process.env.TMDB_TOKEN && !process.env.TMDB_API_KEY) return res.status(200).json({ shows: [], note: "No TMDB key set." });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const shows = (Array.isArray(body.shows) ? body.shows : []).slice(0, 5).filter((s) => s && s.title);
  const installed = Array.isArray(body.apps) ? body.apps : [];
  const results = await Promise.all(shows.map((s) => lookUp(s, installed).catch(() => ({ title: s.title, app: s.app || "", found: false }))));
  return res.status(200).json({ shows: results });
}
