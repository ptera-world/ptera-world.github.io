Game design primitives library. Reusable building blocks for state machines, character controllers, camera systems, and procedural generation. Multi-engine support: Godot, Bevy, Unity, Love2D, custom.

## What it is

Building blocks, not a framework. Playmate provides the fundamental systems that most games need, without coupling them to a specific engine:

- **State machines** - finite and hierarchical, for animation, AI, and gameplay
- **Character controllers** - kinematic (code-driven, predictable), not dynamic (floaty)
- **Camera systems** - follow cameras, free cameras, cinematic rails
- **Procedural generation** - terrain, dungeons, item distribution
- **Spatial/pathfinding** - performance-critical primitives in Rust

Three layers: Core (pure Rust, perf-critical), Bindings (engine adapters via GDExtension, Bevy systems, etc.), Scripting (game logic in GDScript, Lua, C#).

## Key design decisions

- Kinematic over dynamic: movement feel over physics-driven
- Data-driven: magic numbers in config/asset files, logic in Rust
- Hot-reloadable feel: parameters tunable without recompilation
- Rule: if modders should change it, scripting; if fast, core

## Related projects

- [unshape](/unshape) - generates meshes and textures playmate systems can use
- [interconnect](/interconnect) - federation protocol for connecting playmate-powered worlds
