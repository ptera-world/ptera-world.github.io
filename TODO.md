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
- [x] **Dynamic layout on focus** — `src/focus-layout.ts`: animated force simulation via rAF, 2-hop neighborhood, focused node pins. Wired into input.ts via onFocusChange callback
- [x] **Neighborhood visibility** — `data-neighborhood="distant"` fades non-neighbors. Enabled via `?neighborhoodFocus=true`
- [x] **Text on canvas** — CSS for readable descriptions at near zoom. Enabled via `?textOnCanvas=true`. Currently uses frontmatter descriptions; richer content when fragments grow
- [x] **All behaviors configurable** — `src/settings.ts` with URL param loading. Settings: dynamicLayout, neighborhoodFocus, focusHighlight, edgesVisible, cardEnabled, nodeGrowth, textOnCanvas
- [x] **Hyperlink nodes** — portal nodes in `public/content/portal/` with `url:` fields that navigate to other collections on second click (first click shows card)
- [ ] **Visual testing** — the dynamic layout + neighborhood features are wired but need real-world testing and parameter tuning

### Content
- [x] **Fragment content type** — `public/content/cluster/fragments.md` + 33 fragments in `public/content/fragments/`. Dense cross-links. Zero code changes needed.
- [x] **Fragment extraction** — 30 atomic ideas extracted from essay redundancy (documented in FRAGMENTS.md)
- [ ] **Essays as secondary format** — still linkable, still refined, but secondary to the graph. Could eventually be assembled dynamically from fragments based on view history (stored in query params)
- [x] **`/prose/` entrypoint** — essays at their own entrypoint (`/prose/`), freeing the default graph to be fragment-native
- [x] **New fragments** — 8 native fragments (explaining-changes-the-thing, maintenance-is-invisible, defaults-are-opinions, first-version-is-the-tool, thing-you-keep-circling, measuring-changes-what-gets-made, repetition-isnt-redundancy, legibility-is-the-bottleneck)
- [ ] **More native fragments** — continue writing graph-shaped content

### Ongoing
- [ ] **Adversarial AI writing audits** — continue "prove this is AI-written" audits (like TELLS.md). Lower priority if essays become secondary or move to another entrypoint, but still valuable for the essay format
- [ ] **Tell 9** — future essays should emerge from specific, strange observations rather than addressing universal questions. A human writer notices something particular and works outward — not inward from a category
