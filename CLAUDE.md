# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Pteraworld is a personal portfolio website that renders projects as a spatial, zoom-based graph. Zero runtime dependencies, single-page app, all TypeScript. Deployed to GitHub Pages.

## Commands

```bash
bun install          # install dependencies
bun run dev          # dev server at localhost:3000 (all collections)
bun run build        # build all collections to dist/
bun run preview      # preview production build locally
bun lint             # oxlint on src/
bun check:types      # type check with tsgo (native TS compiler)
bun run inspect      # ASCII scatter plot + collision report for current layout
```

All commands route through `src/cli.ts`. Direct subcommands:
```bash
bun run src/cli.ts graph [dirs...]          # generate graph for specific dirs
bun run src/cli.ts headings [dirs...]       # extract headings for specific dirs
bun run src/cli.ts pages                    # generate static HTML content pages
bun run src/cli.ts build --collection <id>  # build a single collection
```

## Architecture

Single-page app with no framework. All source is in `src/` (~1,200 lines). Content lives as markdown files in `public/content/`.

**Entry flow:** `main.ts` bootstraps the app - creates camera + graph, builds DOM, sets up input handlers, initializes panel, registers service worker.

**Key modules:**

- `graph.ts` - node/edge data model (interfaces + `createGraph()`). Imports auto-generated nodes and edges from `generated-graph.ts`
- `frontmatter.ts` - zero-dep YAML frontmatter parser for build-time use
- `cli.ts` - unified CLI entry point, orchestrates build/graph/headings/pages/inspect/dev commands
- `content.ts` - shared content utilities (`findMarkdownFiles`), single source of truth for directory walking
- `gen-graph.ts` - build-time script that reads `public/content/**/*.md` frontmatter + `## Related projects` links, computes layout (positions, colors), generates groupings, and writes `src/generated-graph.ts` + `src/generated-groupings.ts`. Accepts directory list to scope content
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

**Styling** lives in `public/style.css`, shared by all collection entry points. Dark theme, responsive (side panel on desktop, bottom panel on mobile). Collection-specific overrides use `html[data-collection="..."]` selectors.

## Conventions

- Zero runtime dependencies - everything is hand-rolled
- Nix flake provides the dev environment (activated via direnv)
- Node tiers: `ecosystem` (large regions), `project` (dots), `detail` (future)
- Recent commit style uses conventional commits (feat:, fix:, style:, docs:)
- Always update docs (ROADMAP.md, CLAUDE.md, README.md) before committing if behavior changed
- Content files use YAML frontmatter as single source of truth for node metadata
- Tier and cluster assignment are data-driven: cluster configs in `public/content/cluster/*.md` declare which `directories` they own, what `tier` and `autoTags` to apply. Files without a cluster or explicit `tier:` in frontmatter are content-only (grouping regions, etc.)
- Structural tiers (region, meta) are declared in each file's frontmatter (`tier: region`, `tier: meta`)

## Essay content index

`CONTENT.md` at the repo root is a thematic index of all 74 essays (49 prose + 25 unfiltered), organized into 7 thematic clusters with per-essay one-line summaries, cross-collection resonance pairings, and non-obvious connections. Consult it when asked about essay themes or cross-essay relationships — do not re-read individual essays to answer questions that the index already covers.

## Essay voice — prose/* and unfiltered/* files

the essays talk alongside you, not above you. second person, working something out together. "you" is load-bearing — it's how the essays stay peer-level instead of sliding into lecture.

the voice is warmth from paying attention, not from performing warmth. if something's serious it comes through on its own — you don't announce it, frame it, or build up to it. you notice things, put them next to each other, and let the reader close the gap. the sentence-level register should match the project descriptions: lowercase, direct, says the thing and stops, no effort to impress.

what the voice does:
- follows a thread. a thought starts somewhere and sometimes ends somewhere else. that's fine. structure should look unplanned — sections don't obviously build on each other.
- stays specific. concrete details, not abstractions about abstractions. "a gray that couldn't decide if it was morning or evening" instead of "an ambiguous situation."
- admits when it doesn't know. not as a rhetorical move ("it's hard to say") — as in, the sentence genuinely doesn't land and the essay keeps going anyway. "i'm not sure what to do with that" is fine when it's honest.
- varies. some sentences short. some long and recursive and not entirely sure where they're going. the rhythm changes paragraph to paragraph. no template.

not: glossary structure, correcting the reader, announcing intent, punchy standalone sentences, pretension, negative language. `scripts/lint-bold-labels.sh` catches the most mechanical pattern.

prose/ is capitalized. unfiltered/ is lowercase, rawer, more declarative — but the same underlying voice. if the two collections sound like the same writer wearing different hats, that's a tell. they should think differently, not just capitalize differently.

cross-links between essays are the connective tissue — preserve them. essay length varies; peer doesn't mean brief.

## Build tool principles — no hardcoding

**Never hardcode content-specific values in build tools (`src/gen-*.ts`, `src/inspect-*.ts`).** This means: no node IDs, no cluster name strings, no magic thresholds derived from CSS layout, no assumed positions, no directory-name switch statements.

**The goal is fully agnostic tooling.** All behavior should be driven by content and config data (frontmatter, cluster YAML), never by directory names or string matching in code. Adding a new content directory or collection should never require changing a switch statement or adding a special case to the build pipeline. Remaining special cases are technical debt to be eliminated.

Allowed structural queries (use freely):
- `node.tier` — `"region" | "artifact" | "detail" | "meta"`
- `node.parent` — containment relationship
- `node.tags` — tag-based checks (e.g. `node.tags.includes("essay")`)
- `node.cluster`, `node.status`, `node.x`, `node.y`, `node.radius` — all from generated data

Not allowed in scripts:
- `node.id.startsWith("prose/")` or any directory-prefix check — use tags instead
- CSS element dimensions (the landing panel's pixel extents aren't available at build time)
- Proximity thresholds that encode assumed layout geometry (e.g. `META_ESSAY_DIST = 160`)
- Explicit cluster name strings like `n.cluster === "meta-essays"`
- Any constant that would break silently if content is added or moved

If a layout needs a non-default ring radius, add a `ringRadius:` field to the cluster's YAML frontmatter in `public/content/cluster/` and read it in `gen-graph.ts`. Do not hardcode it in the layout script or the inspector.

## Layout / cluster system

- Cluster configs: `public/content/cluster/*.md` — each defines declarative **constraints**, not coordinates or physics params
- Cluster configs declare `directories:` to claim content directories, `tier:` and `autoTags:` for their nodes. Cluster assignment is a data lookup, not a switch statement
- Region radius must contain its ring of children: after computing child ring radius, `region.radius` must satisfy `region.radius ≥ ringR + maxChildR + margin`
- Force layout: use for clusters with meaningful edge relationships; ring layout for small/positionally-fixed clusters

## Multi-collection architecture

The site supports multiple collections sharing the same spatial graph and JS bundle. Each collection has its own HTML entry point, meta node, and visual treatment.

- Collections are defined in `src/site-config.ts` (`siteConfig.collections`)
- Each collection's entry point is generated by `gen-pages.ts` at `dist/<collection>/index.html`
- The `<html data-collection="...">` attribute drives runtime behavior and CSS theming
- `getActiveCollection()` reads the attribute at runtime; build scripts get `"default"`
- All collections' nodes live on the same graph — the graph is structure, not voice
- **Cross-collection linking is one-way:** unfiltered essays may link to prose (main site) essays. Prose essays must NOT link to unfiltered content. The main site reader shouldn't be pulled into the unfiltered voice without choosing to go there

## Layout constraints — the content author API

**Content authors declare constraints, not coordinates or parameters.** The layout algorithm is responsible for finding positions that satisfy them. Users should never need to tune numbers.

Constraint types (declared in cluster YAML frontmatter):
- `near: <node-id>` — cluster should be placed near this node (e.g. `near: meta/pteraworld`)
- `below: <node-id>`, `above: <node-id>`, `left-of: <node-id>`, `right-of: <node-id>` — relative positioning
- `visible-at: <zoom>` — all nodes in cluster should fit within a standard 1920×1080 viewport at this zoom level centered on the world origin
- Overlap is a universal constraint — nothing should overlap, ever (enforced by the algorithm, not declared per-cluster)

**Absolute coordinates (`center:`) are a code smell.** They break when other clusters move, they don't express intent, and they require manual re-tuning. Replace with relative constraints wherever possible.

**Dynamic layout is not a crutch.** Runtime adaptation to viewport size is legitimate for things genuinely unknowable at build time (phone portrait, ultrawide, etc.). But layout *intent* — clustering, proximity, relative positioning — is fixed at build time. At runtime the build-time solution is scaled/adjusted within tight bounds; it is never re-solved from scratch. Build-time layout is the ground truth.

## Force layout — parameter philosophy

Force layout parameters are **never user-facing**. They are derived from the cluster geometry and tuned automatically via a run-and-measure feedback loop at build time:

1. Derive initial params from node geometry (minDist from radii, restLen, repulsion, gravity)
2. Run simulation
3. Measure output quality across four axes:
   - **Overlap**: no two nodes intersecting
   - **Spread**: cluster bounding radius within expected range for node count
   - **Edge satisfaction**: connected pairs meaningfully closer than unconnected pairs
   - **Clustering**: nodes sharing graph neighbors should form visible spatial subgroups
4. If thresholds not met, adjust params in the direction that fixes the worst failure and re-run
5. Apply the best-scoring result across all attempts

The four metrics each have directional fixes: overlaps → more repulsion; poor edge satisfaction → more attraction; poor clustering → more attraction relative to repulsion; no cohesion → stronger gravity.

## Session Handoff

Use plan mode as a handoff mechanism when:
- A task is fully complete (committed, pushed, docs updated)
- The session has drifted from its original purpose
- Context has accumulated enough that a fresh start would help

Before entering plan mode:
- Update TODO.md with any remaining work
- Update memory files with anything worth preserving across sessions

Then enter plan mode and write a plan file that either:
- Proposes the next task if it's clear: "next up: X — see TODO.md"
- Flags that direction is needed: "task complete / session drifted — see TODO.md"

ExitPlanMode hands control back to the user to approve, redirect, or stop.
