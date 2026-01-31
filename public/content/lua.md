A big pile of LuaJIT code - libraries, FFI bindings, and little CLI tools that grew over time.

## What it is

A monorepo where things get tried out:

- **lib/** - pure Lua libraries: HTTP, LSP, filesystem, DNS, Discord, Matrix, ActivityPub, game stuff, markdown, and more
- **cli/** - tools built on the libraries: a Wayland compositor, coreutils, 3D viewer, static file server
- **dep/** - FFI bindings and embedded deps: tree-sitter grammars for 100+ languages, wlroots, PulseAudio
- **world/** - game world experiments

Mostly a playground for seeing how far LuaJIT's FFI can stretch.
