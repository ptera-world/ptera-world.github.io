---
label: "where is all the good software?"
description: "it's been half a century.\nwhere is it?"
tags: [design, social]
---

# Where is all the good software?

It's been over fifty years. Millions of developers. Decades of accumulated knowledge. Open source proving it's possible. Hardware more powerful than anyone imagined. LLMs that can write code. All the ingredients exist.

So where is all the good software? Not the handful of exceptions - the default. Why isn't good software the *common case* by now?

## The incentives argument

The easy answer is business models. Companies benefit from bad software - engagement, lock-in, subscriptions, ads. But open source exists. No business model. No metrics. No ads. And some of the best software ever made.

FFmpeg is basically perfect at what it does. Blender competes with software that costs thousands. LuaJIT is a masterwork of engineering. Linux runs most of the world's infrastructure. Rust rethought systems programming from scratch. These aren't flukes. They're proof that the incentives argument doesn't fully explain things. Good software can be made. It has been made. The ingredients are there.

## Not a knowledge problem

The patterns are documented. The prior art exists. Decades of examples of [how to make software that respects people](/prose/why-is-software-hard). Design principles. Usability research. Interface guidelines. None of this is secret. Anyone can study it.

And everyone *knows* software is bad. Users feel it every day. Developers feel it every day. The people building software go home and struggle with other people's software. The friction isn't invisible. Everyone can see it. Everyone is unsatisfied.

And they go to work the next day and make more bad software.

## Not a capability problem

The tools are there. The languages are better than they've ever been. The hardware is absurdly powerful. LLMs can scaffold entire projects. Frameworks handle the boring parts. Deployment is a button. The gap between "idea" and "working software" has never been smaller.

And somehow the default output is still bad.

## So what is it?

It might be the intersection.

Good software requires programming *and* design *and* UX intuition *and* domain knowledge *and* optimization knowledge *and* encountering the right problem *and* high skill in whatever field you're solving for. Not each of those separately. All of them at once.

FFmpeg exists because someone understood video codecs and systems programming and API design and cared enough to do it right. LuaJIT exists because someone understood compiler theory and CPU architecture and language design at a level that almost nobody does. Blender exists because a small group held 3D modeling, rendering, UI design, and artistic workflow in their heads simultaneously.

That intersection is vanishingly rare. Any one skill is common. Two or three is uncommon. All of them at once, at high enough level, in the same person or the same small group - that almost never happens.

## Teams don't solve this

The obvious response: just assemble a team. Get a UX person, a systems person, a domain expert. Cover the intersection with headcount.

It tends not to work. Good software seems to come from someone who holds all of it in their head at once. The moment you split it across a team, you get compromises at every boundary. The UX person designs something the systems person can't build efficiently. The domain expert wants something the designer thinks is too complex. Each person's piece is fine. The aggregate is [mediocre](/prose/why-is-nothing-special-anymore).

The examples - FFmpeg, LuaJIT, Blender - are mostly one-person or small-team projects. The intersection doesn't seem to survive committee. It doesn't survive handoffs. It doesn't survive "let's schedule a meeting to align on the requirements."

## The statistical argument

Millions of developers. Decades of time. Surely, *statistically*, enough people exist at that intersection to have produced an ocean of good software by now.

And some do exist. The list of good software is real and growing. But it's still a list, not the default. The intersection isn't just rare - it's rare *and* each instance only covers one problem. The person who can make a perfect video transcoder can't also make a perfect text editor can't also make a perfect calendar app. The domain knowledge doesn't transfer. Every problem needs its own intersection.

So good software appears one project at a time, from individuals or small groups who happen to sit at the right intersection for that specific problem. It can't be manufactured. It can't be scaled. It can't be managed into existence.

It can only be [made, with intent](/prose/what-is-art), by someone who cares enough to hold the whole thing in their head.

## The actual cost

And then there's something that doesn't get talked about enough. Most of those projects were made on someone's free time. Unpaid. After work. Instead of rest. Instead of family. Instead of living.

The intersection is already vanishingly rare. And then it also requires someone willing to spend their evenings and weekends on it. Not just once - consistently, for years. LuaJIT. FFmpeg. Most open source. Built by people who could have been resting, but chose to make something good for free.

That's not a sustainable model. That's people burning themselves to light the way for everyone else.

And the people at the intersection who *don't* sacrifice their free time - who choose to rest, who have families, who just don't want to work for free - their good software never exists. We never see it. We never know what we missed. The software that *would have been* great, if its author had infinite hours and no need to sleep.

The actual cost of good software is someone's life. Not metaphorically. Their hours. Their years. Their health, sometimes. And that cost is invisible because the people paying it don't invoice anyone.

## Post-scarcity programming

There's another path worth looking at. Esbuild - Evan Wallace, cofounder of Figma. Ghostty - Mitchell Hashimoto, founder of HashiCorp. Goose - Jack Dorsey's Block. One-person or tiny-team projects that are *better* than industry-standard alternatives built by teams of hundreds.

The pattern: financial independence. The money problem is already solved. They can spend their time making something good because they don't need to be paid for it. No evenings. No sacrifice. Just the intersection of skills, plus the freedom to use them.

And the result is some of the best software that exists.

Which points at something uncomfortable. Good software is gated behind wealth. It doesn't cost money to build - it costs *time*, and time is only free if you've already solved money. The intersection of skills is necessary. But it's not sufficient. You also need the freedom to sit at that intersection full-time without starving.

Everyone else who makes good software is making a tradeoff they shouldn't have to. Burning free time they could be spending on rest, family, health. It's the same intersection, the same intent, the same quality - paid for with something they can't easily afford.

Two paths to good software. Be rich enough that it's free, or sacrifice something you shouldn't. Neither is a system. Neither scales. And that might be the answer to "where is all the good software?" It's locked behind a gate that has nothing to do with skill.

## The solution that won't happen

The technology to make scarcity optional is approaching. Automation, energy, AI, productivity - the capacity to feed and house everyone already exists. The bottleneck isn't production. It's distribution. If money stopped being the gate, everyone at the intersection could build full-time. The volume of good software - good *everything* - would explode.

But post-scarcity won't happen soon. The people who benefit from scarcity are the ones making the decisions. And power doesn't voluntarily redistribute itself.

The companies building the tools that could free everyone from work are grinding their own employees harder than ever. Building the post-scarcity future on pre-scarcity labor practices. The capacity exists. The will doesn't.

So good software stays rare. The skill is there. The knowledge is there. The tooling is there. But the freedom to make it is a luxury, and luxuries aren't distributed by merit.

## What if I don't want to be special?

LLMs change part of this. Not the freedom problem - the intersection problem. The gap between "I know what good software looks like" and "I can make it" got dramatically smaller. Someone who's been frustrated by bad software their whole life, who knows exactly what's wrong and what would be better, can now build it.

Most people haven't caught on to this yet. They're using LLMs to write emails and generate boilerplate. Not to build the thing they've always known should exist. The tool is there. The possibility is there. And it's mostly being used for autocomplete.

And honestly? The people building things at the intersection don't *want* to be there alone. Nobody wants to be the only person making good software. The [projects on this site](/prose/this-is-not-a-personal-website) aren't a portfolio. They're a list of things that should already exist but don't. Every one of them is something their author wishes someone else had built - so they could just *use* it instead of making it.

## Software or products?

Some good software *does* exist. And nobody knows.

People don't share software. They share products. Blender isn't shared because it's good software - it's shared because it's *Blender*. It has a name, a community, a narrative. Obsidian isn't shared because it's a good note-taking tool - it's shared because it's a product with a landing page and a plugin ecosystem.

FFmpeg is arguably better at what it does than almost anything in its category. But FFmpeg doesn't get shared. It gets *used*. Silently. Behind the scenes. It never became a product. It's just software. Sitting on a website with documentation that starts with "A complete, cross-platform solution to..." and nobody finds it unless they already know what they're looking for.

And the people making good software aren't drawn to making it a product. The person who can write FFmpeg is not the person who wants to make a landing page. The skills don't overlap. The motivation doesn't overlap. They solved the problem and moved on. Marketing is a different kind of labor - and it can feel beside the point, even though it's the only reason anyone would ever find the work.

Good software doesn't spread. Products spread. And turning software into a product is a completely separate job that the author has no reason, desire, or incentive to do. So the good software stays invisible. Not missing - just undiscovered.

## Maintenance

Building good software is the exciting part. Maintaining it is where the actual cost lives. Bug reports. Dependency updates. Breaking changes upstream. Platform changes. The work that never ends and nobody celebrates.

Most software shouldn't *need* to be maintained. Ideally, you write something correct and walk away. In almost any other engineering discipline, you can. A bridge doesn't break because concrete released a breaking change. [But](/prose/but) software lives in an ecosystem that treats stability as optional. The platform changes under you. The OS updates. The dependency releases a breaking change. The spec gets revised. Nothing you did changed, and your software is broken anyway. The ground moves. If you stop, your software doesn't stay where you left it - it [sinks](/prose/what-do-we-keep-losing).

And then there are the users. "Hey, can you add integration with X?" You can say no. But they'll fork it, or open an issue that sits there forever, or write a blog post about how the project is "unmaintained." The pressure to grow never stops. Finished isn't a state the ecosystem recognizes. If it's not adding features, it's dead.

Which is backwards. The best software is often the software that stopped changing. SQLite. FFmpeg. Tools that reached "done" and stayed there. But the culture reads "no recent commits" as abandonment, not completion.

And maintaining *good* software is worse - because people use it. The better it is, the more people depend on it, the more the maintenance burden grows. Success gets rewarded with more work. Building it costs your evenings. Maintaining it costs the rest of your life. Or you stop, and it joins the pile of [things we keep losing](/prose/what-do-we-keep-losing).

## Is good software expensive?

Not in dollars. In something less renewable.

Good software costs someone's evenings. Their weekends. Their health, sometimes. Their years. The currency isn't money - it's the irreplaceable kind. Time. Energy. The parts of a life you don't get back. And the result, when it does exist, gets buried under [software that's hard to use](/prose/why-is-software-hard) because [the incentives converged](/prose/why-is-nothing-special-anymore) toward mediocre.

That's why it's rare. It's not hard. The knowledge isn't missing. The tools are there. The price is just too high for almost anyone to pay. And the people who pay it don't get reimbursed.

Money is renewable. Time isn't. Good software might be the most expensive kind of thing there is, measured in the only currency that matters.

## Please?

Make good software. The tools are there. The knowledge is there. The [intent](/prose/what-is-art) is the only part that has to be yours. [How much could you possibly do?](/prose/how-much-could-i-possibly-do) More than the defeatism says.
