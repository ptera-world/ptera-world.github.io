---
label: "rescribe"
description: "converts documents without losing anything"
url: https://docs.rhi.zone/rescribe
parent: ecosystem/rhi
status: fleshed-out
tags: [rust, data, infrastructure]
---

universal document converter with a lossless intermediate representation. 50+ formats, open node kinds, fidelity tracking, and roundtrip-friendly design.

## what it is

a Rust library that converts between document formats through an IR designed to preserve as much as possible. unlike Pandoc's fixed ADT, rescribe's node kinds are open-ended strings, so nothing gets forced into a predefined schema.

nodes carry property bags with namespaces (semantic, style, layout, format-specific like `html:class` or `latex:env`), conversion loss is tracked and warned about (never silent), and embedded resources (images, fonts, data) are first-class. source format metadata is preserved for roundtripping.

standard nodes cover the usual things (paragraphs, headings, code blocks, lists, tables, etc.) and an optional math crate adds math_inline, fractions, matrices, and so on.

## Related projects

- [paraphase](/project/paraphase) - rescribe plugs into paraphase as a document conversion backend
- [ooxml](/project/ooxml) - Office Open XML library for DOCX format support
