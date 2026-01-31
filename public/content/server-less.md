Composable derive macros for Rust. Write your implementation once, project it into multiple protocols.

## What it is

A set of derive macros that generate protocol-specific server and client code from a single Rust implementation. You write your logic once and server-less generates:

- **HTTP** — REST API with routing and serialization
- **CLI** — command-line interface with argument parsing
- **MCP** — Model Context Protocol for AI tool integration
- **WebSocket** — real-time bidirectional communication

The macros analyze your function signatures and produce idiomatic implementations for each target protocol, handling serialization, error mapping, and transport concerns automatically.

## What it isn't

- Not a web framework — it generates code for multiple protocols, not just HTTP
- Not an RPC system — it projects *implementations*, not interface definitions
- Not code generation from specs — it works from your Rust code directly

## Prior art

- [tonic](https://github.com/hyperium/tonic) — gRPC code generation for Rust
- [axum](https://github.com/tokio-rs/axum) — ergonomic HTTP framework
- [clap](https://github.com/clap-rs/clap) — derive-based CLI parsing

## Related projects

- [concord](/concord) — generates client bindings (server-less generates server implementations)
- [dusklight](/dusklight) — can consume server-less HTTP/WebSocket endpoints
