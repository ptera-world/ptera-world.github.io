API bindings intermediate representation and code generation.

## What it is

A tool that generates idiomatic language bindings from API specifications. Concord parses API definitions (like OpenAPI specs) into an intermediate representation, then generates client libraries for target languages.

The pipeline:

1. **Parse** — read API specification into IR
2. **Transform** — normalize and optimize the IR
3. **Generate** — emit idiomatic bindings for the target language

The IR captures the full semantics of an API — endpoints, types, authentication, pagination — so generated code handles real-world API patterns correctly.

## What it isn't

- Not an API client — it generates clients, not a runtime library
- Not a spec validator — it reads specs to produce code
- Not language-specific — the IR is target-agnostic

## Prior art

- [openapi-generator](https://openapi-generator.tech/) — multi-language API client generation
- [protobufs](https://protobuf.dev/) — schema-driven code generation
- [smithy](https://smithy.io/) — AWS API modeling language

## Related projects

- [server-less](/server-less) — generates servers (concord generates clients)
- [paraphase](/paraphase) — could use concord-generated clients in conversion pipelines
