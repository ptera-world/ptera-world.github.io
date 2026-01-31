Declarative, contextual keybindings for the web. Zero dependencies. Define shortcuts as data, separate triggers from handlers.

## What it is

A framework-agnostic JavaScript library for keyboard shortcuts. Commands are plain objects with triggers, labels, context conditions, and handlers. `$mod` maps to Cmd on Mac, Ctrl elsewhere.

Features:

- **Schema-driven** — bindings are data, not imperative listeners
- **Context-aware** — commands activate based on application state
- **User-rebindable** — `BindingsStore` persists overrides to localStorage
- **Discoverable** — built-in `<command-palette>` and `<keybind-cheatsheet>` web components
