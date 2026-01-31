API bindings intermediate representation and code generation. Generates idiomatic language bindings from API specifications like OpenAPI.

## What it is

A tool that parses API definitions into a universal intermediate representation, then generates client libraries for target languages. The IR captures full API semantics - endpoints, types, authentication, pagination - so generated code handles real-world patterns correctly.

The pipeline: parse spec into IR, transform and optimize, emit idiomatic bindings for the target language. Multi-language support: Rust, TypeScript, Python, and more.

Branch structure: master holds core infrastructure, the bindings branch merges master and adds generated API bindings in categories (web-* for browser APIs, openapi-* from specs, ffi-* for foreign function interfaces). Generated code is a build artifact, not checked into master.

## Key design decisions

- Universal IR captures full API semantics
- Generated code is build artifact
- Multi-language codegen from single IR
- Branch separation: infrastructure vs generated bindings

## Related projects

- [server-less](/server-less) - generates servers (concord generates clients)
