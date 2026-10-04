/** Themed styles for every keybinds component (palette, cheatsheet, context menu, rebinding), driven by the page's tokens. */
export const KEYBINDS_CSS = `
command-palette, keybind-cheatsheet, keybind-settings, context-menu { position: fixed; z-index: 1000; }
command-palette:not([open]), keybind-cheatsheet:not([open]), keybind-settings:not([open]), context-menu:not([open]) { display: none; }
command-palette, keybind-cheatsheet, keybind-settings { inset: 0; }
command-palette::part(backdrop), keybind-cheatsheet::part(backdrop), keybind-settings::part(backdrop) { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); }
command-palette::part(dialog), keybind-cheatsheet::part(dialog), keybind-settings::part(dialog) {
  position: fixed; left: 50%; transform: translateX(-50%);
  background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45); font: 14px var(--font);
}

command-palette::part(dialog) { top: 12vh; width: min(560px, calc(100vw - 24px)); max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
command-palette::part(input) { background: transparent; border: none; border-bottom: 1px solid var(--border); padding: 14px 16px; font: inherit; font-size: 15px; color: var(--text); outline: none; }
command-palette::part(list) { list-style: none; margin: 0; padding: 6px 0; overflow-y: auto; }
command-palette::part(item) { display: flex; align-items: center; gap: 10px; padding: 7px 16px; cursor: pointer; }
command-palette::part(item-active) { background: var(--accent-soft); }
command-palette::part(item-disabled) { opacity: 0.4; }
command-palette::part(item-category) { color: var(--text-dim); font-size: 12px; min-width: 6em; }
command-palette::part(item-label) { flex: 1; }
command-palette::part(item-label-match) { color: var(--accent); font-weight: 600; }
command-palette::part(item-keys) { display: flex; gap: 4px; }
command-palette::part(item-key), keybind-cheatsheet::part(item-key), context-menu::part(item-key), keybind-settings::part(binding-key), keybind-settings::part(item-key) {
  font: 12px var(--mono); padding: 1px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); color: var(--text-dim);
}
command-palette::part(empty) { padding: 14px 16px; color: var(--text-dim); }

keybind-cheatsheet::part(dialog) { bottom: 24px; display: flex; flex-wrap: wrap; gap: 20px 28px; padding: 16px 22px; max-width: calc(100vw - 24px); max-height: 70vh; overflow: auto; }
keybind-cheatsheet::part(group) { min-width: 160px; }
keybind-cheatsheet::part(group-title) { font-size: 12px; color: var(--text-dim); letter-spacing: 0.06em; margin-bottom: 6px; }
keybind-cheatsheet::part(list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
keybind-cheatsheet::part(item) { display: flex; justify-content: space-between; gap: 12px; }
keybind-cheatsheet::part(item-disabled) { opacity: 0.4; }
keybind-cheatsheet::part(item-keys), keybind-cheatsheet::part(item-binding) { display: flex; gap: 4px; }

context-menu::part(backdrop) { position: fixed; inset: 0; }
context-menu::part(list) { position: fixed; list-style: none; margin: 0; padding: 4px; min-width: 200px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4); font: 14px var(--font); color: var(--text); }
context-menu::part(item) { display: flex; justify-content: space-between; gap: 16px; padding: 6px 10px; border-radius: 5px; cursor: pointer; }
context-menu::part(item-active) { background: var(--accent-soft); }
context-menu::part(item-disabled) { opacity: 0.4; }
context-menu::part(item-keys) { display: flex; gap: 4px; }
context-menu::part(separator) { height: 1px; background: var(--border); margin: 4px 0; }

keybind-settings::part(dialog) { top: 6vh; width: min(640px, calc(100vw - 24px)); max-height: 88vh; overflow-y: auto; padding: 0 0 12px; }
keybind-settings::part(header) { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; background: var(--surface); border-bottom: 1px solid var(--border); z-index: 1; }
keybind-settings::part(title) { font-weight: 600; }
keybind-settings::part(group) { padding: 6px 18px; }
keybind-settings::part(group-title) { font-size: 12px; color: var(--text-dim); letter-spacing: 0.06em; margin: 10px 0 4px; }
keybind-settings::part(list) { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
keybind-settings::part(item) { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
keybind-settings::part(item-label) { flex: 1; min-width: 10em; }
keybind-settings::part(item-bindings) { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
keybind-settings::part(binding) { display: inline-flex; align-items: center; gap: 3px; padding: 2px; border-radius: 6px; }
keybind-settings::part(binding-keys) { display: inline-flex; gap: 3px; cursor: pointer; }
keybind-settings::part(binding-recording) { box-shadow: 0 0 0 2px var(--accent); }
keybind-settings::part(recording-overlay) { font-size: 12px; color: var(--accent); padding: 0 6px; }
keybind-settings::part(binding-remove), keybind-settings::part(item-add), keybind-settings::part(add-key), keybind-settings::part(add-mouse),
keybind-settings::part(item-reset), keybind-settings::part(reset-all), keybind-settings::part(conflict-accept), keybind-settings::part(conflict-cancel) {
  font: 12px var(--font); color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 5px; padding: 2px 8px; cursor: pointer;
}
keybind-settings::part(binding-remove) { padding: 0 6px; color: var(--text-dim); }
keybind-settings::part(conflict) { flex-basis: 100%; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--warn); }
`;
