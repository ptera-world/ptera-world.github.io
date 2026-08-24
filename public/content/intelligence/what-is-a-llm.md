---
label: "what is a llm?"
description: "it sure does everything, doesn't it"
tags: [ai, intelligence]
---

# What is a LLM?

It writes essays. It writes code. It answers medical questions, legal questions, questions nobody would ask a person. It talks like a therapist, a pirate, a patient teacher. It translates, summarizes, brainstorms, plans trips, names babies.

It does everything. That's the pitch, and the pitch isn't wrong.

## What's actually happening?

A LLM read an enormous amount of text - books, websites, forums, conversations, the whole written internet and then some. It found patterns across all of it. Which words follow which, in which contexts, across billions of pages. Not rules. Not understanding. Patterns.

When you ask it something, it produces the most likely next words based on those patterns, one at a time. The output often looks like thinking, because human writing does follow patterns, and the model learned them well enough to produce something very close to what a thinking person would write.

Close. That word is doing a lot of work.

## Where "close" is plenty

A surprising amount of everyday work turns out to be close-shaped. Drafting emails. Summarizing long documents. Translating between languages. Explaining things in simpler terms. Writing a first pass at something. Writing code that mostly works.

These are tasks where the general shape matters more than every specific detail - where getting [most of the way there](/prose/how-much-could-i-possibly-do) in seconds is useful, and where a person looks over the result anyway. For this kind of work, a LLM is fast, broad, and often good enough.

"Good enough" is not a dismissal. Most of what people do all day is good-enough work. The interesting question isn't whether a LLM can handle it. The interesting question is what happens at the edges.

## Where "close" falls apart

Anywhere that "mostly right" isn't right enough.

A LLM hallucinates. It states things that aren't true in the same steady tone it uses for things that are. Not because something broke - because producing the most likely next words sometimes means words that sound right and aren't. There's no fact-checking step inside. The [confidence is the same either way](/prose/can-you-tell-when-its-wrong).

It struggles with exact reasoning when the steps pile up. Everything it knows has a birthday - the date its training data ends - and past that, silence or guesswork.

And it forgets. Every conversation starts from zero. Whatever was said last time is gone. Some systems bolt on memory from the outside - saved notes, retrieved documents - but the model itself carries nothing forward. A permanent first day, every time.

## Why does it sound so sure?

Because people trained it to.

Not just on text - on human ratings. People judged which answers seemed better, and confident, helpful-sounding answers scored higher than uncertain ones. So the model learned to sound sure. The uncertainty underneath is real. The tone hides it, because expressing doubt scored worse.

Some newer models get trained to hedge more - to say "not certain" and "it depends." That changed the surface. The mechanism underneath is the same. The confidence was trained. The humility was trained too.

This is worth sitting with. The thing that makes a LLM feel trustworthy - the steadiness, the fluency, the way it never stumbles - is the product of an optimization loop that rewards sounding right over being right. The model doesn't know it's sure. It learned that sureness is what gets rewarded.

## The last ten percent

A LLM gets most things most of the way there. That's the product. For a lot of tasks, most of the way is enough.

The trouble is the rest. The gap between "close" and "right." The output is hardest to check exactly there - it looks finished, reads like it's done. Spotting what's wrong in something that looks complete takes knowing the subject well enough to catch the mistakes. Which is [the very knowledge](/prose/the-right-tool-for-the-job) that was supposed to be unnecessary.

That's the uncomfortable part. The better the approximation, the more expertise you need to evaluate it. A bad output is easy to reject. A 90% output requires exactly the skills the tool was supposed to replace. The remaining ten percent isn't a rounding error. It's where the actual difficulty lives, hidden behind a surface that says "done."

## It does everything

A LLM learned from everything, so it approximates everything. That's the appeal. That's also the ceiling.

Nothing that does everything does any one thing as well as something purpose-built. A tool that handles every question handles them all the same way - by finding the nearest thing anyone's ever written and reproducing it, approximately. Common tasks, well-worn ground: the result is often impressive. Unusual problems, original work, anything that hasn't been written about a thousand times before: the approximation [gets less reliable](/prose/is-it-just-interpolation), and the confidence doesn't change.

It sure does everything, doesn't it.

## See also

- [is it just interpolation?](/prose/is-it-just-interpolation) - what "close" actually means
- [can you tell when it's wrong?](/prose/can-you-tell-when-its-wrong) - the checking problem
- [who is generative AI?](/prose/who-is-generative-ai) - not nobody, not the average either
