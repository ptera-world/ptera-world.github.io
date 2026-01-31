Universal document conversion library with lossless intermediate representation.

## What it is

A pandoc-inspired document converter built in Rust. Rescribe converts between document formats through an intermediate representation designed to preserve as much information as possible across conversions.

Key design choices:

- **Open node kinds** — the IR isn't limited to a fixed set of document elements
- **Fidelity tracking** — each conversion reports what was preserved and what was lost
- **Embedded resources** — images and other assets are handled as first-class citizens
- **Roundtrip-friendly** — format-specific metadata is preserved for roundtrip conversion

## What it isn't

- Not a text-only converter — it handles rich documents with embedded media
- Not lossy by design — fidelity tracking makes information loss explicit
- Not a markup language — the IR is a data structure, not a syntax

## Prior art

- [pandoc](https://pandoc.org/) — the original universal document converter
- [unified](https://unifiedjs.com/) — AST-based content transformation in JS
- [docx-rs](https://github.com/bokuweb/docx-rs) — DOCX manipulation in Rust

## Related projects

- [paraphase](/paraphase) — rescribe plugs into paraphase as a document conversion backend
- [ooxml](/ooxml) — Office Open XML library that could serve as a rescribe format plugin
