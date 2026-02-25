---
label: "wick"
description: "minimal expression language"
url: https://docs.rhi.zone/wick
parent: ecosystem/rhi
status: production
tags: [rust, lua, creative]
---

minimal expression language that compiles to multiple backends. parse once, emit to WGSL, Cranelift, Lua, GLSL, OpenCL, CUDA, HIP, C, Rust, or TokenStream.

## what it is

a small language for mathematical expressions with let bindings and optional conditionals. it fills the gap between "i need a formula" and "i need that formula to run on the GPU, in a JIT, or in a scripting runtime."

domain crates provide independent type systems (scalar math, linear algebra, complex numbers, quaternions), each with its own function registry and eval. expressions get constant folding and algebraic simplification. there's editor support via VSCode/TextMate/tree-sitter grammars and WASM bindings with module profiles.

## Related projects

- [unshape](/project/unshape) - uses wick for procedural generation parameters
- [moonlet](/project/moonlet) - hosts wick's Lua backend
