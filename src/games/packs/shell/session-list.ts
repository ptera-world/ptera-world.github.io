import { clear, formatTime, h, style } from "../../core/dom";
import { confirmDialog } from "./dialog";
import type { SessionMeta } from "./sessions";

/** What a saved-games list needs from the page. */
export interface SessionListHost {
  savedGames(): SessionMeta[];
  readonly sessionId: string;
  openSession(id: string): boolean;
  /** Delete saved games; deleting the open one leaves it. */
  deleteSessions(ids: readonly string[]): void;
}

const CSS = `
.sl { display: flex; flex-direction: column; gap: 4px; }
.sl-tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; min-height: 32px; }
.sl-tools .grow { flex: 1; }
.sl-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.sl-row.current { border-color: var(--accent); background: var(--accent-soft); }
.sl-row .open { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; background: none; border: none; padding: 0; text-align: left; }
.sl-row .open .t { font-weight: 600; }
.sl-row .open .d { color: var(--text-dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.sl-row .time { font: 12px var(--mono); color: var(--text-dim); white-space: nowrap; }
.sl-row .time.done { color: var(--accent); }
.sl-row .trash { padding: 4px; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-dim); }
.sl-row .trash:hover { color: var(--danger); border-color: var(--danger); }
.sl-row .trash svg { width: 16px; height: 16px; }
`;

const TRASH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v5M9.2 6.5v5"/></svg>`;

const when = (ms: number): string => {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(ms).toLocaleDateString();
};

/**
 * Saved games as a vertical list: open, delete (asks first; shift+click skips asking), select
 * several to delete together, or clear them all. `filter` limits which games are shown.
 */
export function sessionList(host: SessionListHost, opts: { filter?: (m: SessionMeta) => boolean; limit?: number; tools?: boolean } = {}): HTMLElement & { refresh(): void } {
  style("session-list", CSS);
  const root = h("div", { class: "sl" });
  const picked = new Set<string>();

  const remove = async (ids: string[], ev?: MouseEvent, what = "this game") => {
    if (!ids.length) return;
    if (!ev?.shiftKey && !(await confirmDialog(`delete ${what}? this can't be undone. (shift+click skips this question)`, "delete", true))) return;
    host.deleteSessions(ids);
    for (const id of ids) picked.delete(id);
  };

  const render = () => {
    clear(root);
    const all = host.savedGames().filter(opts.filter ?? (() => true));
    const list = opts.limit ? all.slice(0, opts.limit) : all;
    if (!list.length) {
      root.append(h("p", { class: "w-dim" }, "no saved games yet."));
      return;
    }
    if (opts.tools !== false) {
      const sel = [...picked].filter((id) => all.some((m) => m.id === id));
      root.append(h("div", { class: "sl-tools" },
        h("label", { class: "w-inline" }, h("input", {
          type: "checkbox", "aria-label": "select all", checked: sel.length === all.length,
          onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) for (const m of all) picked.add(m.id); else picked.clear(); render(); },
        }), "all"),
        h("span", { class: "grow" }),
        h("button", { class: "danger", disabled: !sel.length, onclick: (e: MouseEvent) => void remove(sel, e, `${sel.length} game${sel.length === 1 ? "" : "s"}`) }, `delete selected${sel.length ? ` (${sel.length})` : ""}`),
        h("button", { class: "danger", onclick: (e: MouseEvent) => void remove(all.map((m) => m.id), e, `all ${all.length} saved games`) }, "clear all")));
    }
    for (const m of list) {
      const trash = h("button", { class: "trash", "data-tip": "delete this game (shift+click: no question)", "aria-label": `delete ${m.title}`, onclick: (e: MouseEvent) => void remove([m.id], e) });
      trash.innerHTML = TRASH;
      root.append(h("div", { class: `sl-row${m.id === host.sessionId ? " current" : ""}` },
        opts.tools !== false ? h("input", {
          type: "checkbox", "aria-label": `select ${m.title}`, checked: picked.has(m.id),
          onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) picked.add(m.id); else picked.delete(m.id); render(); },
        }) : null,
        h("button", { class: "open", onclick: () => { if (m.id !== host.sessionId) host.openSession(m.id); } },
          h("span", { class: "t" }, m.title),
          h("span", { class: "d" }, [m.detail, when(m.updatedAt)].filter(Boolean).join(" · "))),
        h("span", { class: `time${m.solved ? " done" : ""}` }, m.solved ? `solved ${formatTime(m.elapsedMs)}` : m.revealed ? "revealed" : formatTime(m.elapsedMs)),
        trash));
    }
  };
  render();
  return Object.assign(root, { refresh: render });
}
