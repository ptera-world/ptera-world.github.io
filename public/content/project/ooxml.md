---
label: "ooxml"
description: "Office Open XML library for Rust"
url: https://pterror.github.io/ooxml
status: early
tags: [rust, data, infrastructure]
---

Office Open XML library for Rust. every XML element maps to a Rust struct, unknown elements are preserved for roundtrip fidelity, and ECMA-376 is the source of truth.

## what it is

reads and writes DOCX, XLSX, and PPTX files. struct names match the spec (e.g., `Run` for `<w:r>`), and unknown XML elements get stored in catch-all fields so nothing is lost on roundtrip.

crate structure: `ooxml` for core OPC packaging, `ooxml-wml` for WordprocessingML, `ooxml-sml` for SpreadsheetML, `ooxml-pml` for PresentationML, `ooxml-dml` for DrawingML, `ooxml-omml` for Office Math, `ooxml-codegen` for generating code from the spec, and `ooxml-corpus` for fixture testing with real documents.

built with quick-xml, serde, and insta for snapshot testing.

## Related projects

- [rescribe](/project/rescribe) - document conversion library that uses ooxml for DOCX support
