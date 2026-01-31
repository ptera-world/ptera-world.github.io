Office Open XML library for Rust.

## What it is

A Rust library for reading and writing Office Open XML documents — the format behind `.docx`, `.xlsx`, and `.pptx` files. OOXML provides typed access to the document structure, allowing programmatic creation and manipulation of Office documents.

## What it isn't

- Not a document renderer — it reads and writes the XML structure, not visual output
- Not a spreadsheet engine — it manipulates cell data, not formulas
- Not Microsoft-specific — it works with the open OOXML standard

## Prior art

- [python-docx](https://python-docx.readthedocs.io/) — Python DOCX library
- [openpyxl](https://openpyxl.readthedocs.io/) — Python Excel library
- [docx-rs](https://github.com/bokuweb/docx-rs) — another Rust DOCX library

## Related projects

- [rescribe](/rescribe) — document conversion library that could use ooxml as a format backend
- [paraphase](/paraphase) — could route document conversions through ooxml
