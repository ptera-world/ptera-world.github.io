---
label: "unshape"
description: "describing media into existence"
url: https://docs.rhi.zone/unshape
parent: ecosystem/rhi
status: production
tags: [creative, rust]
---

constructive media generation in Rust. 3D meshes, audio synthesis, textures, 2D vectors, rigging, physics, procedural generation, and node graphs. Bevy-compatible with no hard dependency.

## what it is

a media generation library where every operation is a value. you describe how to build media rather than editing existing assets. operations are structs, so they're serializable, composable, and optimizable.

covers meshes (procedural geometry, booleans, decimation, LOD, UV packing), audio (FM/wavetable/granular synthesis, effects, spatial HRTF), textures (noise functions with lazy Field trait, signed distance fields), 2D vectors (SVG-like paths, bezier curves, hatching), rigging (skeletons, IK, weight painting), physics (rigid/soft bodies, cloth, fluids, smoke), procedural generation (L-systems, wave function collapse, terrain erosion), and node graphs for wiring it all together.

three layers internally: primitives, helpers, and an optimizer. uses glam for math so it plays well with Bevy, but doesn't depend on it.

## Related projects

- [wick](/project/wick) - expression language used for procedural parameters
