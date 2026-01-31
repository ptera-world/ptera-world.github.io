Legacy software lifting framework. Extracts and transforms applications from obsolete runtimes into modern web equivalents. Works on bytecode and scripts, not native binaries.

## What it is

A tool for extracting applications from dead runtimes and bringing them to the modern web. Targets platforms with valuable content trapped inside:

- **Flash** - ABC bytecode
- **Director** - Lingo scripts
- **VB6** - P-Code
- **Java Applets**
- **Silverlight** - .NET IL
- **HyperCard / ToolBook**
- **RPG Maker**
- **Ren'Py**
- **GameMaker**

Two-tier approach:

1. **Native patching** - hex editing, font replacement, pointer relocation for minimal changes to run on modern runtimes
2. **Runtime replacement** - hook internal draw calls, replace rendering with HTML/CSS overlay

## Key design decisions

- Lazy extraction: extract on demand, cache aggressively
- Preserve fidelity: reproduce accurately, don't redesign
- Overlay over patch: modern UI layer over original
- Both full lifts and binary patching accepted
