Office Open XML library for Rust. Typed-over-stringly approach: every XML element has a Rust struct. Preserves unknown elements for roundtrip fidelity. Spec-driven - ECMA-376 is source of truth.

## What it is

A Rust library for reading and writing DOCX, XLSX, and PPTX files. Struct names match ECMA-376 element names (e.g., `Run` for `<w:r>`). Unknown XML elements and attributes are stored in catch-all fields for roundtrip preservation.

Crate structure:

- **ooxml** (ooxml-opc) - core OPC packaging, ZIP read/write, relationships
- **ooxml-wml** - WordprocessingML (DOCX): body, paragraphs, runs, formatting, styles, tables, images
- **ooxml-sml** - SpreadsheetML (XLSX)
- **ooxml-pml** - PresentationML (PPTX)
- **ooxml-dml** - DrawingML (shared shapes/graphics)
- **ooxml-omml** - Office Math Markup Language
- **ooxml-codegen** - code generation from ECMA-376 specs
- **ooxml-corpus** - fixture testing with real documents

Built with quick-xml, serde, and insta for snapshot testing.

## Related projects

- [rescribe](/rescribe) - document conversion library that uses ooxml for DOCX support
