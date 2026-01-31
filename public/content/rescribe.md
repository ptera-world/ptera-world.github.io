Universal document conversion library with lossless intermediate representation. Pandoc-inspired, 50+ formats, open node kinds, fidelity tracking, and roundtrip-friendly design.

## What it is

A document converter built in Rust. Rescribe converts between 50+ document formats through an IR designed to preserve as much information as possible. Unlike Pandoc's fixed Haskell ADT, rescribe's NodeKind is a string type - the schema is open-ended.

Key design choices:

- **Open node kinds** - not limited to a fixed set of document elements
- **Property bags** - key-value properties with namespaces (semantic, style, layout, format-specific like `html:class` or `latex:env`)
- **Fidelity tracking** - warnings on conversion loss, never silent
- **Embedded resources** - images, fonts, and data as first-class ResourceMap
- **Roundtrip-friendly** - source format metadata preserved

Standard nodes: document, paragraph, heading, code_block, blockquote, list, table, figure, emphasis, strong, link, image. Optional math crate adds math_inline, fraction, matrix, etc.

## Related projects

- [paraphase](/paraphase) - rescribe plugs into paraphase as a document conversion backend
- [ooxml](/ooxml) - Office Open XML library for DOCX format support
