---
label: "this site is designed."
description: "every pixel is a decision.\nevery compromise is intentional."
tags: [design, introspective]
cluster: meta-essays
---

# This site is designed.

Not just [manipulative](/prose/this-site-is-manipulative). Designed. Every choice you see - and every choice you don't notice - is intentional. The [layout](#layout), the [color](#color), the [text](#text), the [compromises](#the-compromises). This isn't a site that happens to look a certain way. It's a site where every element is a decision about how ideas should be experienced.

## Layout

Every node is placed with intent. Not scattered, not random, not auto-arranged. Each position is a decision about what belongs near what. Proximity means connection. Clusters mean themes. Distance means independence. The layout is an argument about how the ideas relate to each other.

But there isn't one layout. There are several. Ecosystem, domain, technology, status - each grouping rearranges the same nodes into different configurations. Same ideas, different structure. The graph restructures itself depending on what question you're asking. Force-directed layout appears when filters are active - the graph reorganizes around your selection, finding new equilibria for the subset you're looking at.

Filters dim non-matching nodes instead of hiding them. The context stays visible. You can see what's *not* selected, faded but present, because removing it entirely would lose the shape of the whole. Even the filtering is a design choice about what absence looks like.

This reflects something about how knowledge works. The structure depends on the perspective. There's no "correct" arrangement. There are lenses. Each one reveals something and dims something else.

## Interaction

The graph is a space, not a page. You navigate it spatially - pan, zoom, arrow keys that move to the nearest node in that direction. WASD. A minimap you can drag. It's treated as a place you're *in*, not a document you're reading.

Progressive disclosure everywhere. Hover a node and it highlights - but so do related nodes, with opacity and scale based on relatedness. Edges brighten and thicken. The graph shows you the *neighborhood* of an idea, not just the idea itself, with the strength of each connection visible in how much each neighbor responds. Ecosystems that partially match a filter are partially opaque - not in or out, but *how much* in. Everything is gradient, nothing is binary.

Click and a card appears beside the node. Click the same node again and the card escalates to a full panel. Each step reveals more without pushing you deeper than you want to go. You control the depth.

The rendering is DOM, not canvas. Text is selectable. Links work. Screen readers can traverse it. CSS transforms are GPU-accelerated, so it's not even a performance trade - it's just choosing the web platform's strengths instead of fighting them.

History navigation. Back and forward move through node focus, not page loads. The graph remembers where you've been. Command palette instead of search - you type what you're looking for and the graph responds, because search implies a list and this isn't a list.

No animations on page load. The graph appears settled, already in place. Motion is reserved for your interactions - when *you* cause change, things move. When you arrive, things are still. A choice about who initiates.

## Color

Color and layout are independently controllable. You can color by domain and lay out by ecosystem. Color by status and lay out by technology. Two visual channels - position and color - encoding two different dimensions of the same data, simultaneously.

This means you can ask two questions at once. "Where does this project sit in the ecosystem?" through layout. "What domain does it touch?" through color. Two lenses, overlaid, without either collapsing into the other.

It's less a feature than a philosophy. Information shouldn't require you to pick one perspective. You should be able to [hold multiple views at once](/prose/its-not-that-simple). Not binary. Not a spectrum. Composable.

## Text

The titles are lowercase. The descriptions are lowercase. The tone is peer-to-peer, not authoritative. A choice about power - the site isn't trying to talk down to you.

Second person. "You." Not "one" or "people." [That's manipulative](/prose/this-site-is-manipulative), yes. It's also a design choice about distance. The site speaks to you specifically because generic address creates detachment, and detachment makes it easier to dismiss ideas without sitting with them.

The tone avoids negative language. No outrage, no condemnation, no "this is broken" or "this is wrong." Even essays about [what's actually wrong](/prose/whats-actually-wrong) describe the situation without piling on. Not because the author isn't negative - they are, plenty. But negative language on a public page has no positive expected value. Someone in a fine headspace gets outrage. Someone already not OK gets something closer to despair. There's no version where it helps. The restraint isn't optimism. It's the most calculated kind of compassion - just not wanting to make things worse for whoever happens to be reading.

Section bodies are dimmed by default. The headers carry the argument. The body is there if you want depth, but the structure is readable without it. A choice about information density - the reader controls how deep they go, and the site doesn't punish skimming or reward it.

Interlinks everywhere. Every essay links out - to other essays, to other sections, to projects. The text is linear because [reading is linear](#the-compromises). The links are escape hatches for the reader who doesn't need the scaffolding.

## The compromises

Ideas are a graph. Reading is linear. That tension doesn't have a clean solution.

The essays are a concession. Each one takes a cluster of interconnected ideas and flattens them into a sequence - start, middle, end. That's a [compression](/prose/why-are-we-compressing-things). It loses the shape of the ideas to gain readability. Every section order is a choice about what comes first, and every choice implies a priority that doesn't exist in the actual ideas.

You could break every concept into an atomic node - one paragraph, one idea, linked freely. A pure graph of thoughts. More honest. And unreadable. The reader needs scaffolding. Some grouping. Some "read these together because they build on each other." The essay provides that scaffolding - not because the ideas need linearity, but because the reader does.

So the interlinks and intralinks work against the medium from inside it. The essay is linear. The links are not. The essay says "read this next." The links say "or go here instead." The reader can follow the line or break out of it. Both paths are designed. Neither is accidental.

Every trade-off between fidelity and comprehension is deliberate. Every place where the graph got flattened into text, where the nonlinear got forced into sequence, where honesty was traded for readability - those aren't limitations. They're design choices. Made with [intent](/prose/what-is-art). Like everything else here.

## See also

- [this site is manipulative](/prose/this-site-is-manipulative) - one aspect of the design
- [it's not that simple](/prose/its-not-that-simple) - composable perspectives, not binary views
- [why are we compressing things?](/prose/why-are-we-compressing-things) - linearity as compression
- [what is art?](/prose/what-is-art) - intent behind every choice
- [this is not a personal website](/prose/this-is-not-a-personal-website) - the site as projection, not person
- [this is not all](/prose/this-is-not-all) - what the design leaves out
