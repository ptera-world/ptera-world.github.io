Rhi ecosystem monorepo for Lua-based tools, scaffolds, and orchestration.

## What it is

The operational backbone of the rhi ecosystem. Zone contains the Lua scripts, project templates, and automation that keep the ecosystem running smoothly.

Key components:

- **Wisteria** — autonomous task execution engine for CI/CD and maintenance
- **Seeds** — project templates for scaffolding new rhi projects
- **Documentation** — shared docs infrastructure

Zone uses [myenv](/myenv) for configuration and [moonlet](/moonlet) for script execution, tying together the ecosystem's operational concerns.

## What it isn't

- Not a framework — it's operational tooling, not application infrastructure
- Not required — individual projects work without zone
- Not a CI system — it provides tasks that run *within* CI, not the CI itself

## Prior art

- [turborepo](https://turbo.build/) — monorepo task runner
- [just](https://just.systems/) — command runner
- [make](https://www.gnu.org/software/make/) — the original build automation tool

## Related projects

- [moonlet](/moonlet) — Lua runtime that executes zone scripts
- [myenv](/myenv) — configuration manager used by zone
- [normalize](/normalize) — code intelligence used in zone's scaffolding
