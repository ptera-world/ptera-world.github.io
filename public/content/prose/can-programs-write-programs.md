---
label: "can programs write programs?"
description: "they always could.\nthe question is what kind."
tags: [technology]
---

# Can programs write programs?

The answer has always been yes. Compilers are programs that write programs. Templates are programs that write programs. Macros, code generators, transpilers - all programs writing programs. This has been normal for decades.

So why does it feel different now?

## What changed?

The old program-writing-programs were *structural*. A compiler takes one precisely defined language and transforms it into another precisely defined language. The input and output are both fully specified. The transformation is deterministic. The same input always produces the same output.

The new program-writing-programs are *stochastic*. An AI takes a vague description - "make a login page" - and produces code that might work. The input is fuzzy. The output is probabilistic. The same input might produce different output each time.

Both are programs writing programs. But they're different in a way that matters: the old kind preserves meaning. The new kind [guesses at it](/prose/can-you-tell-when-its-wrong).

## What are the layers of description?

Programming is already a chain of programs writing programs, even if it doesn't always feel that way.

You write in a high-level language. A compiler transforms that into a lower-level language. An assembler transforms that into machine instructions. The machine instructions are interpreted by microcode. At every layer, a program takes a more abstract description and produces a more concrete one.

Each layer is a "less detailed view" of the same thing. Your high-level code describes *what* should happen. The compiler's output describes *how* it happens on this architecture. The machine code describes *how* it happens in this instruction set. Same program, viewed at different magnifications.

And this has been the pattern all along: programming has been about writing at a comfortable level of abstraction and letting programs fill in the details below. Nobody writes machine code by hand anymore. Nobody writes assembly for most tasks. Each generation delegates a layer downward and works at a higher level.

AI-assisted programming is just the next layer. Instead of writing high-level code, you describe what you want in natural language, and a program fills in the code. Same pattern. Higher abstraction.

## Why does this layer feel different?

Every previous layer had a guarantee: the transformation preserved the meaning. Your high-level code means exactly the same thing as the compiled output. You can verify this. The compiler is provably correct (or close enough). The meaning travels through the layers intact.

AI doesn't provide this guarantee. The meaning might travel intact. Or it might get [subtly distorted](/prose/can-you-tell-when-its-wrong#what-if-the-ai-solved-the-wrong-problem). Or it might be completely wrong in a way that looks right. There's no formal relationship between "make a login page" and the code that gets produced. There's only statistical correlation trained on examples.

This is genuinely different. And the difference matters. But it doesn't make the pattern new - it makes the pattern *riskier*. The question isn't whether programs can write programs. It's whether programs can write programs *you can trust*.

## What's the fractal structure?

Code has a property that makes program-writing-programs surprisingly natural: it's self-similar at different scales.

A codebase has modules. Modules have files. Files have functions. Functions have blocks. Blocks have statements. Statements have expressions. At every level, the structure is the same: components composed together according to rules.

This means you can describe a codebase at any level of detail and it's still meaningful. "A web server that handles authentication and serves pages" is a valid description. So is "a function that hashes a password using bcrypt with 12 rounds." They describe the same system at different magnifications.

A program that writes programs can operate at any of these levels. It can scaffold a whole project from a high-level description. It can fill in a single function from a detailed spec. It can do anything in between. The fractal structure means there's always a natural boundary between "what the human specifies" and "what the program generates."

The question - where should that boundary be? - is actually the same question every programming language answers: [how much detail should the programmer specify, and how much should be automated?](/prose/the-right-tool-for-the-job)

## What gets lost in the abstraction?

Every time you move up a layer of abstraction, you gain power and lose control. High-level languages are more productive than assembly but you can't control the exact instruction sequence. Garbage collectors free you from memory management but you can't control when memory gets freed. Each layer trades precision for convenience.

AI-assisted programming trades a lot of precision for a lot of convenience. And the things that tend to get lost in the trade are the things that matter most: [edge cases](/prose/how-do-i-know-this-code-is-good#what-actually-catches-bugs), architectural coherence, the subtle decisions that make code maintainable rather than just functional.

The common case works. It almost always works. AI is extraordinary at the common case because the common case is what it's trained on. The uncommon case - the weird input, the race condition, the interaction between two features that nobody tested together - is where it falls apart. It's not stupid - uncommon cases are, by definition, underrepresented in training data.

This is the same tradeoff every abstraction layer makes, just more visible. High-level languages are also bad at edge cases - that's why performance-critical code still drops down to lower levels. The defense is the same: know where the abstraction leaks, and be ready to go beneath it.

## What's the recursive dream?

There's an old dream in computer science: a program that writes programs that write programs. Infinite recursion. The machine bootstraps itself to arbitrary capability.

It doesn't work, though. Not because of any technical limitation, but because [meaning doesn't recurse](/prose/where-does-meaning-live). Each layer of "writing programs" still needs someone to specify what the program should do. You can automate the *how* but not the *what*. The what comes from intent, and intent comes from [the person](/prose/am-i-just-pretending#what-if-the-bottleneck-isnt-the-hand), not the process.

A program can write a program that writes a program. But somewhere at the top of the chain, a person has to say what they want. And "what they want" can't be generated - it can only be [discovered](/prose/why-do-i-build-tools#but-can-you-inhabit-what-you-built).

## What does this mean for you?

Whether or not you write code, this pattern touches your life. Every tool you use was built with some mix of human specification and automated generation. The document you're reading was shaped by tools that fill in details the author didn't specify. The systems you depend on - financial, medical, legal - increasingly use programs that write programs somewhere in their stack.

The question isn't whether to trust this. It's what to trust it *for*.

Trust it for the common case. Trust it for the boilerplate. Trust it for the parts where getting it wrong is cheap and getting it right saves time.

Be more careful with the things that [matter most](/prose/can-you-tell-when-its-wrong#whats-the-epistemic-problem). With the edge cases. With the architectural decisions. With the parts where being subtly wrong is worse than being obviously wrong.

Programs can write programs. They always could. The skill isn't in getting them to write. It's in knowing which parts to read.

## See also

- [can you tell when it's wrong?](/prose/can-you-tell-when-its-wrong) - specification gaming and the evaluation gap
- [how do i know this code is good?](/prose/how-do-i-know-this-code-is-good) - the verification stack
- [am i just pretending?](/prose/am-i-just-pretending) - taste as the irreducible human input
- [the right tool for the job](/prose/the-right-tool-for-the-job) - choosing the right level of abstraction
