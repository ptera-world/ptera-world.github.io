keyboard shortcuts for the web, defined as data instead of imperative listeners.

## what it is

you describe your keybindings as plain objects (keys, labels, context, handler) and keybinds takes care of matching and dispatching. users can rebind things and it persists to localStorage.

comes with four web components — `<command-palette>`, `<keybind-cheatsheet>`, `<context-menu>`, and `<keybind-settings>` — and works with any framework or none.
