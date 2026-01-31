code intelligence CLI that works structurally across 98 languages via tree-sitter. navigation, editing, analysis, search, and package management through a single interface.

## what it is

instead of treating source code as text, normalize works with syntax trees (functions, types, modules, imports). everything outputs as JSON/JSONL with optional `--jq` filtering, so it plugs into scripts and pipelines easily.

## viewing code

`normalize view` is the main way to navigate. you give it a path (file, directory, or symbol like `src/main.py/Foo/bar`) and it shows you the structure at whatever depth you want. `--depth 0` gives names only, `--depth 1` adds signatures, `--depth -1` expands everything. there's a `--focus` mode that shows your target in detail with imports at signature level, and `--resolve-imports` inlines the signatures of imported symbols. you can also look at git history for a specific symbol with `--history`.

## structural editing

`normalize edit` does code modifications at the symbol level. delete, replace, swap, insert, move, or copy symbols by name. it keeps a shadow git history so you can undo/redo, and `--dry-run` shows what would change. batch edits from JSON are supported too.

## analysis

`normalize analyze` has a bunch of subcommands: health metrics, complexity scoring, function length, security scanning, documentation coverage, duplicate detection (both functions and types), test gap detection, hotspots from git history, and caller/callee tracing. you can scope analysis to only changed files with `--diff main`. there's also support for custom tree-sitter query rules via `.normalize/rules/*.scm`.

## everything else

- `normalize text-search` - ripgrep-based search with `--exclude`/`--only` filtering
- `normalize package` - dependency info, tree, outdated checks, and security audit across ecosystems (Cargo, npm, pip, etc.)
- `normalize tools` - runs linters, formatters, type checkers, and test runners for whatever ecosystem you're in
- `normalize translate` - translates code between TypeScript, Lua, and Python
- `normalize generate` - generates API clients from OpenAPI specs, types from schemas, and CLI snapshot tests
- `normalize sessions` - analyzes Claude Code and other agent session logs (list, show, stats, plans)
- `normalize context` - collects hierarchical `.context.md` files for a directory
- `normalize serve` - runs as an MCP server (for LLM integration), HTTP REST API, or LSP server

98 languages are supported through tree-sitter grammars, installable via `normalize grammars install`.

## Related projects

- [moonlet](/moonlet) - normalize is available as a moonlet plugin (moonlet-normalize)
- [zone](/zone) - Lua tooling that leverages normalize for project scaffolding
