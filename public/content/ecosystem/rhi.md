---
label: "rhi"
description: "glue layer for computers"
url: https://docs.rhi.zone
color: "oklch(0.7 0.12 155)"
---

a glue layer for computers - finding common abstractions across fragmented domains.

## what it is

every domain has its own tools, formats, and conventions that don't talk to each other. rhi finds the structural overlap and builds unified interfaces. 98 languages share the same code intelligence CLI, 50+ document formats pass through a single IR, and one Rust impl block can project to HTTP, CLI, MCP, WebSocket, and GraphQL simultaneously.

the ecosystem is Rust-first, capability-based, and offline-first. projects interoperate through [portals](/project/portals) (async-first interfaces inspired by WASI) and compose through [moonlet](/project/moonlet)'s plugin system.

## key projects

- [normalize](/project/normalize) - structural code intelligence across 98 languages
- [unshape](/project/unshape) - constructive media generation
- [server-less](/project/server-less) - one impl, many protocols
- [rescribe](/project/rescribe) - lossless document conversion with 50+ formats
- [moonlet](/project/moonlet) - Lua runtime with plugin system
- [paraphase](/project/paraphase) - type-driven data conversion route planner
