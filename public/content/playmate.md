Game design primitives library.

## What it is

A collection of reusable building blocks for game development. Playmate provides the fundamental systems that most games need — state machines, character controllers, camera systems, procedural generation — without coupling them to a specific engine.

Included primitives:

- **State machines** — finite and hierarchical state machines for game logic
- **Character controllers** — physics-based movement systems
- **Camera systems** — follow cameras, free cameras, cinematic rails
- **Procedural generation** — terrain, dungeons, item distribution
- **Inventory systems** — item management with constraints

Designed to integrate with Bevy and other Rust game engines.

## What it isn't

- Not a game engine — it provides components, not a full runtime
- Not a game — it's a library of reusable pieces
- Not engine-specific — primitives are designed to be engine-agnostic where possible

## Prior art

- [Bevy](https://bevyengine.org/) — ECS game engine (playmate integrates with Bevy)
- [Unity packages](https://docs.unity3d.com/Manual/PackagesList.html) — modular game components
- [Godot addons](https://godotengine.org/asset-library/asset) — reusable game modules

## Related projects

- [unshape](/unshape) — generates meshes and textures that playmate systems can use
- [interconnect](/interconnect) — federation protocol for connecting playmate-powered worlds
