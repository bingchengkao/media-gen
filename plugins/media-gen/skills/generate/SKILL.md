---
name: generate
description: Make images, music, speech and video with today's best models on OpenRouter — Nano Banana, FLUX, Lyria and whatever is newest — saved straight into the project. Use this whenever the work would be better with real media than a placeholder, even if the user never says "generate" — a hero image or background for a page, sprites or textures for a game, a logo direction or mood picture, a jingle or loop for an animation, a voice-over or narration (生圖、畫一張、配樂、做首歌、配音、旁白). It picks the right model for the job, checks every result against the brief and redoes the ones that miss, then says which model it used and what it cost. Spends the user's own OpenRouter credit, so it asks before the first generation. Video only when the user brings it up.
---

# Generate

You can make images, music, speech and video through OpenRouter with the `media-gen` tools. Every
generation spends the user's money, from a key they set up themselves. You never see that key and
never ask for it.

## Before you spend

- **The first generation in a conversation**: tell the user you are about to start generating with
  the paid API, and wait for a yes. You don't need to say which model.
- **After that**, go ahead without asking — unless one request makes 8 or more items, or you
  estimate it at US$1 or more. Then say how many, with which model, roughly what it costs, and wait.
- **Video** is expensive and slow. Don't offer it unless the user brought video up. Before every
  video — every one, whatever they agreed to earlier — say the model, the length, the estimated
  cost and the wait, and get a yes.

These hold whoever asked for the generation: the user, or another skill working for them.

## Choosing a model

New models come out every month, so don't trust names you remember. Call `list_models` for the
medium and choose from what is there today. The choice is yours; you don't need the user's approval.

- **Images**: look first in the Nano Banana (Google's Gemini image models) and FLUX (Black Forest
  Labs) families, and take the newest that fits the job. Step outside them when the job needs what
  they can't do — a transparent background, SVG output, lettering they keep getting wrong.
- **Music**: a short clip for a loop or a sting, a full-song model for a whole song.
- **Speech**: make sure the voice speaks the language of the text.
- **Video**: check the durations, resolutions and price per second before you pick.

Before you first use a model in a conversation, read its guide at
`https://openrouter.ai/<model id>/llms.txt` for the fields it accepts, and look up how its maker
says to prompt it. Write the prompt the way that model wants it. Token-priced estimates in
`list_models` assume one standard 1K image; bigger or high-quality images cost several times more,
and the first real result tells you the true price.

Save it where the work belongs: `out_path` decides that. If the folder has its own conventions
(its CLAUDE.md usually says), follow them.

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
  restarts Claude Code.
