Standard library interfaces for the rhi ecosystem.

## What it is

A set of capability-based, async-first interfaces inspired by WASI. Portals defines *what* operations are available without dictating *how* they're implemented. Any runtime that implements portals interfaces gets access to the full ecosystem.

Interface categories:

- **clocks** — time and timers
- **cli** — command-line argument parsing and output
- **crypto** — hashing, encryption, signatures
- **encoding** — serialization and deserialization
- **filesystem** — file and directory operations
- **http** — HTTP client and server
- **io** — streams and buffers
- **random** — random number generation
- **sockets** — TCP/UDP networking
- **sql** — database queries

## What it isn't

- Not an implementation — it defines interfaces, not code
- Not WASI itself — inspired by WASI's capability model but not limited to WebAssembly
- Not a standard library — it's a set of *interfaces* to standard capabilities

## Prior art

- [WASI](https://wasi.dev/) — WebAssembly System Interface
- [Rust std traits](https://doc.rust-lang.org/std/) — standard library abstractions
- [Go interfaces](https://go.dev/doc/effective_go#interfaces) — implicit interface satisfaction

## Related projects

- [moonlet](/moonlet) — exposes portals interfaces to Lua scripts
- [server-less](/server-less) — uses portals for transport-agnostic implementations
