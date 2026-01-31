Rhi ecosystem configuration manager.

## What it is

A tool that generates per-tool configuration files from a central `myenv.toml` manifest. Instead of maintaining separate config files for every tool in a project, you define everything in one place and myenv generates the rest.

Supported tools:

- **siphon** — data pipeline configuration
- **dew** — expression language settings
- **spore** — project scaffolding templates

Myenv supports project variables — shared values that get substituted into generated configs — so you can keep things like project names, paths, and version numbers consistent across all tooling.

## What it isn't

- Not a package manager — it generates config files, not installs software
- Not a build system — it configures tools, not builds projects
- Not dotfile management — it's project-scoped, not user-scoped

## Prior art

- [direnv](https://direnv.net/) — per-directory environment variables
- [mise](https://mise.jdx.dev/) — polyglot tool version manager
- [nx](https://nx.dev/) — monorepo toolchain coordination

## Related projects

- [zone](/zone) — Lua tooling that uses myenv for project scaffolding
- [moonlet](/moonlet) — runtime configured via myenv manifests
