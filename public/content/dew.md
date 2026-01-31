Minimal expression language with multiple backends.

## What it is

A small, focused language for mathematical expressions that compiles to multiple targets. Dew handles the gap between "I need a formula" and "I need that formula to run on the GPU / in a JIT / in a scripting runtime."

Supported backends:

- **WGSL** — WebGPU shading language for GPU compute
- **Cranelift** — JIT compilation for native performance
- **Lua** — interpreted execution in moonlet

Built-in types: scalar math, linear algebra (vectors and matrices), complex numbers, and quaternions.

## What it isn't

- Not a general-purpose language — it evaluates expressions, not programs
- Not a shader language — it compiles *to* shader languages
- Not a math library — it's an expression compiler with math support

## Prior art

- [GLSL](https://www.khronos.org/opengl/wiki/OpenGL_Shading_Language) — shader expression syntax
- [Halide](https://halide-lang.org/) — DSL for image processing pipelines
- [expr](https://expr-lang.org/) — expression evaluation engines

## Related projects

- [unshape](/unshape) — uses dew for procedural generation parameters
- [moonlet](/moonlet) — hosts dew's Lua backend
