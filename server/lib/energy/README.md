# Hearth Energy

Works out the household's energy week from the Octopus smart meter, every morning at 5:30
(4:30 UTC). Every figure is calculated in `analyse.js`; Claude only explains them and
picks what's worth doing (`note.js`). The result is kept in a private Vercel Blob.

It lives in the assistant's Vercel project:

- `/energy` a simple dashboard (asks for the Hearth password once)
- `/api/energy/week` the latest week, for the TV (header `x-hearth-key`)
- `/api/energy/refresh` works it out again (Vercel's cron, or the Hearth password)

Set in Vercel, never in code: `OCTOPUS_API_KEY` and `OCTOPUS_ACCOUNT` (Octopus account >
Personal details > API access). It reuses the assistant's `ANTHROPIC_API_KEY` and
`HEARTH_ASSISTANT_KEY`. Connecting a private Blob store to the project adds `BLOB_STORE_ID`, which the storage library uses to sign in.
Optional: `GAS_UNITS` (`kwh` or `m3`) if the gas figures look ten times out.
