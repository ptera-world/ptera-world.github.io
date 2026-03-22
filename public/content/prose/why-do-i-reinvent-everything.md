---
label: "why do i reinvent everything?"
description: "not because i think i can do it better.\nbecause i want to know what happens if."
tags: [identity, technology]
---

# Why do I reinvent everything?

Every project starts the same way. Sketch an idea. Get excited. Start building. And then, inevitably, someone asks: "aren't you just reinventing the wheel?"

Yes. Probably. Let's do it anyway.

## The ritual

It's become a ritual at this point. Every single project gets the question. Sometimes you ask yourself. Sometimes someone else asks. Sometimes the LLM asks.

Are we reinventing this? Are we rebuilding that? Are we just making a worse version of something that already exists?

The answer is almost always yes. And the answer to "should we stop?" is almost always no.

## Not because I think I can do it better

To be clear about what this isn't - it's not ego. It's not "I'm smarter than the people who built the original." They did incredible work. Years of it. Battle-tested, community-supported, production-hardened work.

The point is [what you learn on the way](#what-if).

## What if?

The instinct isn't "I can do this better." It's "what if I do this differently?" What if document conversion wasn't a monolith but a pipeline of tiny transforms? What if code analysis used a query language instead of hand-written visitors? What if a decompiler had pluggable frontends and backends instead of one hardcoded path?

These aren't improvements. They're *explorations*. The existing tool made choices. Reasonable choices, often. But choices that closed off other paths. Reinventing is reopening those paths to see where they go.

Sometimes they go nowhere. That's fine. [Failed prototypes](/prose/why-is-perfectionism-a-trap) are how you map the territory. A dead end is still information.

## What trap does the instinct avoid?

"Well let's just use this because everyone else does."

That's the trap. Popular tools aren't bad. But [popularity is a ratchet](#how-does-popularity-become-a-ratchet). Once something is standard, it's invisible. Its assumptions become your assumptions. Its limitations become "just how things are." Its paradigm becomes the only paradigm.

Spreadsheets are freeform grids because VisiCalc was a freeform grid. Note apps are documents because paper was documents. [Programming is text because teletypes were text](/prose/why-is-software-hard). Nobody chose these things. They just happened, and then they [calcified](#the-things-we-keep-losing).

Reinventing - badly, naively, from the wrong angle - is one way to notice the calcification. It's hard to see the water you're swimming in until you try to swim in something else.

## How does popularity become a ratchet?

Good software sometimes wins. But winning locks everything in. The winner's interface becomes the standard. The standard becomes the assumption. The assumption becomes invisible. And then when someone asks "why is it like this?" the answer is "because that's how it is."

[Excel doesn't need to be freeform](/prose/why-is-software-hard). But it is, because VisiCalc was. Notes apps don't need to be linear documents. But they are, because paper was. Filesystems don't need to be hierarchical. But they are, because directories were easier to implement than tags in 1970.

Every reinvention is a question: "what if this assumption wasn't load-bearing?" Sometimes it is. Sometimes the assumption exists for deep structural reasons and you discover those reasons the hard way. That's also valuable. Now you know why it's like this, instead of just accepting that it is.

## The things we keep losing

HyperCard let anyone make interactive things. It died - Apple [didn't prioritize it](/prose/what-do-we-keep-losing). LambdaMOO proved that collaborative worldbuilding works. It faded - the web ate everything.

The things we lose aren't failures. They're [unexplored branches](/prose/this-is-not-all). And once they're gone, nobody reinvents them because nobody remembers they existed.

So: reinvent. The wheel isn't broken. But the wheel is the only shape anyone remembers, and maybe a [triangle has interesting properties too](/prose/but).

## The cost

It's worth being honest about the cost. Reinventing everything means:

- Dozens of projects at various stages of completion
- No single thing polished enough to point at and say "here, use this"
- The constant question of [whether any of this matters](/prose/am-i-just-pretending)
- A workshop full of prototypes and no products

And yet the cost of exploration has collapsed. The seven failed prototypes that used to span years now fit in a month.

That changes the calculus. When exploration is expensive, you should use the wheel. When exploration is cheap, you should question it. You won't build a better wheel. But you might discover the wheel was never the right shape for what you actually needed.

## The question underneath

"Why do you reinvent everything?" has an implied "instead of shipping something."

Fair. [Shipping is different from exploring.](/prose/why-do-i-build-tools) And exploring is more comfortable. It's always more interesting to start than to finish. Every reinvention is a fresh start disguised as progress.

But the explorations aren't random. They're all asking the same question: [why is software shaped this way, and what happens if it isn't?](/prose/why-is-software-hard) That question doesn't have a shipping date. It has a direction. And the direction is: make things that are opaque [legible](/prose/why-do-i-build-tools), make things that are locked-in [flexible](/prose/the-right-tool-for-the-job), and see what [emerges](/prose/why-do-i-build-tools#whats-the-whole-point).
