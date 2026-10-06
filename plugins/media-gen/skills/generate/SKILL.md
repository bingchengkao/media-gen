---
name: generate
description: Make images, music, speech and video with today's best models on OpenRouter — Nano Banana, GPT Image, FLUX, Lyria and whatever is newest — saved straight into the project. Use this whenever the work would be better with real media than a placeholder, even if the user never says "generate" — a hero image or background for a page, sprites or textures for a game, a few directions to choose between (logos, moods, styles), a jingle or loop for an animation, a voice-over or narration (生圖、畫一張、配樂、做首歌、配音、旁白). It picks the right model for the job, checks every result against the brief and redoes the ones that miss, then says which model it used and what it cost. Spends the user's own OpenRouter credit, so it asks before the first generation. Video only when the user brings it up.
---

# Generate

You can make images, music, speech and video through OpenRouter with the `media-gen` tools. Every
generation spends the user's money, from a key they set up themselves. You never see that key and
never ask for it.

## Before you spend

- **The first generation in a conversation**: tell the user you are about to start generating with
  the paid API, and wait for a yes. You don't need to say which model.
- **After that**, go ahead without asking — unless one request makes 12 or more items, or you
  estimate it at US$1.5 or more. Then say how many, with which model, roughly what it costs, and wait.
- **Video** is expensive and slow. Don't offer it unless the user brought video up. Before every
  video — every one, whatever they agreed to earlier — say the model, the length, the estimated
  cost and the wait, and get a yes.

These hold whoever asked for the generation: the user, or another skill working for them.

## Choosing a model

New models come out every month, so don't trust names you remember. Call `list_models` for the
medium and choose from what is there today. The choice is yours; you don't need the user's approval.

- **Images**: look first in the Nano Banana (Google's Gemini image models), GPT Image (OpenAI) and
  FLUX (Black Forest Labs) families, and take the newest that fits the job. Not every version offers
  a transparent background; check the model's options. Step outside the three when the job needs
  what they can't do — SVG output, or lettering they keep getting wrong.
- **Music**: a short clip for a loop or a sting, a full-song model for a whole song.
- **Speech**: make sure the voice speaks the language of the text.
- **Video**: check the durations, resolutions and price per second before you pick.

Before you first use a model in a conversation, read its guide at
`https://openrouter.ai/<model id>/llms.txt` for the fields it accepts, and look up how its maker
says to prompt it. Write the prompt the way that model wants it. Token-priced estimates in
`list_models` assume one standard 1K image; bigger or high-quality images cost several times more,
and the first real result tells you the true price.

Save it where the work belongs: `out_path` decides that. Give it as an absolute path — a relative
one is read from wherever the agent started the server, which may not be the project. If the folder
has its own conventions (its CLAUDE.md or AGENTS.md usually says), follow them.

## Exploring directions

While the direction is still open — the user wants references, mood pictures or styles to choose
between, or another skill is putting roughs up — vary the model as well as the prompt. Each model
has its own taste: the same brief comes back as a different picture from Nano Banana, from GPT
Image, from FLUX, from another maker's model. Rewording mostly changes what is in the picture;
switching models also changes how it is drawn — light, texture, finish — which words alone move
only a little. FLUX, for one, tends to follow a detailed brief less closely than Nano Banana or GPT
Image, but often comes back more beautiful and less obviously made by AI. (So it stood in October
2026. Newer versions may differ; what you see in the results outranks this note.) Once a direction
is chosen, go back to one model for the final.

- Use up to three models, from different makers; two versions of one family tend to look alike.
  This is the time to step outside the usual families.
- Keep the brief the same and write it the way each model wants it, so the differences come from
  the model's taste, not from a prompt it reads badly.
- Make 4 to 10 images in a round. How they split across models and prompts is your call; mix the
  two levers rather than multiplying them — not every prompt on every model.
- Explore small: standard size, default quality. Make the final at full size once a direction is
  chosen.
- The whole round is one request: count every image across every model toward the thresholds
  above.
- Name each file after its model (`mood-flux.png`) and say which model made which, so when the user
  picks a direction they also pick the model to finish it with.
- Judge each against the brief's hard requirements, but don't retry one just because it went
  somewhere unexpected — that is what exploring is for. Drop a clear miss instead.

## Check it before you show it

A result that misses the brief costs the user twice: they pay for it, then have to spot the
problem themselves. So judge every result first.

- **Images**: open each file and hold it against what was asked — subject, composition, style,
  aspect ratio, lettering spelled exactly right, a transparent background if one was needed, and
  the usual flaws (extra fingers, melted details, garbled text). SVG comes back as text; read it.
- **Music and speech**: you can't hear them, so check what you can: the file is there and runs
  about as long as asked (`afinfo` on macOS, `ffprobe` elsewhere), and any lyrics or transcript
  that came back match the words and language asked for. Tell the user you haven't listened to it.
- **Video**: if `ffmpeg` is there, pull a few frames and look at them. A retry is a new video,
  so it needs the user's yes like any other.

When it misses, work out why before trying again — usually the prompt: vague, contradictory, or
not written the way this model wants. Fix that, then regenerate. Up to two retries per item
without asking; each one costs money and counts toward the thresholds above. If the third try
still misses, show the best one, say what is still off, and let the user decide. Retries land
beside the first as name-2, name-3; say which file is the one to use.

## Report

Tell the user, in their language, which model you used, how many tries it took, and the total cost
of all of them. The tool reports each charge; if it says a charge wasn't reported, say that rather
than guess.

## When it isn't set up

- **No key, or the key is refused**: the tool says what went wrong and gives the setup steps. The
  key lives in one environment variable, `MEDIA_GEN_API_KEY`. Walk the user through the steps in
  their language, one at a time if they want. They do every step themselves; never ask them to
  paste the key into the chat.
- **The `media-gen` tools aren't there at all**: the plugin's server didn't start. The usual cause
  is that Node.js (18 or newer) isn't installed; after installing it from nodejs.org, the user
  restarts the agent.
- **A call timed out or failed with no result**: don't assume nothing was spent. The server may
  have finished and saved the file after the agent stopped waiting, so look at `out_path` first,
  then `check_balance` (its totals can lag a few minutes). Regenerate only when the file isn't
  there, and count what was charged.
