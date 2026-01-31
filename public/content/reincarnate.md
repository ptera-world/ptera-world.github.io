Legacy software lifting framework.

## What it is

A tool for extracting and transforming applications from obsolete runtimes into modern equivalents. Reincarnate targets platforms that are no longer maintained but still have valuable content trapped inside:

- **Flash / SWF** — browser games and interactive content
- **VB6** — desktop applications
- **GameMaker** — indie games in older GM formats
- **HyperCard** — early hypertext stacks

The approach works in tiers:

1. **Native patching** — minimal changes to run on modern runtimes
2. **Runtime replacement** — swap the obsolete runtime for a modern one
3. **Full lifting** — translate the application logic to a new platform

## What it isn't

- Not an emulator — it transforms applications, not simulates runtimes
- Not a decompiler — it works with application structure, not raw bytecode
- Not automatic — complex applications need manual guidance

## Prior art

- [Ruffle](https://ruffle.rs/) — Flash player emulator in Rust
- [Flashpoint](https://flashpointarchive.org/) — web game preservation project
- [Wine](https://www.winehq.org/) — Windows API compatibility layer

## Related projects

- [normalize](/normalize) — structural analysis helps understand legacy code
- [rescribe](/rescribe) — document conversion techniques apply to application lifting
