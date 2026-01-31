Constructive generation and manipulation of media in Rust. Covers 3D meshes, audio synthesis, textures, 2D vectors, rigging, physics simulation, procedural generation, and node graphs. Bevy-compatible with no hard dependency.

## What it is

A media generation library where every operation is a value. You describe how to build media rather than editing existing assets. Operations are structs - serializable, composable, optimizable.

Domains:

- **Meshes** - procedural geometry, booleans, decimation, LOD, topology analysis, UV atlas packing
- **Audio** - FM/wavetable/granular synthesis, effects, 3D spatial HRTF, pattern sequencing
- **Textures** - Perlin, Simplex, fBm with lazy Field trait, signed distance fields
- **2D vector** - SVG-like paths, bezier curves, booleans, hatching, rasterization
- **Rigging** - skeletons, IK solvers, weight painting, heat diffusion skinning
- **Physics** - rigid bodies, soft bodies, cloth, fluids, smoke simulation
- **Procedural** - L-systems, wave function collapse, mazes, terrain erosion, space colonization
- **Node graphs** - dynamic typed execution with type-safe connections

## Key design decisions

- Operations as values: every operation is a struct (serializable), with optional method sugar
- Three-layer architecture: primitives, helpers, optimizer
- General-internal, constrained-API pattern (e.g., VectorNetwork internally, Path API externally)
- Uses glam for math (Bevy-compatible) but no hard engine dependency

## Related projects

- [dew](/dew) - expression language used for procedural parameters
