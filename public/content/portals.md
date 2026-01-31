Standard library of interfaces inspired by WASI. Capability-based, async-first traits for I/O, networking, cryptography, filesystem, HTTP, SQL, and more. Implementable on native, WASM, and embedded targets.

## What it is

Trait definitions - not implementations. Portals defines *what* operations are available without dictating *how*. Any runtime that implements portals interfaces gets access to the full ecosystem.

Interface categories: clocks, cli, crypto, encoding, filesystem, http, io, random, sockets, sql, blobstore, cache, config, cron, dns, keyvalue, logging, markdown, messaging, nanoid, observe, snowflake, timezone, websocket.

Backends: native (OS implementations), wasm (browser), portable (pure Rust), mock (testing). Includes a portable HTTP/1.1 parser used by both native and wasm backends.

## Key design decisions

- Interfaces only (traits), backends implement
- Capability-based: access via pre-opened handles, no ambient authority
- WASI-inspired scope but not a WASI wrapper
- Portability over power: simpler APIs that work everywhere
- Intentional gaps: doesn't wrap application protocols (LSP, MCP, gRPC)

## Related projects

- [moonlet](/moonlet) - uses portals-io and portals-filesystem
