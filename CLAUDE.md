# media-gen

One Claude Code plugin, `media-gen`, in a repo that is its own marketplace
(`.claude-plugin/marketplace.json`). It makes images, music, speech and video through OpenRouter.
Why it exists and every decision behind it: the `web-animation-skills` repo, ticket 07 and
`decisions.md` 〈Q5 追問〉 under `.scratch/studio-rethink/`.

- `plugins/media-gen/skills/generate/SKILL.md` — the one skill: when to ask, how to choose, what to report.
- `plugins/media-gen/server/index.mjs` — MCP server, no dependencies. Holds the key.
- `scripts/smoke.mjs` — checks the server without a key; spends nothing. Run it after every server change.

## Rules that are the user's, not ours to soften

- The first generation in a conversation waits for the user's yes. After that, ask only at 8+ items
  in one request or an estimated US$1+.
- Video: never offered unless the user brought it up; a yes before every single video.
- After every generation: which model, what it cost.
- The key never reaches the model: not in a tool result, not in an error, not on disk.

## Conventions

- SKILL.md is English. Whatever the model says to the user is in the user's language.
- Model names go stale monthly. The skill names families and says how to look models up; it never
  lists model ids.
- Installs copy into the plugin cache and `claude plugin update` compares the version string: bump
  `version` in `plugins/media-gen/.claude-plugin/plugin.json` after changes are reviewed, then
  `claude plugin marketplace update media-gen` and `claude plugin update media-gen@media-gen`.
