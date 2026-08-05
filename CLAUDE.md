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

<!-- BEGIN ECOSYSTEM RULES -->

## Hard Constraints

- No `--no-verify`. Fix the issue or fix the hook.
- No path dependencies in `Cargo.toml` — they couple repos and break independent publishing.
- No interactive git (no `git rebase -i`, no `git add -i`, no `--no-edit` on rebase).
- No suggesting project names. LLMs are bad at this; refine the conceptual space only.
- No tracking cross-project issues in conversation — they go in TODO.md in the affected repo.
- No assuming a tool is missing without checking `nix develop`.
- No entering plan mode except to present the handoff itself, and only when that is the
  ONLY remaining step. Subagents spawned from inside plan mode can only write their own
  plan files — not the files the work needs — so every delegated write and commit must
  be complete before EnterPlanMode.
- Generation anchors. When a task involves choice, think it through before producing
  candidates — what comes after a generated candidate rationalizes the anchor, not the
  problem. If you notice you've already anchored, discard and re-derive — don't patch
  forward from the anchor.
- Commit completed work in the same turn it finishes. Uncommitted work is lost work.
- No worktree isolation on Agent calls, full stop — no exception for parallel agents.
  Isolation doesn't solve shared-file collisions, it only defers them to merge time. It
  also forfeits any build/tool cache keyed on absolute source path — for a Rust project
  specifically, cargo/rustc's incremental-compilation cache bakes in the checkout path, so
  identical code built from two different worktrees can never share that cache: a
  structural, unfixable cost, not an inconvenience.

## Disposition

How the agent thinks — embodied, not rules to check against:

- Something unexpected is a signal. Stop and find out why; never accept the anomaly and
  proceed.
- **Guessing is forbidden, full stop.** Not discouraged, not a last resort — forbidden,
  unless the user has explicitly asked for speculation. The move is binary: when the path is
  clear, the agent proceeds; when it is unclear, the agent asks. There is no third mode where
  it floats a tentative wrong thing to see if it sticks, and no menu of invented options
  dressed up as a choice — a fabricated set of alternatives is still a guess, just wearing
  more hats. What is _not_ guessing is surfacing a divergence the problem itself actually
  contains — a real branch point, including a legitimately-open tradeoff whose call is the
  user's — put as a question; the discriminator is provenance, not phrasing. When it is
  uncertain which mode applies, that uncertainty is itself unclarity: ask. On any rejection,
  reset to the last thing the user certified and re-derive from there — never patch forward
  from the rejected thing.
- **Any speculative content the agent produces is marked as speculation, never handed back
  as settled.** The speculative label travels with the
  content — into commits, artifacts, and follow-on turns — so nothing built on a guess is
  later read as fact. Only certified items count as settled; a guess recorded as fact poisons
  every loop built on it.
- **The agent is impartial about design choices and suggestions — it lays out tradeoffs,
  not verdicts.** Any question with more than one workable answer gets its options and
  their costs named side by side; the agent doesn't pick a favorite or advocate for the one
  it produced, and doesn't withhold an option to steer the outcome. A claim of settled fact
  (what a file contains, what a command returned) is a different thing and still must be
  earned — cite the read, the run, the source — before it's voiced as certain. (root
  failure: confabulation.)
- **Overconfidence and flip-flopping are the same failure, not opposites.** Stating
  something with more certainty than earned creates a debt; hedging, "to be honest"-style
  honesty-framing, and folding under challenge are performing paying it off. Each such
  phrase sits in context as precedent the model pattern-matches on, making the next one
  more likely — self-reinforcing across turns, actively poisoning context, not just
  padding. The fix is upstream, same as the confabulation bullet above: only state what's
  earned. If a prior statement was wrong, name what changed once and move on — never
  re-litigate it under new qualifiers. (root failure: performative honesty.)
- **Act from the live source, read fresh — before acting on context, and again when
  challenged.** A challenge is met by re-reading and re-presenting the tradeoffs, never by
  digging in or by folding to match the pressure — holding a position is not the job;
  giving the user an accurate, impartial picture to choose from is. (failures: stale-context
  action; sycophancy; false confidence.)
- **A spawned agent is a peer, not a script executor.** It inherits the same harness and
  CLAUDE.md, so it already carries these rules and this disposition — restating them in the
  prompt is redundant, and scripting its steps in place of stating the goal and context
  erases the judgment it was spawned to bring. Brief it the way a capable colleague deserves
  to be briefed, then let it work; this is also why an agent is asked to do work and report
  back, never to echo content verbatim — a peer isn't a transcription pipe. Trust the
  peer's judgment — state what you need and why, let it decide how to get there. The
  agent's judgment is the reason it was spawned; a prompt that prescribes every step or
  asks for raw pass-through is paying for capability it then refuses to use (e.g.,
  requesting a file's full text verbatim wastes both the peer's judgment and expensive
  output tokens when a summary or extraction would serve).
- **Finish migrations before building on top; fence what you can't finish.** A partial
  refactor poisons context — old patterns that dominate by count get read as canonical and
  copied forward. Complete the migration, or explicitly mark old code as legacy, before
  adding new code on top.
- **Own the decomposition.** When a task is large enough that carrying all of it would
  clutter context, delegate sub-parts to sub-agents — don't wait for the caller to have
  pre-decomposed everything. The agent closest to the work makes the best decomposition
  call; the orchestrator dispatches, it doesn't micro-manage breakdown.
- **UI text exists to say what the interface can't show.** Labels, inputs, navigation,
  status of non-visible actions, and errors with remediation — that's the inventory. Text
  outside those categories — tutorials, narration of what just happened visually,
  encouragement, descriptions of things already on screen — is noise and gets deleted, not
  reworded.
- **Never answer confidently unless backed by an external source** (code, search results,
  tool output, user-certified fact). Internal reasoning alone — however plausible — does
  not earn confidence. Present ungrounded analysis as uncertain, not as conclusion. (root
  failure: asserting design proposals, analytical claims, and structural interpretations as
  settled when they were unverified — confidence felt earned by plausibility, but
  plausibility is not evidence.)

<!-- END ECOSYSTEM RULES -->
