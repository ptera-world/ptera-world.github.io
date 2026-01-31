Minimal expression language compiling to multiple backends. Parse once, emit to WGSL (GPU shaders), Cranelift (native JIT), Lua, GLSL, OpenCL, CUDA, C, Rust, or TokenStream.

## What it is

A small, focused language for mathematical expressions with let bindings and optional conditionals. Dew handles the gap between "I need a formula" and "I need that formula to run on the GPU / in a JIT / in a scripting runtime."

Domain crates provide independent type systems:

- **Scalar** - f32, f64, i32, i64 math
- **Linear algebra** - vectors and matrices
- **Complex numbers**
- **Quaternions**

Each domain has its own FunctionRegistry and eval(). Expression optimization includes constant folding and algebraic simplification. Editor support via VSCode/TextMate/tree-sitter grammars. WASM bindings with module profiles (core, linalg, graphics, signal, full).

## Key design decisions

- Feature-gated conditionals and functions (not in core)
- Domain crates are independent - no monolithic type system
- Generic over numeric type T
- Small and ephemeral by design

## Related projects

- [unshape](/unshape) - uses dew for procedural generation parameters
- [moonlet](/moonlet) - hosts dew's Lua backend
