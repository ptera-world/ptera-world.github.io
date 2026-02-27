# TODO

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
