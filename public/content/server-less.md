Composable derive macros for Rust. Write your implementation once, project it into multiple protocols. 18 macros, impl-first design, zero runtime overhead.

## What it is

A set of derive macros that generate protocol-specific code from a single Rust impl block. You write business logic once and stack macros to get:

**Runtime handlers:**
- `#[http]` - Axum + OpenAPI
- `#[cli]` - Clap argument parsing
- `#[mcp]` - Model Context Protocol
- `#[ws]` - WebSocket JSON-RPC 2.0
- `#[json_rpc]` - JSON-RPC
- `#[graphql]` - async-graphql

**Schema generators:** gRPC (Protocol Buffers), Cap'n Proto, Apache Thrift, AWS Smithy, Connect RPC

**Spec generators:** OpenRPC, AsyncAPI, JSON Schema, Markdown docs

Method naming drives routing: `create_*` maps to POST, `get_*` to GET, `list_*` to collection endpoints. Return types (Result, Option, Vec, ()) are handled automatically. SSE streaming via `impl Stream<Item=T>`.

## Key design decisions

- Impl-first: write business logic, derive protocol handlers
- Progressive disclosure: simple cases work zero-config, complexity available on demand
- Composable: stack multiple macros on same impl block
- Pure compile-time codegen, zero runtime overhead
- Feature-gated everything

## Related projects

- [concord](/concord) - generates client bindings (server-less generates server implementations)
