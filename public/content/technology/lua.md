---
label: "lua"
description: "scripting and glue"
color: "oklch(0.7 0.12 250)"
---
scripting and glue.

## what it is

lua is the scripting layer. small, fast, embeddable, with a runtime that fits in 200KB. perfect for configuration, orchestration, game logic, and anywhere you want behavior to be data-driven.

moonlet provides the runtime with plugin system. zone hosts the actual lua projects. wick can emit lua for embedded contexts.

the pattern: rust does the heavy lifting, lua handles the logic that should be changeable at runtime without recompilation.

## projects

- [moonlet](/project/moonlet) - Lua runtime with plugins
- [zone](/project/zone) - Lua project monorepo
- [pad](/project/pad) - terminal data capture
- [lua](/project/lua) - experimental playground
