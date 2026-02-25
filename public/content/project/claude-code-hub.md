---
label: "claude-code-hub"
description: "coordinates multiple Claude Code agents"
url: https://github.com/pterror/claude-code-hub
status: early
tags: [ai, typescript]
---

orchestration hub for Claude Code agents. spawns agents, tracks their status, and exposes an HTTP API with WebSocket streaming. designed for checking on things from your phone over Tailscale.

## what it is

instead of juggling terminal windows, you POST to `/agents` with a working directory and prompt to spawn an agent. GET `/agents` shows status and recent output, `/ws` streams in real time, and you can send follow-ups to running agents.

each agent gets its own working directory and CLAUDE.md context. there's a mobile-friendly UI included.

built with Bun, the Claude Agent SDK, Zod v4, and web-push for mobile notifications.
