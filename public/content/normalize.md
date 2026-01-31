Fast code intelligence CLI providing structural awareness of codebases through AST-based analysis. Supports 98 languages via tree-sitter with unified commands for navigation, analysis, linting, search, and package management.

## What it is

A command-line tool that treats source code structurally. Instead of text, normalize works with syntax trees - functions, types, modules, imports - across 98 languages through a single interface.

Core commands:

- `normalize view` - structural outline of files and directories with line numbers
- `normalize analyze` - codebase health metrics, complexity, hotspots, duplicates, documentation coverage
- `normalize tools` - unified interface to linters, formatters, test runners
- `normalize text-search` - full-text search with ripgrep backend and file filtering
- `normalize packages` - query package registries (Cargo, npm, pip, Go, Bundler, Composer, Hex, Maven, NuGet, Nix, Conan)

Also serves as MCP server, HTTP REST API, or LSP server. Can parse Claude Code session logs and run Lua scripts for automation.

## Key design decisions

- Index-first architecture: core extraction lives in Rust index, commands work without index via graceful degradation
- OutputFormatter trait: consistent `--pretty`/`--compact`/`--json` output across all commands
- Dog-fooding: uses its own commands instead of builtin tools

## Related projects

- [moonlet](/moonlet) - normalize is available as a moonlet plugin (moonlet-normalize)
- [zone](/zone) - Lua tooling that leverages normalize for project scaffolding
