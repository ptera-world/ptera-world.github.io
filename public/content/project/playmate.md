---
label: "playmate"
description: "building blocks for making games"
url: https://docs.rhi.zone/playmate
parent: ecosystem/rhi
status: early
tags: [creative, games, rust]
---

game design primitives. reusable building blocks for state machines, character controllers, cameras, and procedural generation. works with Godot, Bevy, Unity, Love2D, or custom engines.

## what it is

building blocks, not a framework. playmate provides the systems most games need without coupling to a specific engine.

state machines (finite and hierarchical), character controllers (kinematic, not floaty dynamic ones), camera systems (follow, free, cinematic rails), procedural generation (terrain, dungeons, items), and spatial/pathfinding primitives in Rust.

three layers: core (pure Rust, performance-critical), bindings (engine adapters via GDExtension, Bevy systems, etc.), and scripting (game logic in GDScript, Lua, or C#). parameters are data-driven and tunable without recompilation.

## Related projects

- [unshape](/project/unshape) - generates meshes and textures playmate systems can use
- [interconnect](/project/interconnect) - federation protocol for connecting playmate-powered worlds
