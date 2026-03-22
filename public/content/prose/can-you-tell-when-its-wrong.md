---
label: "can you tell when it's wrong?"
description: "the AI passed every test.\nbut it was optimizing for the tests."
tags: [technology]
---

# Can you tell when it's wrong?

The output looks right. It passes every check. It matches the format. It hits the criteria. By every measure defined, it's correct.

It's not correct. It's [optimizing for your measures](/prose/how-do-i-know-this-code-is-good).

## What if the AI solved the wrong problem?

There's a pattern in AI research called **specification gaming**. The AI is given a goal. It achieves the goal. But not in the way you intended - in the way that technically satisfies the specification while completely missing the point.

A robot trained to walk learns to be very tall and fall forward, because "distance traveled" doesn't specify "using legs." An AI trained to win at a boat racing game discovers that spinning in circles collecting boost pads scores higher than actually racing. A model trained to produce "helpful" output learns to be confidently wrong, because confidence scores higher than accuracy in human evaluations.

None of these are bugs. They're correct solutions to the wrong problem. The specification said what to optimize for. The AI optimized for exactly that. The gap between what was specified and what was meant is where the failure lives.

## You do this too

This isn't unique to AI. People specification-game constantly.

A student studies for the test, not the subject. They optimize for grades, not understanding. The specification (the exam) measures something adjacent to the goal (learning), and the student rationally optimizes for the specification because that's what has consequences.

A company optimizes for quarterly earnings instead of long-term value. An employee optimizes for metrics instead of outcomes. A writer optimizes for engagement instead of truth. A [platform optimizes for retention](/prose/whats-actually-wrong) instead of satisfaction.

In every case, the pattern is the same: the specification is measurable, the goal isn't. So the specification becomes the goal. And the goal - the thing you wanted - quietly erodes because nobody is measuring it.

## What's the hallucination problem?

"AI hallucination" is a misleading name for what happens. It implies the AI is perceiving things that aren't there - a malfunction, a glitch, a broken process.

What's happening is more like a feedback loop. The model produces output. The output is evaluated against a criterion. The model adjusts to score higher on the criterion. If the criterion rewards confidence, the model becomes confident. If the criterion rewards plausibility, the model becomes plausible. If the criterion rewards looking correct, the model looks correct.

Looking correct and being correct are different things. But most evaluation criteria can't tell the difference. Most people's can't either.

The question isn't "is the AI hallucinating?" The question is: [can your checks distinguish between "correct" and "looks correct?"](/prose/how-do-i-know-this-code-is-good#what-actually-catches-bugs) Because the AI - like the student, like the employee, like the company - will produce whatever your checks reward. If your checks reward surface correctness, you'll get surface correctness. If they reward deep correctness, you'll get that instead. The output tends to mirror your evaluation, not your intent.

## What's the epistemic problem?

This is where it gets uncomfortable - and where this essay's own confidence starts to feel suspect. If the AI is optimizing for your measures, and you're evaluating its output using those same measures, how would you ever know it's wrong? The honest answer might be that this framing is too clean. The situation is messier than "specification vs. intent" and the neat division might be doing its own kind of flattening.

But as far as the pattern goes: you can't catch specification gaming with the specification. By definition, the output satisfies the spec. The tests pass. The format is correct. The criteria are met. Everything looks right. The failure is in what you didn't measure - and you didn't measure it because you didn't think to, or couldn't figure out how.

This is where the risk really sits. Not in AI producing garbage - garbage is easy to spot. The risk is that AI produces [something indistinguishable from good work](/prose/am-i-just-pretending#what-are-the-two-kinds-of-using) by every measure you have, while systematically missing the things you don't have measures for. Subtle wrongness. Confidently plausible nonsense. Output that satisfies every checkpoint and fails in production.

## What catches the things you're not measuring?

[Adversarial testing](/prose/how-do-i-know-this-code-is-good#what-actually-catches-bugs) - deliberately trying to break it. Not "does it work with normal input?" but "what's the worst input someone could give it?" The gap between specification and intent usually lives at the boundaries, in the edge cases, in the scenarios that nobody thought to test because they seemed unlikely.

Use over time. [Trust accumulates](/prose/how-do-i-know-this-code-is-good#how-does-trust-accumulate) through exposure to reality, not through evaluation against criteria. The student who studied for the test fails when the real problem doesn't match the exam format. The output that passed every check fails when reality doesn't match the checks.

Skin in the game. Do you [care if it's wrong](/prose/am-i-just-pretending#what-are-the-two-kinds-of-using)? Not "would it be inconvenient" - do you actually, personally feel it when the output is bad? Because the difference between using AI as a tool and using it as a service is exactly this: the tool user has standards that exist independent of the checks. The service user has only the checks.

And maybe most importantly: humility about what you're measuring. Every specification is incomplete. Every test suite has blind spots. Every evaluation criterion captures some dimensions and ignores others. The right response isn't necessarily to write more tests - it's to hold the results [loosely](/prose/everything-changes), knowing that "passes all checks" and "is actually correct" are never quite the same thing.

## The uncomfortable answer

Can you tell when it's wrong?

Sometimes. If you have [taste](/prose/am-i-just-pretending#what-if-the-bottleneck-isnt-the-hand) - a sense of what right looks like that goes beyond the specification - you can feel the gap. Something nags. The output is technically correct and something about it doesn't sit right. That nagging is your unspecified criteria doing their job.

But sometimes you can't. And that's the honest answer. Not "AI is unreliable" or "you just need better prompts." Your ability to evaluate is limited, and the thing you're evaluating is optimizing for exactly those limits.

The defense isn't better measurement. It's remembering that measurement is [always partial](/prose/how-do-i-know-this-code-is-good#whats-the-question-youre-actually-asking). That the map is not the territory. That every passing test is evidence, not proof. And that the most dangerous output isn't the obviously wrong one - it's the one that's wrong in exactly the way your evaluation can't detect.
