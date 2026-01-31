Fast code intelligence CLI. Structural awareness of codebases through AST-based analysis across 98 languages.

## What it is

A command-line tool for understanding code structurally. Instead of treating source files as text, normalize parses them into syntax trees and works with the shapes — functions, types, modules, imports — directly.

Core commands:

- `normalize view` — structural outline with line numbers
- `normalize analyze` — symbol analysis and dependency tracking
- `normalize text-search` — search with structural context
- `normalize lint` — pattern-based code quality checks
- `normalize health` — codebase health metrics

Built on tree-sitter for parsing, with custom structural analysis on top. Supports 98 languages out of the box.

## What it isn't

- Not an LSP server — it's a CLI tool, not an IDE backend
- Not a linter replacement — it finds structural patterns, not style issues
- Not a code search engine — it provides context-aware search, not indexed full-text search

## Prior art

- [tree-sitter](https://tree-sitter.github.io/) — the parsing foundation
- [ctags](https://ctags.io/) — symbol indexing (normalize goes deeper into structure)
- [semgrep](https://semgrep.dev/) — pattern-based code analysis

## Related projects

- [moonlet](/moonlet) — uses normalize as a plugin for code-aware Lua scripting
- [zone](/zone) — Lua tooling that leverages normalize for project scaffolding
