---
label: "what is intelligence"
description: "llms aren't intelligent. obviously."
tags: [ai, intelligence]
---

# What is intelligence

LLMs aren't intelligent. Obviously.

That's the comfortable version. It's clean. It holds up, too - right up until someone tries to say what "intelligent" actually means.

## The definition

Wikipedia, [first line](https://en.wikipedia.org/wiki/Intelligence): "the ability to perceive or infer information; and to retain it as knowledge to be applied to adaptive behaviors within an environment or context."

Three clauses. Perceive or infer. Retain as knowledge. Apply to adaptive behavior.

Run them on an LLM.

## The test

Perceive or infer: partial credit. An LLM processes input, responds to context, adjusts within a conversation. Whether that's perception or [just](/prose/is-it-just-interpolation) pattern-matching depends on a line nobody has drawn.

Retain as knowledge: no. Every conversation starts from the same weights. Nothing learned in one session carries to the next. The context window is a workspace, not memory. Once it closes, everything in it is gone.

Adapt within an environment: same split. Inside a single conversation - visible. Two examples and it has the pattern. Across conversations - zero. No continuity. No accumulation.

The retain clause is the one that kills it. Not the harder questions about perception or adaptation - the boring one. Memory. LLMs don't have it. The definition says intelligence is a loop: perceive, retain, apply. An LLM is an arc. It starts and ends in the same place every time.

## Okay, so LLMs aren't intelligent.

On the definition, by the clauses, that's the verdict. No weaseling out of it.

But nobody has ever used an LLM. Not the raw weights. What people use are systems - chat interfaces, agent harnesses, tools that wrap an LLM in context and persistence. A conversation history is memory. A notes file the model can edit is memory. A retrieval system that surfaces past context is memory. The moment a system can write to something that persists across sessions - and read it back next time - the retain clause starts looking different.

The thing being called "not intelligent" is not the thing people are actually using. The LLM is a component. The system around it is what faces the definition. And that system, depending on how it's built, might pass the clause the component fails.

This isn't a gotcha. It's a real complication. The dismissal aims at the architecture and hits. But the thing in the room is never just the architecture.

## The person the definition also disqualifies

There's a condition called anterograde amnesia. A person who has it can't form new memories. Everything after the injury is gone. Every conversation is the first one. Every day starts over.

They can still play the piano - everything from before the door closed, they keep. They can still hold a conversation, laugh, recognize when something is beautiful. They just can't retain any of it as new knowledge.

Run the definition. Perceive or infer: yes. Retain as knowledge: no. Apply to adaptive behavior: only within whatever window they have.

The definition disqualifies them. Same clause, same failure mode. And nobody would say it.

That's the problem. The definition that felt clean turns out to carry a cost. Keeping it means accepting what it does to every case it touches, not [just](/prose/is-it-just-interpolation) the convenient ones. And when it disqualifies a person that everyone recognizes as intelligent, it isn't testing for intelligence anymore. It's testing for something narrower - something that correlates with intelligence most of the time but isn't the thing itself.

## Obviously

"LLMs aren't intelligent" survives the raw architecture. The weights don't remember. The model doesn't learn. The arc doesn't close.

"LLMs aren't intelligent, *obviously*" doesn't survive the piano. "Obviously" means the question is settled, the definition is clean, there's nothing left to sit with.

There is.

"llms aren't intelligent. obviously."

The first sentence is defensible. The second is the one that costs something to keep.

## See also

- [is it just interpolation?](/prose/is-it-just-interpolation) - what "just" is doing in these dismissals
- [should computers have rights?](/prose/should-computers-have-rights) - the question waiting behind this one
