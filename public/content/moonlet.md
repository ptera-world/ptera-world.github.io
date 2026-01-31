Lua runtime with plugin system for agentic AI execution. Multi-provider LLM client, SQLite-backed memory store, dynamic C ABI plugin loading, and capability-based security.

## What it is

The scripting backbone of rhi. Moonlet provides a LuaJIT runtime where Rust crates expose functionality to Lua scripts via a C ABI plugin system. Scripts receive capabilities through a `caps` table - no ambient authority.

Plugins:

- **llm** - multi-provider client (Anthropic, OpenAI, Azure, Gemini, Cohere, DeepSeek, Groq, Mistral, Ollama, OpenRouter, Perplexity, Together, XAI)
- **embed** - embedding generation (OpenAI, Azure, Gemini, Cohere, Mistral, Ollama, Together)
- **libsql** - SQLite-backed memory store with metadata and weights
- **fs** - capability-based filesystem access
- **normalize** - code analysis integration via [normalize](/normalize)
- **sessions** - session management
- **tools** - tool execution
- **packages** - package management

## Key design decisions

- Moonlet = agency/execution (LLM, memory, running agents); moss = intelligence (analysis, understanding)
- Capability-based security: scripts receive pre-opened handles, not path strings
- C ABI plugin system for language interop
- Not hard-linked to any single analysis tool; integrates via dynamically loaded plugins

## Related projects

- [normalize](/normalize) - available as moonlet-normalize plugin
- [portals](/portals) - moonlet uses portals-io and portals-filesystem
- [zone](/zone) - Lua projects run on moonlet
- [dew](/dew) - Lua backend for moonlet
