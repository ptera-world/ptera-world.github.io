The rhi ecosystem is a glue layer for computers — a collection of libraries, runtimes, and tools that make software talk to other software.

## What it is

A set of Rust-first projects that share a common design philosophy: capability-based interfaces, structural awareness, and composable pipelines. Every project in rhi is designed to interoperate with the others through [portals](/portals) — a standard set of async-first interfaces.

The ecosystem spans code intelligence, media generation, data transformation, runtime infrastructure, and UI — connected by the idea that these are all fundamentally the same problem: converting structured data from one form to another.

## What it isn't

- Not a framework — each project is independently useful
- Not a platform — there's no central runtime or service to depend on
- Not a monorepo — each project has its own repository, CI, and release cycle

## Key projects

- [normalize](/normalize) — structural code intelligence
- [moonlet](/moonlet) — Lua runtime with plugin system
- [unshape](/unshape) — constructive media generation
- [paraphase](/paraphase) — pipeline orchestrator for data conversion
- [server-less](/server-less) — one impl, many protocols
- [dusklight](/dusklight) — universal UI client

## Design principles

- **Capability-based** — components declare what they can do, not what they need
- **Structural** — work with the shape of data, not just its bytes
- **Composable** — small pieces that combine predictably
- **Offline-first** — no cloud dependencies for core functionality
