# TODO

## Unfiltered content — potential essays
- [x] **housing** — folded into the-gate as "shelter" section
- [x] **extremism** → written as the-loop: the mechanism by which belief systems feed on their own resistance. no specific religions named
- [ ] **voice: questions vs statements** — main site uses rhetorical question headers (forces thinking, aids retention). unfiltered uses statements (forces recognition). headers should stay as statements. but body text could lean harder into unanswerable inline questions — not as technique, as honesty. places where the essay hits a wall and admits it. audit existing essays for opportunities

- [x] **force layout on grouping filters** — investigated: unfiltered has 0 groupings so issue can't manifest there. On default collection, switching groupings while filters are active skips force layout re-run (low priority edge case)
- [x] **main site introspective tags** — added `introspective` tag to 5 prose essays (the-great-deceit, this-site-is-manipulative, this-is-not-a-personal-website, this-site-is-designed, this-is-not-all) + tagColors on essays and meta-essays clusters

- [ ] Add favicon / icon
- [x] Fix layout (broken by content-agnostic refactor) — resolved by layout engine rewrite
- [ ] `visible-at` constraint should not assume 1920×1080 — support multiple common viewport sizes or a range
- [ ] Replace `center:` absolute coordinates in cluster YAMLs with relative constraints (`near:`, `below:`, etc.)
- [ ] Implement force layout adaptive feedback loop: derive params from geometry, run, measure 4 quality metrics (overlap, spread, edge satisfaction, clustering), adjust and re-run
- [ ] Wire essays cluster back to force layout via adaptive loop (currently dead code path)
- [ ] Implement dynamic layout: runtime viewport adaptation within tight bounds of build-time solution
- [ ] Landing element overlap: measure the landing element's bounding box at startup (after fonts load), convert to world coordinates at current zoom, nudge overlapping nodes away — can't be solved at build time since element size depends on CSS/fonts/zoom
- [ ] Multiple meta nodes: currently all placed at (0,0) and camera picks the first one — define primary/secondary semantics, layout rules for multiple meta nodes, and camera centroid behavior
- [ ] Concentric ring layout for large clusters (rhi with 19 children, essays with 42 nodes) — inner/outer rings instead of one huge ring with empty center

## Living graph — the graph as reading surface

The graph should be the primary way to experience the content. Essays are one format; fragments (short, graph-native thoughts) are another. The reading experience is spatial exploration, not linear consumption.

### Runtime behavior (all configurable, opinionated defaults)
- [ ] **Dynamic layout on focus** — force layout runs continuously via rAF, reorganizes neighborhood around focused node. Focused node pins in place, neighbors pull closer, distant nodes drift. Already have `runLayout` in `layout.ts` and filter-triggered force layout; extend to focus-triggered
- [ ] **Neighborhood visibility** — only show local N-hop neighborhood around focus. Nodes beyond range fade/disappear. Fixes mobile UX (rendering cost proportional to what you're looking at)
- [ ] **Text on canvas** — node descriptions render directly on canvas at appropriate zoom level, not behind panel clicks
- [ ] **All behaviors configurable** — `src/settings.ts` created. Dynamic layout, neighborhood focus, edge rendering, focus highlighting, card intermediate state, node growth — each toggleable via URL params. Everything in `this-site-is-designed.md` can be disabled
- [ ] **Hyperlink nodes** — nodes that are just links to other entrypoints (e.g. `/` ↔ `/prose/` ↔ `/unfiltered/`), enabling cross-collection navigation on the graph itself

### Content
- [ ] **Fragment content type** — new first-class content alongside essays. Short, graph-native, written as fragments from the start. Edges are the scaffolding, not essay structure
- [ ] **Essays as secondary format** — still linkable, still refined, but secondary to the graph. Could eventually be assembled dynamically from fragments based on view history (stored in query params)
- [ ] **Essays could move to a separate entrypoint** — freeing the main graph to be fragment-native

### Ongoing
- [ ] **Adversarial AI writing audits** — continue "prove this is AI-written" audits (like TELLS.md). Lower priority if essays become secondary or move to another entrypoint, but still valuable for the essay format
- [ ] **Tell 9** — future essays should emerge from specific, strange observations rather than addressing universal questions. A human writer notices something particular and works outward — not inward from a category
