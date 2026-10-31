import { h, style } from "../../core/dom";
import type { DataItem } from "../../core/types";
import type { Feedback } from "./compare";
import { exactName, matchNames } from "./names";

/**
 * Colors for feedback, as tokens a theme can set: --verdict-match (right), --verdict-near (close, or
 * a set that shares some), --verdict-miss (wrong). Defaults come from the theme's accent and warn.
 */
export const VERDICT_CSS = `
:root { --verdict-match-c: var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); --verdict-near-c: var(--verdict-near, var(--warn)); --verdict-miss-c: var(--verdict-miss, var(--surface-2)); }
/* a dataset's look sets the tokens on a board, below :root, so the colors are worked out again there */
.has-look { --verdict-match-c: var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); --verdict-near-c: var(--verdict-near, var(--warn)); --verdict-miss-c: var(--verdict-miss, var(--surface-2)); }
.v-match { background: var(--verdict-match-c); color: #fff; }
.v-close, .v-partial { background: var(--verdict-near-c); color: #000; }
.v-miss { background: var(--verdict-miss-c); color: var(--text); }
`;

export function verdictClass(f: Feedback): string {
  return `v-${f.verdict}`;
}

/** Arrow for where the answer lies from a guess. */
export function arrow(f: Feedback): string {
  return f.dir === "higher" ? "↑" : f.dir === "lower" ? "↓" : "";
}

const ENTRY_CSS = `
.name-entry { position: relative; width: 100%; max-width: 420px; }
.name-entry input { width: 100%; box-sizing: border-box; font-size: 16px; padding: 8px 10px; }
.name-entry ul { position: absolute; left: 0; right: 0; top: 100%; z-index: 30; list-style: none; margin: 2px 0 0; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; max-height: 320px; overflow-y: auto; box-shadow: 0 6px 20px rgb(0 0 0 / .25); }
.name-entry ul:empty { display: none; }
.name-entry li { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.name-entry li[aria-selected="true"] { background: var(--accent-soft, var(--surface-2)); }
.name-entry li .ne-img { width: 36px; height: 36px; flex: none; display: flex; align-items: center; justify-content: center; }
.name-entry li .ne-img img { width: 36px; height: 36px; image-rendering: pixelated; }
.name-entry li.used { opacity: .45; }
`;

export interface NameEntryOptions<T extends DataItem> {
  /** What can be named. */
  items: () => readonly T[];
  /** Called with the item picked; return false to keep the text (e.g. not allowed). */
  pick(item: T): boolean | void;
  /** Already used: shown dimmed and can't be picked. */
  used?: (item: T) => boolean;
  /** A picture for the suggestion list (e.g. a sprite). */
  icon?: (item: T) => Node | null;
  placeholder?: string;
  limit?: number;
}

export interface NameEntry {
  el: HTMLElement;
  input: HTMLInputElement;
  focus(): void;
  clear(): void;
  setDisabled(disabled: boolean): void;
}

/**
 * A text box that suggests names as you type: arrows move, Enter takes the highlighted one (or the
 * exact name typed), Escape clears, a click takes one.
 */
export function nameEntry<T extends DataItem>(o: NameEntryOptions<T>): NameEntry {
  style("name-entry", ENTRY_CSS);
  const id = `ne-${Math.random().toString(36).slice(2)}`;
  const input = h("input", {
    type: "text", placeholder: o.placeholder ?? "type a name", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    role: "combobox", "aria-autocomplete": "list", "aria-controls": id, "aria-expanded": "false",
  });
  const list = h("ul", { id, role: "listbox" });
  const el = h("div", { class: "name-entry" }, input, list);
  let shown: T[] = [];
  let sel = 0;
  const used = (it: T) => o.used?.(it) ?? false;
  const render = () => {
    list.replaceChildren(...shown.map((it, i) => {
      const li = h("li", { role: "option", "aria-selected": String(i === sel), class: used(it) ? "used" : undefined },
        o.icon ? h("span", { class: "ne-img" }, o.icon(it)) : null, h("span", null, it.name));
      li.addEventListener("pointerdown", (e) => { e.preventDefault(); take(it); });
      return li;
    }));
    input.setAttribute("aria-expanded", String(shown.length > 0));
    list.children[sel]?.scrollIntoView?.({ block: "nearest" });
  };
  const refresh = () => {
    shown = matchNames(o.items(), input.value, o.limit ?? 8);
    sel = Math.max(0, shown.findIndex((it) => !used(it)));
    render();
  };
  const take = (it: T | undefined) => {
    if (!it || used(it)) return;
    if (o.pick(it) === false) return;
    input.value = "";
    shown = [];
    render();
  };
  input.addEventListener("input", refresh);
  input.addEventListener("blur", () => { shown = []; render(); });
  input.addEventListener("focus", refresh);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      take(shown[sel] ?? exactName(o.items(), input.value));
    } else if (e.key === "Escape") {
      input.value = "";
      shown = [];
      render();
    }
  });
  return {
    el, input,
    focus: () => input.focus({ preventScroll: true }),
    clear: () => { input.value = ""; shown = []; render(); },
    setDisabled: (d) => { input.disabled = d; },
  };
}
