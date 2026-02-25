---
label: "zone"
description: "Lua scripts that wire things together"
url: https://docs.rhi.zone/zone
parent: ecosystem/rhi
status: early
tags: [lua, cli, infrastructure]
---

rhi ecosystem monorepo for Lua-based tools, project scaffolds, and orchestration.

## what it is

the operational layer of rhi. zone contains Lua projects that run on [moonlet](/project/moonlet) and seed templates that [myenv](/project/myenv) uses for scaffolding.

wisteria handles autonomous task execution with LLM integration and code understanding. seeds are project templates for creating things from scratch, lifting legacy games, or setting up full ecosystem sandboxes. each Lua project is self-contained with an `init.lua` entry point, and seeds use a `seed.toml` manifest with variable substitution.

## Related projects

- [moonlet](/project/moonlet) - Lua runtime that executes zone scripts
- [myenv](/project/myenv) - reads zone seeds for project scaffolding
- [normalize](/project/normalize) - code intelligence used via moonlet-normalize plugin
