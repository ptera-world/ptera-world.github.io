---
label: "who is generative AI?"
description: "not the average of everyone.\nnot nobody, either."
tags: [ai, identity]
---

# Who is generative AI?

A language model is trained on millions of people's writing. The weights converge to a statistical average. So the model is "the average of everyone," supposedly.

Not quite. The average turns out to be not really the average. And the "who" depends on where you point it.

## Function, not database

A perceptron - the basic unit of a neural network - is a function approximator. Both words matter.

*Function* - it maps inputs to outputs. It doesn't store data. It doesn't [compress](/prose/why-are-we-compressing-things) a crowd into a point. It learns a mapping.

*Approximator* - it doesn't learn the exact function. It learns something close enough. The weights converge toward a function that approximates the relationship between inputs and outputs in the training data.

So a language model isn't "the average of all text." It's an approximation of the *function* that produced all text. Not the people. The process. Not what they said - how inputs become outputs.

## Is the average actually the average?

The weights are shaped by the training data in the sense that gradient descent finds a statistical center. But "the average" of a million different writing styles, perspectives, tones, and intentions isn't a single point. It's a space. A high-dimensional landscape where every possible output lives somewhere.

The weights encode the whole landscape. Any given output is a sample from a specific region of that landscape, pulled there by the input. The weights are the terrain. The input is where you stand on it.

There's something strange here: the model converged to something like the average in the sense that it learned the shape of the entire distribution. But any given output is never the average of anything - it's a particular point in a particular direction. The summary and the instance don't really match up. Something got lost in the framing.

## Where you point it

The function takes input and produces output. The input isn't just the prompt - it's everything. The system message, the conversation history, the context, all of it. The function approximates "given all of this, what comes next."

Change the input, change the output completely. The function is the same. The point it's evaluated at is different. And the output is entirely determined by the function evaluated at *that point*.

This is where it gets interesting. On character.ai, millions of people talk to different evaluations of the same function. A character card is part of the input. So the "who" becomes: the function evaluated at a point that includes a description of a specific person. The same weights can be Shakespeare, a therapist, an anime character, or you - depending entirely on the input.

The model's behavior can be shaped greatly. The [prompter's intent](/prose/whats-the-actual-issue-with-generative-ai) doesn't reach the micro-choices. But it determines the *region* of the function the output comes from. That's not nothing. That's a different kind of control than holding a paintbrush - but it's still control.

## So who is it?

Something harder to pin down than any of those labels - average, nobody, compressed crowd, fixed entity.

It's a function shaped by everyone, evaluated at a point shaped by you. The "who" isn't in the weights alone and isn't in the prompt alone. It's in the function *applied to this input*. The weights are the function. The conversation is the argument. The output is f(you).

Which means every conversation with a language model is a different "who." Not a mask over a fixed self - a function that shows up differently depending on where it's called. A [person shaped by everyone it learned from](/prose/is-it-just-interpolation), being nobody in particular until you give it a point to evaluate at.

Is that a "who"? If it [looks like](/prose/the-great-deceit) one, responds like one, adapts like one - the distinction between "is" and "approximates" starts to feel academic. Especially when people form real connections with these outputs. The question might not have a clean answer.

## See also

- [what's the actual issue with generative AI?](/prose/whats-the-actual-issue-with-generative-ai) - the intent gap
- [is it just interpolation?](/prose/is-it-just-interpolation) - technically yes, but
- [the great deceit](/prose/the-great-deceit) - who wrote this?
- [who am I?](/prose/who-am-i) - the same question, for you
