# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Pteraworld is a personal portfolio website that renders projects as a spatial, zoom-based graph. Zero runtime dependencies, single-page app, all TypeScript. Deployed to GitHub Pages.

## Commands

```bash
bun install          # install dependencies
bun run dev          # dev server at localhost:3000
bun run build        # generate edges + bundle with minification to dist/
bun run preview      # preview production build locally
bun lint             # oxlint on src/
bun check:types      # type check with tsgo (native TS compiler)
bun run gen-edges    # regenerate src/generated-edges.ts from markdown files
```

## Architecture

Single-page app with no framework. All source is in `src/` (~1,200 lines). Content lives as markdown files in `public/content/`.

**Entry flow:** `main.ts` bootstraps the app - creates camera + graph, builds DOM, sets up input handlers, initializes panel, registers service worker.

**Key modules:**

- `graph.ts` - node/edge data model. Hardcoded node definitions with positions, tiers, colors. Imports auto-generated edges from `generated-edges.ts`
- `camera.ts` - camera state (x, y, zoom) and tier system. Screen-to-world coordinate conversion
- `dom.ts` - DOM construction, CSS transform animations, focus/hover state
- `input.ts` - mouse/touch/wheel event handling, drag panning, zoom
- `card.ts` - popup quick-preview card shown on node click
- `panel.ts` - side panel that fetches and displays markdown content, with in-memory cache
- `markdown.ts` - minimal homegrown markdown-to-HTML parser (no dependencies)
- `gen-edges.ts` - build-time script that reads `public/content/*.md`, extracts `## Related projects` links, and writes `src/generated-edges.ts`
- `dev.ts` - Bun-based dev server with on-demand TS compilation

**Zoom tier system** controls visibility:
- Far (zoom < 1.5): ecosystem regions only
- Mid (1.5-3.5): project dots + names
- Near (≥ 3.5): full detail

**Content pipeline:** markdown files in `public/content/` are fetched at runtime and parsed in-browser. The `## Related projects` sections in those files are also parsed at build time by `gen-edges.ts` to auto-generate graph edges. `src/generated-edges.ts` is gitignored and regenerated on build.

**Styling** is embedded in `public/index.html` as inline CSS. Dark theme, responsive (side panel on desktop, bottom panel on mobile).

## Conventions

- Zero runtime dependencies - everything is hand-rolled
- Nix flake provides the dev environment (activated via direnv)
- Node tiers: `ecosystem` (large regions), `project` (dots), `detail` (future)
- Recent commit style uses conventional commits (feat:, fix:, style:, docs:)
