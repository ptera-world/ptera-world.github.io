Simple orchestration hub for Claude Code agents.

## What it is

A server that spawns and manages Claude Code agents via the Anthropic Agent SDK. It provides a web interface for viewing agent status, sending messages, and monitoring progress across multiple concurrent sessions.

Key features:

- **Agent spawning** — create Claude Code sessions on demand
- **Status tracking** — real-time view of agent progress and output
- **Web UI** — browser-based interface for interaction
- **Tailscale** — works over tailscale for secure remote access

## What it isn't

- Not an AI framework — it's a management layer for Claude Code specifically
- Not a chat interface — it orchestrates coding agents, not conversations
- Not self-hosted AI — it connects to Anthropic's API

## Prior art

- [Coder](https://coder.com/) — remote development environments
- [Gitpod](https://www.gitpod.io/) — cloud development workspaces

## Related projects

- [zone](/zone) — Lua automation that could be orchestrated through claude-code-hub
