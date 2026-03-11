---
label: "why is everything a document?"
description: "paper had pages.\nso now everything has pages.\nbut information doesn't."
tags: [design, technology]
---

# Why is everything a document?

Open a note app. You get a blank page. Open a word processor. Blank page. Open a presentation tool. Blank slide - which is just a page turned sideways. Open an email. A page with fields. Open a spreadsheet. A grid - which is just a page pretending to be structured.

Everything is a document. Everything is a [flat surface with content arranged in reading order](#whats-the-paper-metaphor). And nobody questions this because paper was a document and screens replaced paper and the metaphor carried over unexamined for forty years.

But information isn't a document. Information is [objects with relationships](#what-is-information-actually). And the gap between "a page" and "objects with relationships" is where a lot of software difficulty seems to live.

## What's the paper metaphor?

Paper is flat. Paper is linear. Paper has a beginning and an end. Paper is one thing - you can't have half a thought on one page and the other half dynamically linked to a page across the room.

These aren't features of information. They're features of *paper*. Constraints imposed by a physical medium that got transferred wholesale into a digital medium that doesn't have those constraints.

A digital note doesn't need to be a page. It could be a node in a graph. A thought connected to other thoughts, with the connections visible and navigable. A digital spreadsheet doesn't need to be a grid. It could be a set of relationships - this depends on that, which flows into this, which constrains that. A digital presentation doesn't need to be a sequence of slides. It could be a [space you navigate](#what-if-it-wasnt-a-page).

But "a page" is what people expect because "a page" is what they've always gotten. The metaphor [calcified](/prose/why-do-i-reinvent-everything#how-does-popularity-become-a-ratchet). And now even software that could break free of it doesn't, because "it looks like a document" is the fastest way to feel familiar.

## What is information actually?

Think about any complex thing people know well. A project being worked on. A subject studied deeply. A community you're part of. A recipe you've adapted over years.

Is it a document? Is it a flat surface you read top to bottom?

No. It's a web. The project has tasks that depend on other tasks. The subject has concepts that connect to other concepts. The community has people who relate to other people. The recipe has ingredients that substitute for other ingredients depending on context.

Information is *objects* - discrete things with properties - and *relationships* - connections between those things that carry meaning. A note is an object. A tag is a relationship. A link is a relationship. A dependency is a relationship. A reference is a relationship.

Documents flatten all of this into reading order. First this, then this, then this. The relationships become invisible - implied by proximity or explicitly written out as cross-references that you have to maintain by hand. "See section 3.2" is a relationship pretending to be text.

## What's the bridge problem?

This is where it gets concrete. You have information in one place and you need it in another.

A spreadsheet has data. You need it in a presentation. So you copy-paste it, and now you have two copies that will immediately diverge. Or you "embed" it, which sort of works until it doesn't. Or you screenshot it, which is literally taking a photo of your data.

A note has an idea. A related note has another idea. You want to see them together. So you copy one into the other - and now the copy is frozen. Or you link them - but the link just takes you to the other page, it doesn't let you see both in context.

An email has a decision. A project tracker has a task. A document has a spec. They're all about the same thing. They live in three different apps. None of them know about each other.

Every "bridge" between documents is a hack. Copy-paste, embed, link, export-import, integration, API - all workarounds for the fact that the document metaphor doesn't support relationships. Each document is an island. The connections between them are your problem.

This isn't a hard technical problem. It's a [metaphor problem](/prose/why-is-software-hard#why-hasnt-it-changed). The document metaphor assumes information lives *in a place* - on a page, in a file, in an app. Information actually lives *in relationships* - between ideas, between contexts, between uses.

## What if it wasn't a page?

Imagine opening your note app and instead of a blank page, you see your thoughts as objects in space. Each one has a shape based on what it is - a question, an idea, a reference, a task. They cluster naturally by relationship. You can zoom into any cluster and see the details. You can draw connections between things that relate. You can see, at a glance, not just *what you wrote* but *how it connects*.

Some tools try this. Mind maps. Graph-based note apps. Spatial canvases. They're all reaching for the same thing: information that isn't flat. But they're still working within the document metaphor. The canvas is a page. The graph is rendered on a page. The mind map is a document that happens to branch.

The metaphor runs deep. Even the alternatives tend to be documents pretending to be something else.

## Why does it stay?

The document metaphor stays because it's [legible](/prose/why-do-i-build-tools#why-the-obsession-with-legibility). Everyone understands a page. Everyone can write on a page. A page requires no training. The metaphor is so deeply embedded that alternatives feel alien - not because they're worse, but because they're unfamiliar.

And familiarity is a [powerful ratchet](/prose/why-do-i-reinvent-everything#how-does-popularity-become-a-ratchet). Every new tool that launches with a document metaphor reinforces it. Every user who learns "information goes on pages" carries that expectation to the next tool. The metaphor self-perpetuates.

Breaking it requires asking a question that sounds absurd: "what if we didn't use pages?" It sounds absurd because *of course* we use pages. How else would you organize information?

In objects and relationships. Like your brain already does. Like the information already is. The page was never the natural shape of thought. It was the natural shape of *paper*. And we're not using paper anymore.

## See also

- [why is software hard?](/prose/why-is-software-hard) - the frozen paradigm underneath
- [why do i reinvent everything?](/prose/why-do-i-reinvent-everything) - questioning assumptions by rebuilding
- [why do i build tools?](/prose/why-do-i-build-tools) - making the opaque legible
- [where does meaning live?](/prose/where-does-meaning-live) - the gap between structure and use
