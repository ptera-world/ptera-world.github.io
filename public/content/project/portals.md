---
label: "portals"
description: "common ground between different tools"
url: https://docs.rhi.zone/portals
parent: ecosystem/rhi
status: fleshed-out
tags: [infrastructure, rust]
---

standard library of interfaces inspired by WASI. capability-based, async-first traits for I/O, networking, cryptography, filesystem, HTTP, SQL, and more. works on native, WASM, and embedded.

## what it is

trait definitions, not implementations. portals defines what operations are available without dictating how. any runtime that implements the interfaces gets access to the full ecosystem.

covers clocks, CLI, crypto, encoding, filesystem, HTTP, I/O, random, sockets, SQL, blob storage, caching, config, cron, DNS, key-value, logging, markdown, messaging, and more. backends exist for native (OS), WASM (browser), portable (pure Rust), and mock (testing), and there's a portable HTTP/1.1 parser used by both native and WASM backends.

the focus is portability over power - simpler APIs that work everywhere, with intentional gaps where wrapping application protocols wouldn't add value.

## Related projects

- [moonlet](/project/moonlet) - uses portals-io and portals-filesystem
