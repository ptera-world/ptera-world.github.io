Configuration manager for the rhi ecosystem. Generates per-tool config files from a central `myenv.toml` manifest. Tools never read myenv.toml directly - they only read generated native configs.

## What it is

One source of truth for project configuration. You define everything in `myenv.toml`, and myenv generates native config files for each tool. Tools stay dumb - they have no idea myenv exists at runtime.

Features:

- Variable substitution across tool configs
- Schema validation via `tool --schema` convention (validate before write)
- Project scaffolding via seeds (creation, archaeology, lab templates from [zone](/zone))

## Key design decisions

- Config generation, not orchestration (spore orchestrates)
- Tools stay dumb: no myenv conventions at runtime
- Invisible manifest: tools unaware of myenv
- Validate before write: catch errors before generating

## Related projects

- [zone](/zone) - hosts seed templates that myenv reads for project scaffolding
- [moonlet](/moonlet) - runtime configured via myenv manifests
