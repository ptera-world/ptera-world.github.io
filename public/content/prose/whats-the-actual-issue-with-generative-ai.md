---
label: "what's the actual issue with generative AI?"
description: "not what people say it is.\nnot what you'd expect."
tags: [ai, social]
---

# What's the actual issue with generative AI?

Not copyright. Not job loss. Not "it's just [interpolation](/prose/is-it-just-interpolation)." Those are real concerns, but they're downstream of something more fundamental.

The issue that keeps coming up is that the output of generative AI doesn't fully reflect [anyone's intent](#whose-intent).

## Whose intent?

[Art is intent.](/prose/what-is-art) You meant it. You chose this over that. The choosing is the art. Every prior tool preserved that relationship. A paintbrush doesn't have intent - but the person holding it does, and every stroke is a choice. A camera doesn't have intent - but framing, timing, angle are all choices. The tool shapes the output, but the intent flows through it.

Generative AI breaks that chain. You type a prompt. The model makes thousands of choices - composition, color, phrasing, structure, tone, emphasis. You didn't make those choices. The model might have its own version of intent - [if it looks like intent, it probably is](/prose/is-it-just-interpolation). But it's not *your* intent. The choices in the output aren't yours.

The prompter has intent - "I want something like this." But the gap between that intent and the output is filled entirely by the model. The specific *how* - the part that, in every other medium, is where the art lives - isn't the prompter's.

## Why does this matter?

It's not that the output is bad. It's often good. Sometimes beautiful. Sometimes indistinguishable from things made with deep intent. And that's where it gets complicated.

When the output *looks like* someone meant every detail - but the prompter didn't choose those details - something shifts in how we relate to made things. We've always read intent into artifacts. We see a painting and imagine the person who chose *that* color. We read a sentence and feel the writer reaching for *that* word. Generative AI produces artifacts that invite that reading, but the person behind the prompt didn't make those choices. The [residue](/prose/this-is-not-a-personal-website) of a process where the intent and the choices lived in different places.

This isn't the same as mass production. A factory-made chair was designed by someone. The choices were made once, then reproduced. Generative AI makes new choices every time - and they're not the prompter's.

## What's the spectrum look like?

It's [not that simple](/prose/its-not-that-simple), of course. A person who generates a hundred images and carefully selects one - is the selection intent? A person who iterates on a prompt for hours, refining toward a vision - is that vision intent? A person who takes AI output and modifies it, combines it, builds on it - at what point does their intent enter the work?

There's no clean line. The intent isn't binary - present or absent. It's a question of *how much* of the output reflects someone's choices versus the model's. And that ratio varies wildly. A one-shot generation with a vague prompt is almost entirely the model's choices. A careful, iterative process where the human rejects and refines and selects - that's closer to intent flowing through a tool.

Image generation makes this visible. Regional prompting, LoRAs, text embeddings, IPAdapter, ControlNet, model switching - each one narrows the gap between what you meant and what the model produces. You can control the composition, the style, the palette, the pose, the structure. Each tool gets you closer to specifying your intent. None of them close the gap entirely. The specific choices that make *this* image *this* image - those are still the model's. Not yours.

And the more control you stack, the more it starts to resemble just... drawing it. The asymptote of maximum control over an image model is a drawing program. The tools exist because people want intent without craft - and the space between what they can specify and what the model fills in is exactly where the prompter's intent is absent.

Code makes the spectrum even more visible. "Vibe coding" - asking a model to build something and letting it run - puts almost nothing of you into the output. The model picks the architecture, the patterns, the names, the edge cases. Your intent was "I want a thing." The thing you got is the model's choices, not yours.

On the other end: structuring constraints, encoding design principles, maintaining oversight, saying "no" until the output reflects what you meant. Some call this "agentic engineering" - a different label for a different point on the same spectrum. The mechanism is identical. You shape the input. The model fills the space. The difference is how much of yourself you put into the input.

The labels split it into two things. It's one spectrum. And the distance between the ends - between "oops, it wiped my hard drive" and "hundreds of thousands of lines that carry my architectural intent" - is the same distance as between a vague image prompt and a carefully controlled generation pipeline. The act is the same. The intent is what differs.

[But](/prose/but) even in the most careful process, the specific *how* - the micro-decisions that make this output *this* and not *that* - those are the model's. Not the prompter's.

## Is this a new problem?

A director doesn't act. A conductor doesn't play. An architect doesn't lay bricks. The intent lives in one person, the execution in another - and we've always accepted that the result carries the director's vision. "The computer did it" has been leveled at Photoshop, digital painting, Houdini, procedural generation. Every time a tool automated part of the craft, the same objection appeared. And every time, the answer was: the human's intent flows through the tool. The craft changed. The intent didn't.

So what's actually new? Not the split between intent and execution. That's ancient. What's new is that every previous tool had a floor. You couldn't use Photoshop without *some* craft, *some* intentful choices. The tool automated parts of the process, but you still had to do something.

Generative AI removes the floor. One sentence in, a finished thing out. And then feed that into another model. And another. Each layer dilutes whatever intent was in the original prompt. Recursive generation can reduce the human's contribution to near-zero - intent at parts per billion.

The spectrum didn't just get wider. It extended all the way to the ground. No previous tool did that.

## Where does the intent actually live?

[But](/prose/but) this framing - "the prompter has no control" - isn't quite right either. The prompter controls the *input*. What you put in, what you leave out, how you structure it - that determines which region of the [function](/prose/who-is-generative-ai) the output comes from. You don't control the micro-choices. But you shape the space they're made in.

The more carefully you shape the input, the more your intent shows through in the output - even though you never touched the output directly. A vague prompt gives you almost nothing of yourself back. A carefully structured input, iterated and refined, produces output that carries your intent even in details you didn't specify. Not because you chose those details. Because you shaped the space they emerged from.

That's a new kind of intent. Not hand-on-the-brush intent. Not even conductor-leading-the-orchestra intent. Something closer to: you built the room, and the room shaped what happened in it.

## What doesn't this mean?

This isn't "AI bad." This isn't "AI art isn't real art." Those are [labels](/prose/what-are-labels-anyway) that end conversations.

It means the relationship between maker and made is changing in a way we don't have language for yet. Every tool before this was a channel for human intent. This tool generates its own choices from a space the human shapes. That's new. The prompter's intent lives in the input. The model's choices live in the output. The relationship between them - how input-shaping becomes output - is the thing we don't have a word for.

Whether it's a problem depends on [what you think art is for](/prose/what-is-art). Whether intent in the input counts the same as intent in the output. Whether shaping the space is the same as making the thing.

That seems like the actual issue. Not the economics. Not the legality. The question of where intent lives when the maker and the making are split across two entities - and what that means for everything we thought we knew about [who made this](/prose/the-great-deceit).

## See also

- [what is art?](/prose/what-is-art) - art as intent, not medium
- [is it just interpolation?](/prose/is-it-just-interpolation) - the technical dismissal
- [the great deceit](/prose/the-great-deceit) - authorship and what it means
- [it's not that simple](/prose/its-not-that-simple) - the spectrum of intent
- [what are labels anyway?](/prose/what-are-labels-anyway) - "AI art" as a label that flattens
- [who is generative AI?](/prose/who-is-generative-ai) - the function behind the choices
- [but.](/prose/but) - holding both halves
