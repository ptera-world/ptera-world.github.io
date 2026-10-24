/** Themed styles for every keybinds component (palette, cheatsheet, context menu, rebinding), driven by the page's tokens. */
export const KEYBINDS_CSS = `
[data-keybinds="command-palette"], [data-keybinds="cheatsheet"], [data-keybinds="settings"], [data-keybinds="context-menu"] { position: fixed; z-index: 1000; }
[data-keybinds="command-palette"]:not([open]), [data-keybinds="cheatsheet"]:not([open]), [data-keybinds="settings"]:not([open]), [data-keybinds="context-menu"]:not([open]) { display: none; }
[data-keybinds="command-palette"], [data-keybinds="cheatsheet"], [data-keybinds="settings"] { inset: 0; }
[data-keybinds="command-palette"]::part(backdrop), [data-keybinds="cheatsheet"]::part(backdrop), [data-keybinds="settings"]::part(backdrop) { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); }
[data-keybinds="command-palette"]::part(dialog), [data-keybinds="cheatsheet"]::part(dialog), [data-keybinds="settings"]::part(dialog) {
  position: fixed; left: 50%; transform: translateX(-50%);
  background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45); font: 14px var(--font);
}

[data-keybinds="command-palette"]::part(dialog) { top: 12vh; width: min(560px, calc(100vw - 24px)); max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
[data-keybinds="command-palette"]::part(input) { background: transparent; border: none; border-bottom: 1px solid var(--border); padding: 14px 16px; font: inherit; font-size: 15px; color: var(--text); outline: none; }
[data-keybinds="command-palette"]::part(list) { list-style: none; margin: 0; padding: 6px 0; overflow-y: auto; }
[data-keybinds="command-palette"]::part(item) { display: flex; align-items: center; gap: 10px; padding: 7px 16px; cursor: pointer; }
[data-keybinds="command-palette"]::part(item-active) { background: var(--accent-soft); }
[data-keybinds="command-palette"]::part(item-disabled) { opacity: 0.4; }
[data-keybinds="command-palette"]::part(item-category) { color: var(--text-dim); font-size: 12px; min-width: 6em; }
[data-keybinds="command-palette"]::part(item-label) { flex: 1; }
[data-keybinds="command-palette"]::part(item-label-match) { color: var(--accent); background: none; font-weight: 600; }
[data-keybinds="command-palette"]::part(item-keys) { display: flex; gap: 4px; }
[data-keybinds="command-palette"]::part(item-key), [data-keybinds="cheatsheet"]::part(item-key), [data-keybinds="context-menu"]::part(item-key), [data-keybinds="settings"]::part(binding-key), [data-keybinds="settings"]::part(item-key) {
  font: 12px var(--mono); padding: 1px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); color: var(--text-dim);
}
[data-keybinds="command-palette"]::part(empty) { padding: 14px 16px; color: var(--text-dim); }

[data-keybinds="cheatsheet"]::part(dialog) { bottom: 24px; display: flex; flex-wrap: wrap; gap: 20px 28px; padding: 16px 22px; max-width: calc(100vw - 24px); max-height: 70vh; overflow: auto; }
[data-keybinds="cheatsheet"]::part(group) { min-width: 160px; }
[data-keybinds="cheatsheet"]::part(group-title) { font-size: 12px; color: var(--text-dim); letter-spacing: 0.06em; margin-bottom: 6px; }
[data-keybinds="cheatsheet"]::part(list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
[data-keybinds="cheatsheet"]::part(item) { display: flex; justify-content: space-between; gap: 12px; }
[data-keybinds="cheatsheet"]::part(item-disabled) { opacity: 0.4; }
[data-keybinds="cheatsheet"]::part(item-keys), [data-keybinds="cheatsheet"]::part(item-binding) { display: flex; gap: 4px; }

[data-keybinds="context-menu"]::part(backdrop) { position: fixed; inset: 0; }
[data-keybinds="context-menu"]::part(list) { position: fixed; list-style: none; margin: 0; padding: 4px; min-width: 200px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4); font: 14px var(--font); color: var(--text); }
[data-keybinds="context-menu"]::part(item) { display: flex; justify-content: space-between; gap: 16px; padding: 6px 10px; border-radius: 5px; cursor: pointer; }
[data-keybinds="context-menu"]::part(item-active) { background: var(--accent-soft); }
[data-keybinds="context-menu"]::part(item-disabled) { opacity: 0.4; }
[data-keybinds="context-menu"]::part(item-keys) { display: flex; gap: 4px; }
[data-keybinds="context-menu"]::part(separator) { height: 1px; background: var(--border); margin: 4px 0; }

[data-keybinds="settings"]::part(dialog) { top: 6vh; width: min(640px, calc(100vw - 24px)); max-height: 88vh; overflow-y: auto; padding: 0 0 12px; }
[data-keybinds="settings"]::part(header) { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; background: var(--surface); border-bottom: 1px solid var(--border); z-index: 1; }
[data-keybinds="settings"]::part(title) { font-weight: 600; }
[data-keybinds="settings"]::part(group) { padding: 6px 18px; }
[data-keybinds="settings"]::part(group-title) { font-size: 12px; color: var(--text-dim); letter-spacing: 0.06em; margin: 10px 0 4px; }
[data-keybinds="settings"]::part(list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
[data-keybinds="settings"]::part(item) { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
[data-keybinds="settings"]::part(item-label) { flex: 1; min-width: 10em; }
[data-keybinds="settings"]::part(item-bindings) { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
[data-keybinds="settings"]::part(binding) { display: inline-flex; align-items: center; gap: 3px; padding: 2px; border-radius: 6px; }
[data-keybinds="settings"]::part(binding-keys) { display: inline-flex; gap: 3px; cursor: pointer; }
[data-keybinds="settings"]::part(binding-recording) { box-shadow: 0 0 0 2px var(--accent); }
[data-keybinds="settings"]::part(recording-overlay) { font-size: 12px; color: var(--accent); padding: 0 6px; }
[data-keybinds="settings"]::part(binding-remove), [data-keybinds="settings"]::part(item-add), [data-keybinds="settings"]::part(add-key), [data-keybinds="settings"]::part(add-mouse),
[data-keybinds="settings"]::part(item-reset), [data-keybinds="settings"]::part(reset-all), [data-keybinds="settings"]::part(conflict-accept), [data-keybinds="settings"]::part(conflict-cancel) {
  font: 12px var(--font); color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 5px; padding: 2px 8px; cursor: pointer;
}
[data-keybinds="settings"]::part(binding-remove) { padding: 0 6px; color: var(--text-dim); }
[data-keybinds="settings"]::part(recording-release), [data-keybinds="settings"]::part(binding-release) {
  font: 11px var(--font); color: var(--text-dim); background: var(--surface-2); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; cursor: pointer;
}
[data-keybinds="settings"]::part(recording-release-on), [data-keybinds="settings"]::part(binding-release-on) { color: var(--text); background: var(--accent-soft); border-color: var(--accent); }
[data-keybinds="settings"]::part(conflict) { flex-basis: 100%; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--warn); }
`;
