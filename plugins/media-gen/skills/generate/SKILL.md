---
name: generate
description: Use when the work would be better with a generated image, piece of music, spoken line or video — a picture to show a direction, a texture or background to build with, a jingle, a narration. Makes it through OpenRouter on the user's own key, so it spends their money. Video only when the user brings it up.
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

## When it comes back

- Look before you show it. Read every image you made and judge it against what was asked. If it
  misses, one targeted retry — it counts toward the spend.
- Save it where the work belongs. If the folder has its own conventions (its CLAUDE.md usually
  says), follow them.
- Tell the user, in their language, which model you used and what it cost. The tool reports the
  charge; if it says the charge wasn't reported, say that rather than guess. If the key is running
  low, say that too.

## When the key is missing or refused

The tool says what went wrong; pass it on in plain words. The user adds or changes the key in this
plugin's settings themselves. Never ask them to paste it into the chat.
