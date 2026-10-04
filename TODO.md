# TODO

## Unfiltered content — potential essays
- [x] **housing** — folded into the-gate as "shelter" section
- [x] **extremism** → written as the-loop: the mechanism by which belief systems feed on their own resistance. no specific religions named
- [ ] **voice: questions vs statements** — main site uses rhetorical question headers (forces thinking, aids retention). unfiltered uses statements (forces recognition). headers should stay as statements. but body text could lean harder into unanswerable inline questions — not as technique, as honesty. places where the essay hits a wall and admits it. audit existing essays for opportunities

- [x] **force layout on grouping filters** — investigated: unfiltered has 0 groupings so issue can't manifest there. On default collection, switching groupings while filters are active skips force layout re-run (low priority edge case)
- [x] **main site introspective tags** — added `introspective` tag to 5 prose essays (the-great-deceit, this-site-is-manipulative, this-is-not-a-personal-website, this-site-is-designed, this-is-not-all) + tagColors on essays and meta-essays clusters

- [x] Add favicon / icon — SVG graph motif, linked in all entry points + generated content pages
- [x] Fix layout (broken by content-agnostic refactor) — resolved by layout engine rewrite
- [ ] `visible-at` constraint should not assume 1920×1080 — support multiple common viewport sizes or a range
- [x] Replace `center:` absolute coordinates in cluster YAMLs with relative constraints — already done, no clusters use `center:`
- [x] Implement force layout adaptive feedback loop: `runForceLayoutAdaptive` — 6 attempts, 4 quality axes, directional param adjustments
- [x] Wire essays cluster back to force layout via adaptive loop — essays use `layout: force` + `groupingPlacement: free`, force sim runs at step 6
- [ ] Implement dynamic layout: runtime viewport adaptation within tight bounds of build-time solution
- [x] Landing element overlap: runtime nudge after `document.fonts.ready` — measures landing bounding box, converts to world coordinates, pushes overlapping nodes radially outward
- [ ] Multiple meta nodes: currently all placed at (0,0) and camera picks the first one — define primary/secondary semantics, layout rules for multiple meta nodes, and camera centroid behavior
- [x] Concentric ring layout for large clusters — auto-splits into inner/outer rings when >10 items, with staggered placement

## Living graph — the graph as reading surface

The graph should be the primary way to experience the content. Essays are one format; fragments (short, graph-native thoughts) are another. The reading experience is spatial exploration, not linear consumption.

### Runtime behavior (all configurable, opinionated defaults)
- [x] **Dynamic layout on focus** — `src/focus-layout.ts`: animated force simulation via rAF, 2-hop neighborhood, gravity toward focused node. Collision-radius-aware repulsion. Smooth CSS translate transition on snap-back
- [x] **Neighborhood visibility** — `data-neighborhood="distant"` fades non-neighbors. Enabled via `?neighborhoodFocus=true`
- [x] **Text on canvas** — CSS for readable descriptions at near zoom. Enabled via `?textOnCanvas=true`. Currently uses frontmatter descriptions; richer content when fragments grow
- [x] **All behaviors configurable** — `src/settings.ts` with URL param loading. Settings: dynamicLayout, neighborhoodFocus, focusHighlight, edgesVisible, cardEnabled, nodeGrowth, textOnCanvas
- [x] **Hyperlink nodes** — portal nodes in `public/content/portal/` with `url:` fields that navigate to other collections on second click (first click shows card)
- [x] **Visual testing** — code review found and fixed 5 issues: undefined `stop()` crash on unfocus, text-on-canvas scale inverted at near zoom (0.45→0.85), `.node.project` class never assigned (tier visibility broken), neighborhood fading coupled to dynamic layout (now independent), neighborhood+filtered CSS interaction

### Content
- [x] **Fragment content type** — `public/content/cluster/fragments.md` + 55 fragments. Text-based rendering (no dot), `collisionRadius` from text dimensions, `.node.fragment` class. Clickable text hit target
- [x] **Fragment extraction** — 30 atomic ideas extracted from essay redundancy (documented in FRAGMENTS.md)
- [ ] **Essays as secondary format** — still linkable, still refined, but secondary to the graph. Could eventually be assembled dynamically from fragments based on view history (stored in query params)
- [x] **`/prose/` entrypoint** — essays at their own entrypoint (`/prose/`), freeing the default graph to be fragment-native
- [x] **New fragments** — 8 native fragments (explaining-changes-the-thing, maintenance-is-invisible, defaults-are-opinions, first-version-is-the-tool, thing-you-keep-circling, measuring-changes-what-gets-made, repetition-isnt-redundancy, legibility-is-the-bottleneck)
- [x] **Question fragments** — 8 question fragments with no body text, only edges. The neighborhood is the answer
- [ ] **More native fragments** — continue writing graph-shaped content

### Taste collection
- [ ] **taste collection has no content yet** — scaffolded (`site-config.ts`, `public/taste/index.html`, `public/content/meta/taste.md`) but zero essays/nodes. Write the first pieces — personal, subjective takes on programs/software — in the lowercase, casual register (closer to unfiltered/ than prose/). Add a `public/content/cluster/taste-essays.md` cluster config once there's real content to derive `tagColors` from — the loader tolerates a missing cluster file (empty member sets are skipped), so there was nothing to seed with placeholder tags yet.

### Intelligence collection
- [ ] **intelligence collection has no content yet** — scaffolded (`site-config.ts`, `public/intelligence/index.html`, `public/content/meta/intelligence.md`) but zero essays/nodes. Write the first pieces on AGI once there's real content. Add a `public/content/cluster/intelligence-essays.md` cluster config once there's real content to derive `tagColors` from — the loader tolerates a missing cluster file (empty member sets are skipped), so there was nothing to seed with placeholder tags yet.

### Ongoing
- [ ] **Adversarial AI writing audits** — continue "prove this is AI-written" audits (like TELLS.md). Lower priority if essays become secondary or move to another entrypoint, but still valuable for the essay format
- [ ] **Tell 9** — future essays should emerge from specific, strange observations rather than addressing universal questions. A human writer notices something particular and works outward — not inward from a category
- [ ] **Remaining subtle tells (5a-g, 6a-b)** — paragraph rhythm homogeneity, metaphor uniformity, composed uncertainty, emotional register flatness, absence of disfluency, same voice across collections. 8 essays rewritten this session; ~60 remain. The voice section in CLAUDE.md now encodes the target positively. Consider handing rewrites to an agent with a curated voice rather than fighting Claude's defaults.
- [x] **Third adversarial audit** — completed 2026-03-23. Mechanical fixes landed well (genuinely eliminated, bold labels gone, See also 82%→26%, question headers 47%→23%). Subtle tells persist in ~60 non-rewritten essays (avg 1.54/3). Section count uniformity is now the #1 structural tell (89.5% in 5-8 range, worse than before). Three new tells found (9-11): cross-link density, explanatory parenthetical, second-person confrontation close. See TELLS.md.

## Games (`/games/`, `src/games/`)

Primitives (see `src/games/core/types.ts`): Technique, CommandDef, WidgetDef, Theme, packs. New behaviour should come from these, not one-off features.

### Decisions waiting on you
- [ ] **net right-click**: keep right-click = turn anticlockwise (Simon Tatham's convention; the board declares `gestures.secondaryClick` and the how-to card adapts) vs right-click = board menu (same everywhere). Currently: menu
- [ ] **undo after solving**: the solved mark and time stay after undoing (and after unlocking + changing the board). Left as is on request
- [ ] **restart timing**: `restart()` zeroes the timer and clears solved; undoing a restart restores the board but not the old time. Chosen without input

### Bigger ideas (designed for, not built)
- [ ] **puzzlescript-style engine**: puzzles described as data/rules. Would be a pack that turns a description into a PuzzleDef (+ techniques from rule-level deductions); nothing in core blocks it
- [ ] **collaboration (maybe, not mandatory)**: shared games (CRDTs such as yjs, presence/awareness). Where it would plug in: every change is an action with a source, and history already exports exact per-step patches, so a sync layer can sit on dispatch/patches without touching packs. Open questions: transport (WebRTC alone isn't enough, needs signalling/relay), and who owns game rules (auto-apply, timer, undo); a host-authoritative session with per-player permissions is the likely shape
- [ ] **several games on screen at once**: games no longer share global state, but the shell renders one session/board. Needs the shell to own N sessions + per-board command scopes
- [ ] **more puzzles**: rest of Simon Tatham's collection (fifteen, …), numberlink / flow. Each is a pack directory
- [ ] **layout presets** beyond zen (named, shareable placements)
- [ ] **hold-to-show keys** (e.g. labels while held): commands are press-only; needs keydown/keyup pairs in CommandDef
- [ ] **multi-file third-party packs**: a url pack runs from its stored copy, so it can't import sibling files. Bundle step or import maps
- [ ] **tag vocabulary**: tags were picked per pack without a shared list; normalise
- [ ] **pointer gestures as commands**: mouse bindings fire on mousedown only, so drags and press/release stay inside views
- [ ] **device-conditioned settings** (touch-only options show on desktop)
- [ ] **shared "something completed" effect** (a line, box, cage), and hint focus that reaches margins (clues outside the grid)

### Core / shell
- [ ] **Cross-field param validation** — schemas only have `when` (visibility). Add a way for one field to constrain another (e.g. net: wrapping needs every side ≥ 3) so the form blocks impossible combos instead of failing at generate time
- [ ] **Generation off the main thread** — generators yield between steps, but a single long solve still blocks (loopy 20×20 hard ≈ 12s, 30×30 tricky ≈ 18s). Run `generate` in a Worker; puzzle defs are already pure + deterministic
- [ ] **Linking from the main site** — `/games/` is reachable only by URL; no portal node / nav link yet
- [ ] **Stats / best times** per puzzle + params (the results strip already has the data per game)
- [ ] **layout shift on load**: the board area moves once from where "generating…" sat (`?debugLayout` shows it)

### sudoku pack (also keen / towers / unequal)
- [ ] Grids larger than 9×9 (needs letter digits)
- [ ] More variants: sandwich, palindrome, between lines, even/odd, extra regions
- [ ] Unique-rectangle and BUG techniques in the human solver
- [ ] Import SudokuPad's native format and SGT game ids
- [ ] **Verify f-puzzles import field names against a real f-puzzles link** — written from memory; "diagonal+" → anti-diagonal mapping is a guess
- [ ] Kropki "all dots given" (negative constraint) option
- [ ] Density setting for line clues (thermo / arrow / whisper / renban)
- [ ] Hints that use centre marks once they're complete (currently ignored as possibly-partial notes)

### mines / lightup / pattern
- [ ] mines: "?" marks, both-button chording, mine-probability overlay for imported boards that need guessing
- [ ] mines: optional "generate on first click" mode (conflicts with same-seed-same-board, so it'd need to be explicit)
- [ ] lightup: puzz.link akari format, dark-cells-remaining counter, harder techniques (pair trials, "both branches agree"), keep wall symmetry when uniqueness repair adds walls
- [ ] pattern: third difficulty tier, colour nonograms, puzz.link + webpbn formats, check-my-marks mode, safer auto-cross

### net / loopy / bridges
- [ ] net: auto-lock assist (skipped: can silently solve most of the board), live wrong-lock display, hex net
- [ ] loopy: generation speed on big hard grids, manual inside/outside cell shading, penrose + hat tilings, "both branches agree" step in hard tier
- [ ] **loopy: verify SGT ids for non-triangle tilings and pzprv3 import against real files** — only triangles checked against SGT's examples
- [ ] bridges: islands without a number, dead-end assist
- [ ] nonogram: keyboard way into the clue "where can this block go" hover
