Lua runtime with plugin system for the rhi ecosystem.

## What it is

A core Lua runtime that serves as the scripting backbone of rhi. Moonlet provides a plugin system where Rust crates expose functionality to Lua scripts, creating a bridge between high-performance native code and flexible scripting.

Key integrations:

- **Moss** — code analysis plugin powered by [normalize](/normalize)
- **Lotus** — world state management for persistent environments
- **Portals** — capability-based interfaces via [portals](/portals)

Moonlet scripts can combine capabilities from different plugins, making it the composition layer for the ecosystem.

## What it isn't

- Not a standalone Lua distribution — it's an embedded runtime with ecosystem integrations
- Not a scripting-only solution — the plugins provide native-speed operations
- Not a replacement for application code — it's for orchestration and configuration

## Prior art

- [Neovim Lua](https://neovim.io/doc/user/lua.html) — embedded Lua with plugin system
- [Roblox Luau](https://luau-lang.org/) — typed Lua variant
- [mlua](https://github.com/mlua-rs/mlua) — Rust-Lua bindings (used internally)

## Related projects

- [normalize](/normalize) — provides code intelligence as a moonlet plugin
- [portals](/portals) — defines the capability interfaces moonlet exposes
- [zone](/zone) — Lua-based tooling built on moonlet
- [dew](/dew) — expression language with a Lua backend for moonlet
