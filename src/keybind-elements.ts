import { CommandPalette, ContextMenu, KeybindCheatsheet, KeybindSettings } from "keybinds";

const classes = {
  "command-palette": CommandPalette,
  "keybind-cheatsheet": KeybindCheatsheet,
  "context-menu": ContextMenu,
  "keybind-settings": KeybindSettings,
};
type Kind = keyof typeof classes;

const names = new Map<Kind, string>();

/**
 * A keybinds element built from this bundle's copy of the library. A custom element name stays bound
 * to the first class defined for it, so each bundle copy (a page script imported again after a
 * deploy) defines its own name: `kind` when free, else `kind-2`, `kind-3`, ... The element carries
 * `kind` as a class; styles select it by that class, never by tag name.
 */
export function keybindElement<K extends Kind>(kind: K): InstanceType<(typeof classes)[K]> {
  let name = names.get(kind);
  if (!name) {
    name = kind;
    for (let n = 2; customElements.get(name); n++) name = `${kind}-${n}`;
    customElements.define(name, class extends (classes[kind] as typeof HTMLElement) {});
    names.set(kind, name);
  }
  const el = document.createElement(name) as InstanceType<(typeof classes)[K]>;
  el.classList.add(kind);
  return el;
}
