Rhi ecosystem monorepo for Lua-based tools, project scaffolds, and orchestration.

## What it is

The operational layer of the rhi ecosystem. Zone contains Lua projects that run on [moonlet](/moonlet) and seed templates that [myenv](/myenv) uses for project scaffolding.

Components:

- **Wisteria** - autonomous task execution with LLM integration and code understanding via moss
- **Seeds** - project templates (creation: new from scratch, archaeology: lift legacy game, lab: full ecosystem sandbox)

Each Lua project is self-contained with an `init.lua` entry point and submodules in a nested directory. Seeds have a `seed.toml` manifest with `{{variable}}` substitution in template files.

## Key design decisions

- Monorepo for Lua projects (not Rust)
- Wisteria for agent execution, myenv for scaffolding, moonlet for runtime
- Seeds integrate with myenv: myenv reads zone seeds for project creation
- Lua entry point: `require("project-name")` loads `init.lua`

## Related projects

- [moonlet](/moonlet) - Lua runtime that executes zone scripts
- [myenv](/myenv) - reads zone seeds for project scaffolding
- [normalize](/normalize) - code intelligence used via moonlet-normalize plugin
