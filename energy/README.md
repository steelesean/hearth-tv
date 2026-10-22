# Hearth Energy

Works out the household's energy week from the Octopus smart meter, every morning at 5:30
(4:30 UTC). Every figure is calculated in `lib/analyse.js`; Claude only explains them and
picks what's worth doing (`lib/note.js`). The result is kept in a private Vercel Blob.

- `/` a simple dashboard (asks for the Hearth password once)
- `/api/week` the latest week, for the TV (header `x-hearth-key`)
- `/api/refresh` works it out again (Vercel's cron, or the Hearth password)

Set in Vercel, never in code: `OCTOPUS_API_KEY`, `OCTOPUS_ACCOUNT`, `ANTHROPIC_API_KEY`,
`HEARTH_ASSISTANT_KEY`. `CRON_SECRET` and `BLOB_READ_WRITE_TOKEN` are set by Vercel.
Optional: `GAS_UNITS` (`kwh` or `m3`) if the gas figures look ten times out.
