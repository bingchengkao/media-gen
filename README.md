# media-gen

A Claude Code plugin that makes images, music, speech and video through
[OpenRouter](https://openrouter.ai), on your own key.

- **It asks before it starts spending.** The first generation in each conversation waits for your
  yes. After that it only asks when one request makes 8 or more items or looks like US$1 or more.
  Video asks every single time, and Claude won't suggest video unless you bring it up.
- **It checks its own work.** Claude looks at every image against what you asked and redoes the
  ones that miss, up to two retries, before showing you anything. Music and speech it can't hear,
  so it checks their length and any lyrics that came back, and says so.
- **It tells you what each generation cost**, and which model made it, counting every retry.
- **It picks the model.** OpenRouter adds new models every month, so Claude checks what is there
  today, prefers the Nano Banana and FLUX families for images, and reads the chosen model's guide
  before prompting it.
- **One place for the key**: the environment variable `MEDIA_GEN_API_KEY`. It only ever goes to
  openrouter.ai; the tools never show it back.

## Install

```bash
claude plugin marketplace add bingchengkao/media-gen   # from GitHub
claude plugin install media-gen@media-gen
```

Or, from a clone of this repo, `claude plugin marketplace add ./` in place of the first line.

The GitHub repo is private: installing from it needs a GitHub account with access to it, signed in
to `git` on that machine. Without access, the first line fails; use a clone instead.

Needs Node 18 or newer on your `PATH`.

## Add your key

1. Sign in at <https://openrouter.ai> and add credit at <https://openrouter.ai/settings/credits>.
   A key on an empty account is refused.
2. Make a key at <https://openrouter.ai/settings/keys>. Give it a **spend limit** (US$5 is plenty to
   start): if anything goes wrong, it stops there.
3. Put it in the environment variable `MEDIA_GEN_API_KEY`, wherever your agent takes its
   environment from:
   - **Claude Code**, terminal or desktop app: add it to `~/.claude/settings.json`. The desktop app
     does not read shell profiles, so this is the place that covers both:

     ```json
     {
       "env": {
         "MEDIA_GEN_API_KEY": "sk-or-v1-..."
       }
     }
     ```

     If the file already has an `"env"` block, add the line inside it.
   - **An agent started from a terminal**: `export MEDIA_GEN_API_KEY=sk-or-v1-...` in your shell
     profile (`~/.zshenv` on macOS).
   - **Codex**: it does not pass your shell environment to MCP servers on its own. Export the key in
     your shell profile as above, and list it in `env_vars` (see below).
   - **Any other agent**: its own setting for the environment of MCP servers.

   The key then sits in a plain-text file. That is the trade-off for one simple setup that works
   everywhere; the spend limit from step 2 is what keeps it safe.
4. Restart your agent.

If you skip this, nothing breaks: the first time Claude tries to generate, the tool refuses, spends
nothing, and Claude walks you through these steps.

## Using it with another agent

The server is plain MCP over stdio. Point your agent's MCP settings at
`node <this repo>/plugins/media-gen/server/index.mjs`, with `MEDIA_GEN_API_KEY` in its environment.
`plugins/media-gen/skills/generate/SKILL.md` carries the rules (when to ask, what to report). It is
a standard Agent Skills file, so agents that read `SKILL.md` (Codex, Gemini CLI, Cursor, …) can
take it as it is; otherwise give it to your agent the way it takes instructions.

Give tools room to finish. A whole song or a batch of large images can take over a minute, and a
video check can wait up to ten. An agent that gives up sooner reports a failure after OpenRouter has
already charged for the result, and may pay for it twice by retrying. For Codex, in
`~/.codex/config.toml`:

```toml
[mcp_servers.media-gen]
command = "node"
args = ["/absolute/path/to/media-gen/plugins/media-gen/server/index.mjs"]
env_vars = ["MEDIA_GEN_API_KEY"]
tool_timeout_sec = 600
```

## What is inside

| Part | What it does |
|---|---|
| `skills/generate/SKILL.md` | When to generate, when to ask first, how to choose a model, what to report. |
| `server/index.mjs` | A small MCP server with no dependencies. It reads the key and talks to OpenRouter. |

Its tools: `list_models` (free, no key), `generate_image`, `generate_music`, `generate_speech`,
`generate_video` + `video_status`, and `check_balance`. Files are never overwritten: a second
`poster.png` becomes `poster-2.png`.

## Check it without spending

```bash
node scripts/smoke.mjs
```

It starts the server with no key, lists live models, and checks every refusal.
