---
label: "why can't you just use what exists?"
description: "the answer everyone expects is ego.\nit's not ego."
tags: [identity, technology]
---

# Why can't you just use what exists?

Someone already built it. It works. It's battle-tested. It has documentation, a community, years of bug fixes. Using it would take an afternoon. Building your own version will take weeks. Maybe months. And the result will be worse.

You're going to build it anyway.

## What's the accusation?

"Not Invented Here syndrome." It's always framed as a flaw. An inability to use other people's work. Ego masquerading as engineering judgment. The arrogant belief that you can do it better.

And sometimes it is that. Sometimes people rebuild things out of ego, or ignorance, or a refusal to read documentation. Those cases are real and they're wasteful.

But there's another version that looks identical from the outside and is completely different on the inside. And the accusation — "why can't you just use what exists?" — can't tell them apart.

## What does it actually feel like?

It doesn't feel like ego. It feels like *friction*.

You look at the existing tool. It works. It does the thing. But it does the thing in a way that doesn't match how you think about the problem. The abstractions are wrong — not incorrect, just *wrong for you*. The assumptions encoded in the design are someone else's assumptions. The shape of the tool implies a shape of thinking, and it's not your shape.

You could adapt. Learn to think the way the tool thinks. Thousands of people did. They're productive and happy. There's nothing wrong with the tool.

But adapting means accepting someone else's model of the problem. And your model is different. Not better — [different](/prose/where-does-meaning-live). And the difference matters to you in a way you can't fully articulate, which makes it impossible to defend, which makes it look like ego.

## What are the assumptions you can't see?

Every tool encodes assumptions. A word processor assumes documents are pages. A spreadsheet assumes data lives in grids. A project manager assumes work is a sequence of tasks. These aren't decisions anyone made deliberately — they're [inherited shapes](/prose/why-is-everything-a-document), calcified from the first version, invisible to everyone who grew up using them.

When you use a tool, you absorb its assumptions. They become your assumptions. You stop noticing them. The [spreadsheet's grid](/prose/why-do-i-reinvent-everything#how-does-popularity-become-a-ratchet) becomes "how data works." The project manager's task list becomes "how work works." The assumptions become load-bearing and invisible at the same time.

Building from scratch is how you make the assumptions visible again. Not because your version is better. Because building forces you to confront every decision the original tool made implicitly. "Why is it a grid?" "Why is it linear?" "Why does this come before that?" Most of the time, the answers are good. Sometimes they're not answers at all — just "because the first version did it that way."

Those non-answers are where [the interesting work lives](/prose/why-do-i-reinvent-everything#what-if).

## What's the understanding that doesn't transfer?

Reading documentation tells you how a tool works. Building a version tells you *why*.

There's a depth of understanding that only comes from implementation. You can read about how a database indexes data, or you can build an index and discover why B-trees won the argument. You can read about why a compression algorithm makes certain tradeoffs, or you can build a compressor and feel the tradeoffs resist each other.

This understanding doesn't transfer through documentation. It transfers through [contact with the problem](/prose/how-do-i-know-this-code-is-good#how-does-trust-accumulate). The problem pushes back. Your naive approach fails. You discover why the existing tool made the choices it did — not because someone told you, but because you hit the same walls.

That's not wasted effort. That's the most efficient way to learn why things are the way they are. And sometimes — occasionally — you hit a wall that the existing tool also hit, and you find a different way around it. That's when rebuilding produces something genuinely new. Not better by every metric. Just different in a way that [opens paths the original closed off](/prose/why-do-i-reinvent-everything#what-if).

## Is it ego?

Here's the part that's hard to admit. Some of the pull isn't intellectual. It's personal.

Using someone else's tool means your output has their fingerprints on it, not yours. [The choices visible in the result](/prose/am-i-just-pretending#is-directing-a-craft) are their choices — their abstractions, their architecture, their design. Your contribution is filling in the blanks they left for you. Parameters in their function. Content in their template. Data in their schema.

Building your own means the choices are yours. Even if the result is worse by every objective measure, it's *yours* in a way that using someone else's work can never be. The shape reflects your thinking. The architecture embodies your understanding. The limitations are your limitations, not inherited ones.

This sounds like ego. And maybe it is. But it's also the mechanism by which [new ideas enter the world](/prose/there-used-to-be-two-kinds-of-programmer#what-got-lost). Every genuinely new tool started as someone refusing to use what existed — not because they thought they could do better, but because they wanted to think differently about the problem. The personal motivation and the creative output are the same thing.

## When should you actually just use what exists?

Not every itch should be scratched. Sometimes the existing tool is right and you're being stubborn. Here's when to use what exists:

When your goal is the output, not the understanding. If you need to get something done and the existing tool gets it done, use it. The pull to rebuild is about understanding, and if understanding isn't the goal, rebuilding is procrastination.

When the problem is solved and you know it. Not "solved well enough" — actually, fully solved. If you can't articulate what would be different about your version, you don't have a different model of the problem. You just have the same model and an unwillingness to use someone else's implementation of it.

When the cost is someone else's time. Rebuilding infrastructure that a team depends on because you don't like the existing tool's abstractions is imposing your preferences on other people. Your understanding isn't worth their disruption.

## When should you build anyway?

When the friction is real. When using the existing tool requires you to think about the problem in a way that produces worse results — not just unfamiliar results, genuinely worse ones. When the tool's assumptions actively prevent you from doing what you're trying to do.

When the understanding matters more than the output. When you're trying to learn something deep about a domain and the only way to learn it is to [build from the ground up](/prose/why-do-i-reinvent-everything). When the point isn't the artifact but the knowledge that comes from making it.

When you have a question. "What if this were different?" is a valid reason to rebuild. Not because the answer will be useful. Because [the question itself is valuable](/prose/are-we-building-toward-something#are-we-optimizing-for-interesting), and you can't answer it without building the alternative.

The NIH instinct isn't always right. But it's not always wrong either. And the people who never feel it — who always use what exists, who never rebuild, who never ask "but what if?" — are the people who inherit every assumption without examining any of them.

Sometimes the wheel needs reinventing. Not because it's broken. Because [you don't know why it's round until you try making it square](/prose/why-do-i-reinvent-everything#how-does-popularity-become-a-ratchet).

## See also

- [why do i reinvent everything?](/prose/why-do-i-reinvent-everything) - the exploration that comes from rebuilding
- [where does meaning live?](/prose/where-does-meaning-live) - encoded assumptions as invisible walls
- [am i just pretending?](/prose/am-i-just-pretending) - fingerprints and craft
- [there used to be two kinds of programmer](/prose/there-used-to-be-two-kinds-of-programmer) - exploring vs shipping
