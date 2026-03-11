---
label: "why glue?"
description: "it could have been called anything.\nwhy something so unglamorous?"
tags: [technology, identity, design]
---

# Why glue?

Of all the things to build - the engine, the interface, the product, the platform - it's glue. The connective layer. The thing between the things. The part nobody sees and nobody celebrates and nobody writes blog posts about.

Why?

## What glue actually does

Glue holds things together that weren't designed to fit. That's about it. Two surfaces that don't naturally bond, and a substance between them that makes them act like one thing.

In software, glue is format conversion. Protocol bridging. Pipeline orchestration. The code that takes the output of one system and makes it the input of another. It's not the database. It's not the frontend. It's the thing that lets the database talk to the frontend without either one knowing the other exists.

In organizations, glue is the person who translates between departments. The meeting that aligns two teams. The document that bridges two vocabularies. The manager who doesn't build anything but makes builders effective.

In relationships, glue is maintenance. The [conversation that repairs](/prose/everything-changes#loss-is-change) a misunderstanding. The compromise that holds two people together across a disagreement. The boring daily rituals that keep connection alive between the dramatic moments.

Nobody writes love songs about glue.

## Why nobody builds it

Glue is invisible when it works. You only notice it when it fails - when the format doesn't convert, when the API breaks, when the departments stop communicating, when the relationship stops getting maintained.

This gives glue a visibility problem. The engine gets the credit. The interface gets the praise. The product gets the launch. The glue that connects them? That's "infrastructure." That's "plumbing." That's the work people do reluctantly because someone has to.

There's no glory in making two things work together that should have worked together in the first place. It feels like janitorial work. Cleanup. Compensation for someone else's failure to design a clean interface.

So ambitious people build engines. They build products. They build the thing with the name and the logo and the launch day. Glue doesn't get launch days. Glue gets inherited by the next developer who wonders why there's a 500-line file called `utils.py` that everything depends on.

## The proof is in the stack

The most successful piece of software ever written isn't an application. It's a kernel. Linux sits between hardware and everything built on top of it - connecting processes to memory, devices to interfaces, userspace to the machine. It runs phones, servers, supercomputers, the cloud, basically everything. Not because it's glamorous. Because it connects everything else.

The most popular programming language isn't the fastest or the most elegant. It's Python - slow by itself, not great at any single thing. But it glues everything together: C libraries to data pipelines, ML frameworks to scripts, fast components to human intent. It won by being the best connective layer, not the best execution layer.

The two most ubiquitous pieces of software on earth are both glue. That pattern seems worth paying attention to.

## The intelligence is in the glue

In any system with more than one component, something interesting keeps showing up - the glue is where the composition happens. And composition is where the interesting stuff tends to live.

Not in any single component. The database doesn't know what the data means. The model doesn't know what the context should be. The interface doesn't know what the user needs. Each component does one thing. The [intelligence - if it exists - emerges](/prose/why-do-i-build-tools#the-whole-point) from how they connect.

This becomes fairly clear once you look at examples. A chess engine isn't intelligent because of its evaluator or its search or its move generator. It's intelligent because of [how those pieces compose](/prose/where-does-meaning-live#emergence-again) - search guided by evaluation, constrained by rules, iterated until something good emerges. Remove any piece and the others are useless. The intelligence is in the architecture, not the components.

The same pattern holds across intelligent systems. Your brain isn't intelligent because of neurons. It's intelligent because of connections between neurons. An organization isn't smart because of smart individuals. It's smart because of how those individuals [communicate and coordinate](/prose/why-is-everything-a-document#the-bridge-problem). A tool ecosystem isn't powerful because of powerful tools. It's powerful because of how the tools compose.

The glue is where composition happens. And composition seems to be where intelligence lives.

## The model isn't the engine

Right now there's a dominant narrative: AI is the model. The model is the intelligence. Everything else is scaffolding.

But look at how AI systems actually work. The model sits in the middle. Above it: context engineering - retrieval, memory, system prompts, conversation history. What the model sees is curated by something else. Below it: tool calls - code execution, verification, grounding, side effects. What the model produces is checked by something else.

The model is a transform. An extraordinarily powerful transform. But it doesn't control its inputs and it doesn't verify its outputs. It's the [middle of a sandwich](/prose/can-you-tell-when-its-wrong#what-catches-the-things-youre-not-measuring), and the bread is where the system quality tends to live.

Bad context, great model? [Hallucination.](/prose/can-you-tell-when-its-wrong#whats-the-hallucination-problem) The model confidently answers the wrong question because it was given the wrong information. Great context, weaker model? Still mostly works. If you feed the right information and [verify the output](/prose/how-do-i-know-this-code-is-good), even a modest model produces useful results.

The leverage isn't in the model. It's in what wraps the model. The context layer. The verification layer. The orchestration. The glue.

## Boundaries

What does glue actually remove? Boundaries.

The boundary between raw data and structured information. The boundary between one file format and another. The boundary between the thing you have and the thing you need. Between the tool's output and your understanding. Between what the computer knows and what you can see.

[Software is hard](/prose/why-is-software-hard) - computers aren't stupid, boundaries are just everywhere. Every app is an island. Every format is a wall. Every protocol is a gate. The work of using a computer is mostly the work of crossing boundaries - copy-paste, export-import, save-as, [bridge after bridge](/prose/why-is-everything-a-document#the-bridge-problem) between things that should flow freely.

Glue removes boundaries. Not by making everything the same - that's a platform, and platforms [have their own problems](/prose/why-did-things-stop-being-personal#what-did-platforms-replace). By making things connectable without requiring them to be identical. By translating, not flattening. By bridging, not merging.

That's harder than it sounds. Good glue preserves what matters about each side while removing only the barrier between them. Bad glue destroys the things it connects. The art is in knowing what to preserve.

## It could have been labeled anything

There's a project. An ecosystem, really. A collection of tools for structural code intelligence, format conversion, pipeline orchestration, expression evaluation, runtime bridging. It could have been [labeled anything](/prose/what-are-labels-anyway). "Platform." "Framework." "Infrastructure." "Developer tools." All accurate, all misleading.

It's called [rhi](https://rhi.zone/). And its tagline is: "A glue layer for computers. Removing boundaries between you and your computer."

Not an engine. Not a model. Not a product. A glue layer. The thing between things. The [connective tissue](/prose/why-is-everything-a-document#the-bridge-problem) that makes separate tools act like one surface.

That's a strange thing to commit to building. It's choosing the invisible layer. The one that gets no credit when it works and all the blame when it breaks. The one that isn't the thing you use - it's the reason the things you use can work together.

Why would you choose that?

## Why something so unglamorous?

Because glamour tends to be a trap.

The glamorous things - the engine, the model, the product - get attention, funding, prestige. They also get [optimized into convergence](/prose/why-is-nothing-special-anymore). Everyone builds the same engine because everyone's chasing the same metrics. Everyone builds the same product because everyone's copying the same patterns. The glamorous layer is where competition lives, and competition tends to produce sameness.

The glue layer is where nobody's looking. Which means it's where [the interesting work tends to be](/prose/why-do-i-reinvent-everything#what-if). The assumptions are unexamined. The problems are unsolved. The patterns haven't calcified because nobody's been paying attention long enough to calcify them.

And the glue layer is where the most leverage seems to be. A better engine improves one system. Better glue improves every system it connects. A [better format converter](/prose/why-do-i-build-tools#the-legibility-obsession) unlocks every tool that can now read the format. A better protocol bridge connects every service on both sides. Glue is a multiplier. Engines are additive.

So: why glue?

Because it's where the composition happens. Because it's where the leverage seems to be. Because it's where nobody else is building. Because the unglamorous thing that connects everything might be more important than the glamorous thing that does one thing well.

And because someone has to. The engines exist. The models exist. The interfaces exist. What's missing - what's always missing - is the thing that makes them work together. The invisible layer. The [thing you don't notice until it's gone](/prose/what-do-we-keep-losing).

## See also

- [why do i build tools?](/prose/why-do-i-build-tools) - making the opaque legible
- [why is everything a document?](/prose/why-is-everything-a-document) - boundaries that shouldn't exist
- [can you tell when it's wrong?](/prose/can-you-tell-when-its-wrong) - why the wrapper matters more than the model
