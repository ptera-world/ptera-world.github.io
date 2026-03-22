---
label: "motif"
description: "structural exploration of mathematics across fields"
url: https://docs.rhi.zone/motif
parent: ecosystem/rhi
status: planned
tags: [rust, data, infrastructure]
---

treats mathematics as a graph of structural relationships rather than a tree of fields. extracts invariants, detects recurring structural patterns across domains, and enables cross-field translation through shared intermediate representations.

## key ideas

- math as graph — fields are clusters in a structure graph, not branches of a tree. boundaries are historical artifacts, not structural necessities.
- layered IRs — no single "true" representation. multiple IR layers (surface DSL → structural IR → semantic core), like a compiler pipeline for mathematics.
- cross-field translation — remove artificial restrictions between disciplines. tools transfer even when formulas don't.
- structural motifs — recurring patterns (symmetry, duality, optimization, composition) are the high-degree hubs in the math graph.
- pruned search — the interesting manifold in idea-space is measure-zero. discovery is navigation, not enumeration.

## architecture

```
human math DSLs (notation, conventions, field-specific idioms)
  → structural IR (invariants, transformations, relationships)
    → semantic core (interchangeable minimal foundations)
```

each layer preserves meaning while exposing different structure. translation happens above the core. the core ensures coherence.

## Related projects

- [normalize](/project/normalize) - motif's structural extraction builds on the same tree-walking patterns normalize uses for code
- [paraphase](/project/paraphase) - motif's cross-field translation is analogous to paraphase's data reshaping
- [gels](/project/gels) - gels detects language structure; motif detects mathematical structure
