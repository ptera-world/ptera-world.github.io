---
label: "how do i know this code is good?"
description: "you don't read every line.\nneither does anyone else."
tags: [technology]
---

# How do I know this code is good?

You didn't type every line. Maybe you didn't type most of them. An AI wrote the implementation while you held the reins. It compiles, it runs, it passes the tests. But you can't shake the feeling that you're [trusting something you don't fully understand](/prose/am-i-just-pretending).

Here's the thing: you've always been trusting things you don't fully understand. You just didn't notice.

## Nobody reads every line

The fantasy of the programmer who reads and understands every line of their codebase is exactly that — a fantasy. It stops being possible around 10,000 lines. By 100,000 it's absurd. The Linux kernel is 30 million lines. Nobody understands all of it. Not even the person who started it.

What programmers actually do is build layers of trust. You trust the compiler — the tool that translates code into something the machine can run. You trust the type system — rules that prevent entire categories of mistakes structurally. You trust the test suite. You trust the linter — an automated reviewer that catches common mistakes. You trust the code review. You trust the abstraction boundaries — the walls between components that limit how far a bug can spread. Each layer catches different things. Together, they're enough.

AI-generated code doesn't change this. It adds a question — "do I trust the author?" — but that question already existed for every library you import, every snippet you copy, every coworker's changes you approve.

## What actually catches bugs

Here's what catches bugs, in rough order of [how much you should rely on them](#the-stack):

**The type system** catches the most. In a strict language, if the code compiles, an enormous category of bugs is already eliminated — memory corruption, null references, data races, type mismatches. This isn't trust. It's proof. The compiler doesn't care who wrote the code.

**Tests** catch the next layer. Does it do what it's supposed to? If you wrote the tests — even if the AI wrote the implementation — you defined the contract. The implementation either honors it or it doesn't.

**Adversarial testing** catches what tests miss. Normal tests verify the happy path — does it work when the input is correct? Adversarial testing asks what happens when the input is *hostile*. Edge cases. Empty values. Integers at the boundary. Malformed data. Inputs designed to break assumptions. This is where AI-generated code is most vulnerable, because AI optimizes for the common case. It produces code that works beautifully on reasonable inputs and silently corrupts on unreasonable ones. Fuzz testing — throwing random garbage at the code to see what breaks — helps. Property testing — asserting that general rules hold across thousands of generated inputs — helps. But the instinct — "what's the worst thing someone could feed this?" — is irreplaceable.

**Lints** — automated style and correctness checkers — catch idiom violations, common mistakes, performance issues, and suspicious patterns. They're mechanical reviewers that never get tired and never wave things through because it's Friday.

**Structure** catches architectural problems. Is the code modular? Are the abstractions [at the right level](/prose/the-right-tool-for-the-job)? Do the boundaries between components make sense? You don't need to read every line to see structure. You need to read the interfaces — the shapes of the components and how they connect. The shape of the code is visible without reading the body.

**Review by use** catches everything else. You use the tool. It works or it doesn't. It handles your edge cases or it doesn't. Over time, trust accumulates not from reading but from [running](#trust-accumulates).

## The stack

Here's the real difference between "vibe coded garbage" and "AI-assisted software that works":

**Garbage:** write prompt → get code → ship it. No structure. No tests. No review. You're hoping it works. It probably doesn't.

**What actually works:** design the architecture → define the interfaces and constraints → let the AI fill in implementations → the compiler rejects the broken ones → tests verify the contracts → edge cases break the hidden assumptions → lints catch the smells → you review the structure → you use it and it either survives or you fix it.

Every step is a filter. Code passes through the compiler, through the test suite, through adversarial inputs, through the linter, through your structural review, through actual usage. What survives that gauntlet is good code. Not because the AI is perfect, but because imperfection gets caught.

This is exactly the same gauntlet that human-written code passes through. The only difference is who typed it.

## Trust accumulates

You don't trust code because you read it. You trust code because it [survived](#what-actually-catches-bugs).

The first time you run your tool on real data and it produces correct output, that's trust. Not in every line — in the *system*. The tenth time, more trust. The time it fails and you fix it and it works again, even more. Trust is empirical.

After a thousand test cases, after months of use, after dozens of bug fixes, you know the code is good the same way you know your car works. Not because you inspected every bolt. Because you drove it to work every day and it got you there.

## What's actually different

One thing is genuinely different about AI-generated code: the [speed](/prose/am-i-just-pretending#speed-is-suspicious) makes it tempting to skip the filters. When you can produce code in minutes instead of hours, the pressure to test, review, and think drops. "It compiles, ship it."

That's the supposed risk, anyway. In practice? Tests are even more daunting *without* AI. The same speed that produces the implementation also produces the test suite. The whole verification stack gets cheaper together. You're not choosing between "fast implementation, no tests" and "slow implementation, careful tests." You're getting both fast.

The real risk isn't skipping tests. It's skipping *thought*. Not "does it pass?" but "is this the right abstraction?" Not "does it compile?" but "will this still make sense in a month?" Those questions don't have automated filters. They require you to [actually care about the architecture](/prose/the-right-tool-for-the-job), not just accept whatever compiles first.

The defense is the same defense it's always been: make the filters automatic. Pre-commit hooks that enforce formatting and style. CI pipelines that run the full test suite. Fuzz harnesses that probe the boundaries. Type systems that reject invalid states. The human failing has always been "I'll skip the checks just this once." AI-assisted development just makes "just this once" happen more often.

## The question you're actually asking

"How do I know this code is good?" is really asking "how do I know *I'm* good?" Because the code's quality is verifiable. Compile it. Test it. Lint it. Run it. Those have answers.

The harder question is whether steering an AI is a [real skill](/prose/am-i-just-pretending#taste-is-the-bottleneck), whether the architecture you designed is actually good or just happens to compile, whether your taste is refined or you're [fooling yourself](/prose/why-is-perfectionism-a-trap).

For that, there's only one test: does the thing work when it meets reality? Not in a test suite. In someone's hands. On real data. On a real problem.

If it does, the code is good. Regardless of who typed it.

## See also

- [am i just pretending?](/prose/am-i-just-pretending) - the legitimacy question underneath
- [the right tool for the job](/prose/the-right-tool-for-the-job) - caring about architecture
- [why is perfectionism a trap?](/prose/why-is-perfectionism-a-trap) - the fear that stops you from checking
