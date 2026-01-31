A glue layer for computers - finding common abstractions across fragmented domains.

## What it is

Every domain has its own tools, formats, and conventions that don't talk to each other. rhi finds the structural overlap and builds unified interfaces. 98 languages share the same code intelligence CLI. 50+ document formats pass through a single IR. One Rust impl block projects to HTTP, CLI, MCP, WebSocket, and GraphQL simultaneously.

The ecosystem is Rust-first, capability-based, and offline-first. Projects interoperate through [portals](/portals) - async-first interfaces inspired by WASI - and compose through [moonlet](/moonlet)'s plugin system.

## Guiding principles

- **Unification through abstraction** - find common structure across domains
- **Structure over text** - work on AST, graph, hierarchy directly
- **Lazy by default** - evaluate on demand, no upfront cost for unused features
- **Works anywhere** - handle legacy systems, graceful degradation

## Key projects

- [normalize](/normalize) - structural code intelligence across 98 languages
- [unshape](/unshape) - constructive media generation
- [server-less](/server-less) - one impl, many protocols
- [rescribe](/rescribe) - lossless document conversion with 50+ formats
- [moonlet](/moonlet) - Lua runtime with plugin system
- [paraphase](/paraphase) - type-driven data conversion route planner
