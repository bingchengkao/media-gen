# media-gen

A Claude Code plugin that makes images, music, speech and video through
[OpenRouter](https://openrouter.ai), on your own key.

- **It asks before it starts spending.** The first generation in each conversation waits for your
  yes. After that it only asks when one request makes 8 or more items or looks like US$1 or more.
  Video asks every single time, and Claude won't suggest video unless you bring it up.
- **It tells you what each generation cost**, and which model made it.
- **It picks the model.** OpenRouter adds new models every month, so Claude checks what is there
  today, prefers the Nano Banana and FLUX families for images, and reads the chosen model's guide
  before prompting it.
- **Claude never sees your key.** It lives in your system keychain and only goes to openrouter.ai.

## Install

```bash
claude plugin marketplace add ./          # from this folder; or the GitHub path once it is pushed
claude plugin install media-gen@media-gen
```

Needs Node 18 or newer on your `PATH`.

## Add your key

1. Make a key at <https://openrouter.ai/settings/keys>. Give it a **spend limit** (US$5 is plenty to
   start): if anything goes wrong, it stops there.
2. Put it in the plugin's settings: in a Claude Code session, `/plugin` → **Installed** →
   `media-gen` → **Configure options**, and paste it. Claude Code keeps it in your keychain.

   From a shell instead, with the key on your clipboard (the key itself never lands in your shell
   history):

   ```bash
   claude plugin install media-gen@media-gen --config openrouter_api_key="$(pbpaste)"
   ```

3. Restart Claude Code, or run `/reload-plugins`.

If the key is missing, the tools say so and spend nothing. An `OPENROUTER_API_KEY` environment
variable also works, as a fallback.

## What is inside

| Part | What it does |
|---|---|
| `skills/generate/SKILL.md` | When to generate, when to ask first, how to choose a model, what to report. |
| `server/index.mjs` | A small MCP server with no dependencies. It holds the key and talks to OpenRouter. |

Its tools: `list_models` (free, no key), `generate_image`, `generate_music`, `generate_speech`,
`generate_video` + `video_status`, and `check_balance`. Files are never overwritten: a second
`poster.png` becomes `poster-2.png`.

## Check it without spending

```bash
node scripts/smoke.mjs
```

It starts the server with no key, lists live models, and checks every refusal.
