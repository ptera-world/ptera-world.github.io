---
label: "why are formats so hard?"
description: "the spec is a scanned pdf from 1994.\nif you're lucky."
tags: [technology, programming]
---

# Why are formats so hard?

Everything on a computer is a format. Every file, every stream, every message between programs - just bytes arranged according to some convention that somebody decided on, usually decades ago, often without writing it down.

When formats work, they're invisible. Open a JPEG and see a photo. Play an MP4 and watch a video. The format did its job - it carried meaning from one program to another without you having to think about how.

When formats don't work - when the file won't open, when the export is corrupted, when you need to get data from one tool to another and there's no path - that's when you realize how much of "using a computer" is format translation.

## The format problem

Copy a table from a web page into a word processor. Something goes wrong. The formatting is off, the columns don't align, the links are gone. You didn't do anything wrong. Two programs just disagreed about what a "table" is.

Export your project from one tool. Import it into another. Half the data is missing. The export format doesn't have a way to represent everything the first tool knows, and the import format doesn't expect what was written.

These aren't edge cases. This is the normal experience. The seams between programs are format boundaries, and most format boundaries leak. The [bridge problem](/prose/why-is-everything-a-document#whats-the-bridge-problem) isn't abstract. It's every time you've ever copy-pasted something and it came out wrong.

And it goes deeper than user-facing tools. Programs that are supposed to compose - libraries, CLI tools, [the infrastructure underneath everything](/prose/why-glue) - hit the same walls. The output of one doesn't quite match the input of the other. The assumptions encoded in the format don't align. The composition that should be trivial requires a translation layer, and the translation layer is where information gets lost.

## The spec doesn't help

Some formats have specifications. A spec is supposed to be the source of truth - the document that tells you exactly how to read and write the format, every field, every flag, every edge case.

In practice, specs range from helpful to hostile.

The good case: a machine-readable schema. Actual structured data describing the format's structure. You can generate code from it. You can validate against it. The format becomes almost tractable. This is rare.

The common case: a PDF. Hundreds of pages. Written by committee. Full of conditional language - "implementations SHOULD support..." "if this field is present, the behavior is..." Natural language describing something that needs to be exact. You read it, build an implementation, test it against real files, and discover that real files don't match the spec because the spec was written after the implementation, not before.

The bad case: no spec at all. The format is whatever the reference implementation does. Want to understand it? Read the source code. Hope it's open source. Hope it's readable. Hope the person who wrote it is still around to explain the parts that make no sense.

There's a middle ground that's somehow worse than no spec: a spec that exists but disagrees with reality. Where the dominant implementation made choices the spec didn't anticipate, and now every other implementation has to choose between "follow the spec" and "read files that actually exist in the wild." The spec becomes [a document about how things should work](/prose/why-is-everything-a-document), while the implementation is how things actually work, and the gap between them is your problem.

## Code generation doesn't help either

If the format has a machine-readable schema - RelaxNG, JSON Schema, ASN.1, whatever - you can generate types from it. Parsers, serializers, validators, all derived from the schema automatically. This is wonderful when it works.

But it only handles the structure. The *semantics* - what do these fields mean, what are the invariants, what happens when this field interacts with that field - those live in the parts of the spec that aren't machine-readable. Or in the behavior of the reference implementation. Or in tribal knowledge accumulated over decades of people hitting edge cases and writing blog posts about them.

And code generation can't help with the long tail at all. Most formats don't have schemas. Most formats don't even have good specs. Most formats are "here's a binary blob, the structure was documented in a wiki that no longer exists, the reference implementation is a C library from 2003 that segfaults on malformed input."

For those formats, someone has to sit down with a hex editor and figure it out. Or read the source of whatever program writes the format and reverse-engineer the structure. There's no shortcut. The work is manual, tedious, and foundational - everything downstream depends on getting it right.

## Nobody builds this

Format work is unglamorous. Nobody writes a blog post about finally getting the EXIF rotation flags right. There's no conference talk about parsing OOXML table styles. The work is invisible when it succeeds and frustrating when it doesn't. Nobody gets famous for it.

And yet. ffmpeg exists because someone (many someones, over decades) did the unglamorous work of understanding hundreds of audio and video formats. SQLite exists because someone cared about getting the database format exactly right - portable, stable, forwards-compatible, backwards-compatible. These are some of the most widely deployed pieces of software on earth, and they're [fundamentally format work](/prose/why-glue#the-proof-is-in-the-stack).

The people who do this work - who really do it, with full spec coverage, round-trip fidelity, graceful handling of malformed input - are quietly holding the infrastructure together. Every program that plays video relies on their work. Every program that reads a database file relies on their work. Every tool that "just opens" any file format relies on someone having done the boring, invisible, meticulous work of understanding the format.

The gap is in the long tail. The common formats - JPEG, PNG, MP4, PDF, ZIP - have solid implementations. But the moment you step off the beaten path - game asset formats, legacy document formats, niche interchange formats, proprietary tool formats - you're either writing the parser yourself, wrapping a C library from the 2000s, or giving up.

## What does it feel like to do the work?

You start with a spec, if one exists. You read it. You build an implementation. You test it against real files. The first file works. The second file breaks your parser in a way the spec didn't mention. You find a blog post from 2011 that explains the undocumented behavior. You fix your implementation. The third file has a different undocumented behavior. And so on.

The work is [contact with the problem](/prose/why-cant-you-just-use-what-exists#whats-the-understanding-that-doesnt-transfer). The problem pushes back. Every real-world file is a test case that might reveal something the spec missed, or something the dominant implementation does differently, or something that nobody thought to document because it seemed obvious at the time.

And the edge cases aren't academic. They're someone's file that won't open. Someone's data that's trapped. Someone's workflow that's broken at the format boundary. The difference between "handles the common case" and "handles real files" is enormous, and it's all edge cases.

## Why does this matter?

Because formats are the [connective tissue](/prose/why-glue#what-glue-actually-does) between everything. Every interoperability problem is a format problem at the bottom. Every time a tool can't compose with another tool, there's a format boundary in the way. Every time you can't get your data from here to there, a format translation is missing.

If you care about [tools that compose](/prose/why-glue), you end up caring about formats whether you intended to or not. The composition only works if the data survives the journey. And making data survive journeys between programs is format work.

It's the deepest, least celebrated layer of the stack. And almost nobody's solving the long tail.

## See also

- [why glue?](/prose/why-glue) - formats as the connective tissue between tools
- [why is everything a document?](/prose/why-is-everything-a-document) - the bridge problem across format boundaries
- [why can't you just use what exists?](/prose/why-cant-you-just-use-what-exists) - when the existing format library doesn't match your model
- [can programs write programs?](/prose/can-programs-write-programs) - code generation and its limits
