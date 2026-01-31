a luajit monorepo that kept growing. libraries, ffi bindings, cli experiments.

## what it is

`lib/` has pure lua stuff (http, lsp, filesystem, discord, matrix, game things, markdown and more), `cli/` has tools built on those (including a wayland compositor somehow), and `dep/` has ffi bindings to tree-sitter, wlroots, and other things.

a lot of it is just trying things out to see if they work.
