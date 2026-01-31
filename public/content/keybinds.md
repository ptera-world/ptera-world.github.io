keyboard shortcuts for the web, defined as data instead of imperative listeners.

## what it is

you describe your keybindings as plain objects (keys, labels, context, handler) and keybinds takes care of matching and dispatching. users can rebind things and it persists to localStorage.

comes with `<command-palette>` and `<keybind-cheatsheet>` web components if you want discoverability, and works with any framework or none.
