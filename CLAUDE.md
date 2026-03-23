# CLAUDE.md

## What This Is

ptera.world — a spatial graph that renders projects, essays, and fragments as an interactive, zoomable map. multiple collections (`/`, `/prose/`, `/unfiltered/`, `/intent/`, `/hubris/`) share one graph and JS bundle. zero runtime dependencies, single-page app, all TypeScript. deployed to GitHub Pages.

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

## Core Rules

**Note things down immediately — no deferral:**
- Problems, tech debt, issues → TODO.md now, in the same response
- Design decisions, key insights → docs or CLAUDE.md
- Future/deferred scope → TODO.md **before** writing any code, not after
- **Every observed problem → TODO.md. No exceptions.** Code comments and conversation mentions are not tracked items.

**Conversation is not memory.** Anything said in chat evaporates at session end. If it implies a future behavior change, write it to CLAUDE.md immediately — or it will not happen.

**Warning — these phrases mean something needs to be written down right now:**
- "I won't do X again" / "I'll remember to..." / "I've learned that..."
- "Next time I'll..." / "From now on I'll..."
- Any acknowledgement of a recurring error without a corresponding CLAUDE.md edit

**When the user corrects you:** Ask what rule would have prevented this, and write it before proceeding. **"The rule exists, I just didn't follow it" is never the diagnosis** — a rule that doesn't prevent the failure it describes is incomplete; fix the rule, not your behavior.

**Something unexpected is a signal, not noise.** Surprising output, anomalous numbers, files containing what they shouldn't — stop and ask why before continuing. Don't accept anomalies and move on.

**Do the work properly.** Don't leave workarounds or hacks undocumented. When asked to analyze X, actually read X — don't synthesize from conversation.

**Use subagents to protect the main context window.** For broad exploration or mechanical multi-file work, delegate to a subagent rather than running searches inline. Rules of thumb:
- Research tasks, surveying patterns → subagent
- Searching >5 files or >3 rounds of grep/read → subagent
- Codebase-wide analysis → always subagent
- Mechanical work across many files → parallel subagents
- Single targeted lookup → inline is fine

## Conventions

- Zero runtime dependencies — everything is hand-rolled
- Nix flake provides the dev environment (activated via direnv)
- Conventional commits (feat:, fix:, style:, docs:)
- Content files use YAML frontmatter as single source of truth for node metadata

## Essay voice — prose/* and unfiltered/* files

the essays talk alongside you, not above you. second person, working something out together. "you" is load-bearing — it's how the essays stay peer-level instead of sliding into lecture.

the voice is warmth from paying attention, not from performing warmth. if something's serious it comes through on its own — you don't announce it, frame it, or build up to it. you notice things, put them next to each other, and let the reader close the gap. the sentence-level register should match the project descriptions: lowercase, direct, says the thing and stops, no effort to impress.

what the voice does:
- follows a thread. a thought starts somewhere and sometimes ends somewhere else. that's fine. structure should look unplanned — sections don't obviously build on each other.
- stays specific. concrete details, not abstractions about abstractions. "a gray that couldn't decide if it was morning or evening" instead of "an ambiguous situation."
- admits when it doesn't know. not as a rhetorical move ("it's hard to say") — as in, the sentence genuinely doesn't land and the essay keeps going anyway. "i'm not sure what to do with that" is fine when it's honest.
- varies. some sentences short. some long and recursive and not entirely sure where they're going. the rhythm changes paragraph to paragraph. no template.

the voice never claims to have the solution or positions itself as right against everyone else. when it mentions something that might help, it does so tentatively — "what seems to work," "i'm not sure this holds" — because the honest position is that the writer is working it out too. directives ("do this," "try that") are a tell. observations are not.

not: glossary structure, correcting the reader, announcing intent, punchy standalone sentences, pretension, negative language. `scripts/lint-bold-labels.sh` catches the most mechanical pattern.

prose/ is capitalized. unfiltered/ is lowercase, rawer, more declarative — but the same underlying voice. if the two collections sound like the same writer wearing different hats, that's a tell. they should think differently, not just capitalize differently.

cross-links between essays are the connective tissue — preserve them. essay length varies; peer doesn't mean brief.

## Reference docs

Architecture, build tool principles, layout/cluster system, force layout, multi-collection architecture, and content pipeline details are in these files — read them when the task touches that area:

- `src/` — ~1,200 lines, read the source. `main.ts` is the entry point.
- `public/content/cluster/*.md` — cluster configs (constraints, not coordinates)
- `src/site-config.ts` — collection definitions
- `CONTENT.md` — thematic index of all essays. consult before re-reading individual essays.
- `TODO.md` — current work items

Key constraints worth knowing without reading the source:
- **No hardcoding in build tools.** No node IDs, cluster name strings, directory-prefix checks in `src/gen-*.ts`. Use `node.tier`, `node.tags`, `node.cluster` — never string matching.
- **Cross-collection linking is one-way:** unfiltered may link to prose. Prose must NOT link to unfiltered.
- **Content authors declare constraints, not coordinates.** Layout is solved by the algorithm.

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
