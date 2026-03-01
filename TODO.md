# TODO

## Unfiltered content — potential essays
- [x] **housing** — folded into the-gate as "shelter" section
- [x] **extremism** → written as the-loop: the mechanism by which belief systems feed on their own resistance. no specific religions named
- [ ] **voice: questions vs statements** — main site uses rhetorical question headers (forces thinking, aids retention). unfiltered uses statements (forces recognition). headers should stay as statements. but body text could lean harder into unanswerable inline questions — not as technique, as honesty. places where the essay hits a wall and admits it. audit existing essays for opportunities

- [ ] Add favicon / icon
- [ ] Fix layout (broken by content-agnostic refactor)
- [ ] `visible-at` constraint should not assume 1920×1080 — support multiple common viewport sizes or a range
- [ ] Replace `center:` absolute coordinates in cluster YAMLs with relative constraints (`near:`, `below:`, etc.)
- [ ] Implement force layout adaptive feedback loop: derive params from geometry, run, measure 4 quality metrics (overlap, spread, edge satisfaction, clustering), adjust and re-run
- [ ] Wire essays cluster back to force layout via adaptive loop (currently dead code path)
- [ ] Implement dynamic layout: runtime viewport adaptation within tight bounds of build-time solution
- [ ] Landing element overlap: measure the landing element's bounding box at startup (after fonts load), convert to world coordinates at current zoom, nudge overlapping nodes away — can't be solved at build time since element size depends on CSS/fonts/zoom
- [ ] Multiple meta nodes: currently all placed at (0,0) and camera picks the first one — define primary/secondary semantics, layout rules for multiple meta nodes, and camera centroid behavior
- [ ] Concentric ring layout for large clusters (rhi with 19 children, essays with 42 nodes) — inner/outer rings instead of one huge ring with empty center
