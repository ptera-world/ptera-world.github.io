# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Pteraworld is a personal portfolio website that renders projects as a spatial, zoom-based graph. Zero runtime dependencies, single-page app, all TypeScript. Deployed to GitHub Pages.

## Commands

```bash
bun install          # install dependencies
bun run dev          # dev server at localhost:3000
bun run build        # generate graph + bundle with minification to dist/
bun run preview      # preview production build locally
bun lint             # oxlint on src/
bun check:types      # type check with tsgo (native TS compiler)
bun run gen-edges    # regenerate src/generated-graph.ts from markdown files
```

## Architecture

Single-page app with no framework. All source is in `src/` (~1,200 lines). Content lives as markdown files in `public/content/`.

**Entry flow:** `main.ts` bootstraps the app - creates camera + graph, builds DOM, sets up input handlers, initializes panel, registers service worker.

**Key modules:**

- `graph.ts` - node/edge data model (interfaces + `createGraph()`). Imports auto-generated nodes and edges from `generated-graph.ts`
- `frontmatter.ts` - zero-dep YAML frontmatter parser for build-time use
- `gen-graph.ts` - build-time script that reads `public/content/**/*.md` frontmatter + `## Related projects` links, computes layout (positions, colors), generates groupings, and writes `src/generated-graph.ts` + `src/generated-groupings.ts`
- `groupings.ts` - grouping interfaces + imports generated grouping data. Groupings (ecosystem, domain, tech, status) are derived from content: `domain/`, `technology/`, `status/` markdown files define regions, node tags/status determine membership
- `camera.ts` - camera state (x, y, zoom) and tier system. Screen-to-world coordinate conversion
- `dom.ts` - DOM construction, CSS transform animations, focus/hover state
- `input.ts` - mouse/touch/wheel event handling, drag panning, zoom, WASD smooth panning, arrow key spatial navigation, Enter key confirm, keybinds schema + command palette + cheatsheet + context menu
- `card.ts` - popup quick-preview card shown on node click
- `minimap.ts` - canvas-based minimap for spatial orientation at deep zoom, click-to-pan
- `panel.ts` - side panel that fetches and displays markdown content, with in-memory cache
- `markdown.ts` - minimal homegrown markdown-to-HTML parser (no dependencies), strips frontmatter at runtime
- `gen-headings.ts` - build-time script that extracts headings from content files for search
- `gen-pages.ts` - build-time script that generates static HTML pages from content files
- `dev.ts` - Bun-based dev server with on-demand TS compilation

**Zoom tier system** controls visibility:
- Far (zoom < 1.5): ecosystem regions only
- Mid (1.5-3.5): project dots + names
- Near (≥ 3.5): full detail

**Content pipeline:** Markdown files in `public/content/` have YAML frontmatter (label, description, tags, parent, status, url, etc.) that defines graph node metadata. At build time, `gen-graph.ts` reads all frontmatter and `## Related projects` links to generate `src/generated-graph.ts` with computed positions, colors, and edges. At runtime, markdown is fetched and parsed in-browser (frontmatter is stripped). `src/generated-graph.ts` is gitignored and regenerated on build.

**Adding a new project:** Create a markdown file in the appropriate `public/content/` subdirectory with frontmatter, then rebuild. The node will appear automatically with algorithmically-computed position and color.

**Styling** is embedded in `public/index.html` as inline CSS. Dark theme, responsive (side panel on desktop, bottom panel on mobile).

## Conventions

- Zero runtime dependencies - everything is hand-rolled
- Nix flake provides the dev environment (activated via direnv)
- Node tiers: `ecosystem` (large regions), `project` (dots), `detail` (future)
- Recent commit style uses conventional commits (feat:, fix:, style:, docs:)
- Always update docs (ROADMAP.md, CLAUDE.md, README.md) before committing if behavior changed
- Content files use YAML frontmatter as single source of truth for node metadata
- Directories in `public/content/` determine tier inference: `ecosystem/` → region, `project/` → project, `prose/` → project, `meta/` → meta
- `domain/`, `technology/`, `status/` directories contain content-only pages (not graph nodes) unless frontmatter explicitly sets `tier:`
