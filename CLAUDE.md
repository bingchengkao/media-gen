# media-gen

One Claude Code plugin, `media-gen`, in a repo that is its own marketplace
(`.claude-plugin/marketplace.json`). It makes images, music, speech and video through OpenRouter.
Why it exists and every decision behind it: the `web-animation-skills` repo, ticket 07 and
`decisions.md` 〈Q5 追問〉 under `.scratch/studio-rethink/`.

- `plugins/media-gen/skills/generate/SKILL.md` — the one skill: when to ask, how to choose, what to report.
- `plugins/media-gen/server/index.mjs` — MCP server, no dependencies. Reads the key from `MEDIA_GEN_API_KEY`.
- `scripts/smoke.mjs` — checks the server without a key; spends nothing. Run it after every server change.

## Rules that are the user's, not ours to soften

- The first generation in a conversation waits for the user's yes. After that, ask only at 12+ items
  in one request or an estimated US$1.5+ (raised from 8 and US$1 on 2026-10-05, so a round of
  exploring directions fits under it).
- Video: never offered unless the user brought it up; a yes before every single video.
- After every generation: which model, what it cost.
- The key never reaches the model: not in a tool result, not in an error, not on disk.
- The key comes from one environment variable, `MEDIA_GEN_API_KEY`, and nowhere else (2026-10-01).
  Claude Code's plugin settings (`userConfig`, `claude plugin configure`) were tried and dropped:
  too much for the user to follow, and after `claude plugin update` the stored key reached the
  server empty. Don't bring them back, and don't add fallback variable names.

## Conventions

- SKILL.md is English. Whatever the model says to the user is in the user's language.
- Model names go stale monthly. The skill names families and says how to look models up; it never
  lists model ids.
- Installs copy into the plugin cache and `claude plugin update` compares the version string: bump
  `version` in `plugins/media-gen/.claude-plugin/plugin.json` after changes are reviewed, then
  `claude plugin marketplace update media-gen` and `claude plugin update media-gen@media-gen`.
  On this machine the marketplace is this folder. Right after the first install the server ran
  straight from the repo; after `claude plugin update` it ran from the cache copy. Which one a
  session uses shows in `claude mcp list`.
- `claude mcp list` also says whether the server starts (`✔ Connected`). Checked 2026-10-01: it
  starts with no key set, so the no-key steps in `NO_KEY` reach the model.
- Where the variable has to live: a Claude Code started from a terminal passes the shell's whole
  environment to the server; the desktop app does not read shell profiles (a key in `~/.zshenv`
  never reached its servers). For Claude Code, the `env` block of `~/.claude/settings.json` should
  cover both; not yet confirmed by a real run.
