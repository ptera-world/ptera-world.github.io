LuaJIT sandbox — organically grown collection of libraries, FFI bindings, and CLI experiments. Quality not guaranteed; the value is in exploring API surfaces.

## What it is

A monorepo of LuaJIT code that grew over time:

- **lib/** — pure Lua libraries: HTTP, LSP, filesystem, DNS, Discord, Matrix, ActivityPub, game primitives, markdown, and more
- **cli/** — tools built on the libraries: a Wayland compositor, coreutils, 3D viewer, static file server
- **dep/** — FFI bindings and embedded dependencies: tree-sitter grammars (100+ languages), wlroots, PulseAudio
- **world/** — game world experiments

Not a polished foundation — more of a playground for trying out ideas and seeing how far LuaJIT's FFI can stretch.
