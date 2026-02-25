---
label: "moonlet"
description: "a small Lua engine that grows with plugins"
url: https://docs.rhi.zone/moonlet
parent: ecosystem/rhi
status: fleshed-out
tags: [rust, lua, infrastructure]
---

Lua runtime with a plugin system for agentic AI execution. multi-provider LLM client, SQLite-backed memory, dynamic C ABI plugin loading, and capability-based security.

## what it is

the scripting backbone of rhi. moonlet is a LuaJIT runtime where Rust crates expose functionality to Lua scripts via C ABI plugins. scripts get capabilities through a `caps` table, no ambient authority.

plugins include an LLM client (Anthropic, OpenAI, Azure, Gemini, Cohere, DeepSeek, Groq, Mistral, Ollama, OpenRouter, Perplexity, Together, XAI), embedding generation, SQLite-backed memory with metadata and weights, capability-based filesystem access, code analysis via [normalize](/project/normalize), session management, tool execution, and package management.

## Related projects

- [normalize](/project/normalize) - available as moonlet-normalize plugin
- [portals](/project/portals) - moonlet uses portals-io and portals-filesystem
- [zone](/project/zone) - Lua projects run on moonlet
- [wick](/project/wick) - Lua backend for moonlet
