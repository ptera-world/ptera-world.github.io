Federation protocol for persistent worlds. Enables Lotus servers to form interconnected networks with single-authority ownership - no distributed state resolution.

## What it is

A protocol for connecting independently-operated persistent worlds. When a player crosses between worlds, their state is transferred - not replicated. Each world instance owns its state completely.

Two-layer architecture:

- **Substrate** - static, replicated, cacheable (the world's unchanging structure)
- **Simulation** - dynamic, authoritative, ephemeral (the world's live state)

Protocol primitives: Manifest (what a server allows/requires), Intent (client action request), Snapshot (world state at tick), Transfer (handoff with passport token). Import policies ("customs") validate player passports when crossing servers - clamp stats, filter items, accept or reject explicitly.

Ghost mode: when authority dies, the world desaturates, the player becomes an observer, but the substrate remains visible.

## Key design decisions

- Authority over consensus: no split-brain, no state merging
- Intent over state: never trust client-provided state
- Graceful degradation: static world better than void
- Explicit import policies: accept or reject, no silent drops

## Related projects

- [playmate](/playmate) - game primitives for worlds connected via interconnect
