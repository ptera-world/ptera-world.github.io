Constructive generation and manipulation of media in Rust.

## What it is

A comprehensive media generation library that treats all media — meshes, audio, textures, vectors, animations — as constructive pipelines. You describe *how* to build media rather than editing existing assets.

Supported domains:

- **Meshes** — procedural 3D geometry with CSG operations
- **Audio** — synthesis, sampling, and processing
- **Textures** — procedural texture generation and compositing
- **2D vectors** — SVG-compatible path operations
- **Rigging** — skeletal animation systems
- **Physics** — simulation for procedural animation
- **Node graphs** — visual dataflow for combining generators

## What it isn't

- Not an asset editor — it generates media programmatically
- Not a game engine — it produces assets, not interactive applications
- Not a renderer — it creates geometry and textures, not final images

## Prior art

- [Blender geometry nodes](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/) — visual procedural generation
- [Houdini](https://www.sidefx.com/) — procedural content creation
- [nannou](https://nannou.cc/) — creative coding in Rust

## Related projects

- [dew](/dew) — expression language used for procedural parameters
- [playmate](/playmate) — game primitives that consume unshape output
