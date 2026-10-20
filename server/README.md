# Hearth assistant

A single Vercel function (`api/ask.js`) that the TV calls when it can't understand a request by itself. It holds the Anthropic key, so the key never goes into the TV app (which is public on GitHub).

Deploy it as a Vercel project with **Root Directory** set to `server`, then add two environment variables in the project's settings:

- `ANTHROPIC_API_KEY`: your Anthropic key.
- `HEARTH_ASSISTANT_KEY`: a long random string. Enter the same string in the phone remote's settings, so only your TV can use the assistant.

Optional: `CLAUDE_MODEL` to try another model (for example `claude-haiku-5-5`, which is much cheaper).
