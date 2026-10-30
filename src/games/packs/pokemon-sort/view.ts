import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, inputIs, style } from "../../core/dom";
import type { CommandDef, View } from "../../core/types";
import { VERDICT_CSS } from "../../lib/dataset/ui";
import { sprite } from "../../lib/pokemon/ui";
import { isOver, isSolved, markOf, moveFree, pinned, type SortAction, type SortGame, type SortPuzzle, type SortState } from "./logic";

/** Marks of a fresh try appear one after another, this far apart. */
const STAGGER_MS = 110;

const CSS = `
.ps-root { width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; user-select: none; -webkit-user-select: none; }
.ps-end { display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 13px; padding: 0 4px; }
.ps-end strong { color: var(--text); font-weight: 600; }
.ps-head { padding-right: 40px; min-height: 34px; }
.ps-list { position: relative; flex: 1; min-height: 0; }
.ps-row { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 4px; box-sizing: border-box; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); transition: top .16s ease; touch-action: none; cursor: grab; }
.ps-row.pinned { cursor: default; border-color: var(--verdict-match-c); background: color-mix(in srgb, var(--verdict-match-c) 14%, var(--surface)); }
.ps-row.lifted { transition: none; z-index: 3; cursor: grabbing; box-shadow: 0 8px 22px rgb(0 0 0 / .3); }
.ps-row.cursor { outline: 2px solid var(--focus); outline-offset: 1px; }
${inputIs("pointer")} .ps-row.cursor:not(.lifted) { outline: none; }
.ps-row.held { outline-style: dashed; }
.ps-pos { width: 18px; text-align: right; color: var(--text-dim); font-size: 12px; font-variant-numeric: tabular-nums; flex: none; }
.ps-row .pk-sprite { flex: none; }
.ps-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-val { color: var(--text-dim); font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ps-mark { flex: none; min-width: 34px; height: 26px; padding: 0 6px; box-sizing: border-box; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; }
.ps-mark[hidden] { display: none; }
.ps-mark.stale { opacity: .45; }
.ps-mark.fresh { animation: ps-flip .32s ease both; }
@keyframes ps-flip { from { transform: rotateX(90deg); } to { transform: none; } }
.ps-mark.right { background: var(--verdict-match-c); color: #fff; }
.ps-mark.near { background: var(--verdict-near-c); color: #000; }
.ps-mark.far { background: var(--verdict-miss-c); color: var(--text); }
.ps-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ps-foot button.ps-submit { padding: 6px 18px; font-size: 15px; }
.ps-grid { display: flex; gap: 6px; margin-left: auto; }
.ps-grid .col { display: flex; flex-direction: column; gap: 2px; }
.ps-grid i { display: block; width: 9px; height: 9px; border-radius: 2px; }
.ps-grid i.right { background: var(--verdict-match-c); }
.ps-grid i.near { background: var(--verdict-near-c); }
.ps-grid i.far { background: var(--verdict-miss-c); border: 1px solid var(--border); box-sizing: border-box; }
`;

const BINDINGS = {
  "pokemon-sort.submit": { label: "submit this order", category: "sort", keys: ["Enter"] },
  "pokemon-sort.up": { label: "cursor up (moves a picked-up pokémon)", category: "sort", keys: ["ArrowUp", "w", "k"], hidden: true },
  "pokemon-sort.down": { label: "cursor down (moves a picked-up pokémon)", category: "sort", keys: ["ArrowDown", "s", "j"], hidden: true },
  "pokemon-sort.grab": { label: "pick up or put down the pokémon at the cursor", category: "sort", keys: ["space"], hidden: true },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const MARK_SAMPLE = (cls: string, text: string) => `<span class="ps-mark ${cls}" style="font-size:11px;min-width:24px;height:20px">${text}</span>`;

export function sortView(game: SortGame): View<SortPuzzle, SortState, SortAction, null> {
  return {
    id: "pokemon-sort.list",
    name: "list",
    puzzle: game.def,
    controls: [
      { how: "drag a pokémon up or down", what: "move it; the others make room" },
      { how: "↑ ↓ then space, ↑ ↓, space", what: "pick one up, move it, put it down" },
      { how: "submit, or Enter", what: "mark this order (uses a try)" },
    ],
    legend: (p) => [
      { sample: MARK_SAMPLE("right", "✓"), meaning: "in the right place; it stays put" },
      ...(p.feedback === "place" ? [{ sample: MARK_SAMPLE("far", "✗"), meaning: "not in the right place" }]
        : p.feedback === "exact" ? [{ sample: MARK_SAMPLE("far", "↓2"), meaning: "belongs that many places lower (↓) or higher (↑)" }]
        : [
          { sample: MARK_SAMPLE("far", "↓"), meaning: "belongs lower down (↓) or higher up (↑)" },
          ...(p.feedback === "near" ? [{ sample: MARK_SAMPLE("near", "↑"), meaning: "just one place off" }] : []),
        ]),
      { sample: MARK_SAMPLE("far stale", "↑"), meaning: "faded: it has moved since it was marked" },
    ],
    mount(root, { session }) {
      style("verdict", VERDICT_CSS);
      style("pokemon-sort", CSS);
      const p = session.puzzle;
      const N = p.ids.length;
      const attr = game.label(p.attr);
      const head = h("div", { class: "ps-end ps-head" }, h("strong", null, `${p.high ? "highest" : "lowest"} ${attr}`));
      const tail = h("div", { class: "ps-end" }, h("strong", null, `${p.high ? "lowest" : "highest"} ${attr}`));
      const list = h("div", { class: "ps-list", role: "listbox", "aria-label": `pokémon in order of ${attr}` });
      const status = h("span", { class: "ps-status", "aria-live": "polite" });
      const submit = h("button", { type: "button", class: "ps-submit", "data-command": "pokemon-sort.submit", onclick: () => doSubmit() }, "submit");
      const grid = h("div", { class: "ps-grid", "aria-hidden": "true" });
      const foot = h("div", { class: "ps-foot" }, submit, status, grid);
      const wrap = h("div", { class: "ps-root" }, head, list, tail, foot);
      root.append(wrap);

      const rows = new Map<string, { el: HTMLElement; pos: HTMLElement; mark: HTMLElement; val: HTMLElement }>();
      for (const id of p.ids) {
        const it = game.item(id);
        const pos = h("span", { class: "ps-pos" });
        const mark = h("span", { class: "ps-mark", hidden: true });
        const val = h("span", { class: "ps-val" });
        const pic = sprite(it, { size: 56 });
        const el = h("div", { class: "ps-row", role: "option", "data-id": id }, pos, pic, h("span", { class: "ps-name" }, it.name), val, mark);
        el.addEventListener("pointerdown", (e) => onDown(e, id));
        list.append(el);
        rows.set(id, { el, pos, mark, val });
      }

      let rowH = 60, gap = 6;
      let cursor = 0, held = false;
      let drag: { id: string; from: number; pointerId: number; y0: number; top0: number; to: number } | null = null;
      let freshTry = -1;
      const over = () => isOver(p, session.state) || session.finished;

      const layout = () => {
        const hgt = list.clientHeight;
        gap = Math.max(3, Math.min(8, hgt * 0.012));
        rowH = Math.max(36, Math.min(76, (hgt - gap * (N - 1)) / N));
        const pic = Math.round(Math.min(56, rowH - 6));
        for (const r of rows.values()) {
          r.el.style.height = `${rowH}px`;
          const img = r.el.querySelector<HTMLElement>(".pk-sprite");
          if (img) { img.style.width = `${pic}px`; img.style.height = `${pic}px`; }
        }
        render();
      };

      const render = () => {
        const st = session.state;
        const done = over();
        // after the game, the right order with the values
        const shown = done && !isSolved(p, st) ? game.sortedFrom(p, { ...st, tries: [] }) : drag ? (moveFree(st.order, pinned(st), drag.from, drag.to) ?? st.order) : st.order;
        const pin = pinned(st);
        const last = st.tries[st.tries.length - 1];
        shown.forEach((id, i) => {
          const r = rows.get(id)!;
          if (!(drag && drag.id === id)) r.el.style.top = `${i * (rowH + gap)}px`;
          r.pos.textContent = String(i + 1);
          const isPinned = !done && pin[i] && st.order[i] === id;
          r.el.classList.toggle("pinned", isPinned || (done && isSolved(p, st)));
          r.el.classList.toggle("cursor", !done && i === cursor);
          r.el.classList.toggle("held", !done && i === cursor && held);
          r.el.setAttribute("aria-selected", String(!done && i === cursor));
          r.val.textContent = done ? game.show(p, id) : "";
          // the mark this pokémon got in the last try, faded once it has moved from where it was marked
          const at = last ? last.order.indexOf(id) : -1;
          if (last && at >= 0 && !(done && !isSolved(p, st))) {
            const m = markOf(last.off[at]!, p.feedback);
            r.mark.hidden = false;
            r.mark.className = `ps-mark ${m.cls}${at !== st.order.indexOf(id) || (drag && at !== shown.indexOf(id)) ? " stale" : ""}${freshTry === st.tries.length - 1 ? " fresh" : ""}`;
            r.mark.style.animationDelay = freshTry === st.tries.length - 1 ? `${at * STAGGER_MS}ms` : "";
            r.mark.textContent = m.text;
            r.mark.setAttribute("aria-label", m.cls === "right" ? "right place" : `${m.arrow === "↓" ? "lower" : m.arrow === "↑" ? "higher" : "wrong place"}`);
          } else r.mark.hidden = true;
          r.el.setAttribute("aria-label", `${i + 1}: ${game.item(id).name}${r.val.textContent ? `, ${r.val.textContent}` : ""}${isPinned ? ", right" : ""}`);
        });
        const used = st.tries.length;
        status.textContent = done
          ? (session.outcome === "revealed" ? "revealed" : isSolved(p, st) ? `sorted in ${used}` : "out of tries")
          : `try ${used + 1} of ${p.tries}`;
        submit.disabled = done || session.locked;
        submit.hidden = done;
        grid.replaceChildren(...st.tries.map((tr) => {
          return h("span", { class: "col" }, ...Array.from({ length: N }, (_, k) => h("i", { class: markOf(tr.off[k]!, p.feedback).cls })));
        }));
      };

      const doSubmit = () => {
        if (over() || session.locked) return;
        held = false;
        if (session.dispatch({ type: "submit" })) freshTry = session.state.tries.length - 1;
        render();
      };

      // --- dragging ---
      const slotAt = (y: number) => Math.max(0, Math.min(N - 1, Math.round(y / (rowH + gap))));
      const onDown = (e: PointerEvent, id: string) => {
        if (over() || session.locked || drag || e.button > 0) return;
        const st = session.state;
        const from = st.order.indexOf(id);
        cursor = from;
        held = false;
        if (pinned(st)[from]) { render(); return; }
        e.preventDefault();
        const el = rows.get(id)!.el;
        el.setPointerCapture?.(e.pointerId);
        drag = { id, from, pointerId: e.pointerId, y0: e.clientY, top0: from * (rowH + gap), to: from };
        el.classList.add("lifted");
        render();
      };
      const nearestFree = (want: number) => {
        const pin = pinned(session.state);
        let best = drag!.from, bd = Infinity;
        for (let i = 0; i < N; i++) if (!pin[i] && Math.abs(i - want) < bd) { bd = Math.abs(i - want); best = i; }
        return best;
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const top = Math.max(0, Math.min((N - 1) * (rowH + gap), drag.top0 + e.clientY - drag.y0));
        rows.get(drag.id)!.el.style.top = `${top}px`;
        const to = nearestFree(slotAt(top));
        if (to !== drag.to) { drag.to = to; render(); }
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;
        rows.get(d.id)!.el.classList.remove("lifted");
        if (d.to !== d.from) {
          session.dispatch({ type: "move", from: d.from, to: d.to });
          cursor = d.to;
        }
        render();
      };
      const onCancel = () => {
        if (!drag) return;
        rows.get(drag.id)!.el.classList.remove("lifted");
        drag = null;
        render();
      };
      list.addEventListener("pointermove", onMove);
      list.addEventListener("pointerup", onUp);
      list.addEventListener("pointercancel", onCancel);

      // --- keyboard ---
      const step = (dir: 1 | -1) => {
        if (over()) return;
        const st = session.state;
        if (!held) { cursor = Math.max(0, Math.min(N - 1, cursor + dir)); render(); return; }
        const pin = pinned(st);
        let to = cursor + dir;
        while (to >= 0 && to < N && pin[to]) to += dir;
        if (to < 0 || to >= N) return;
        if (session.dispatch({ type: "move", from: cursor, to })) cursor = to;
        render();
      };
      const grab = () => {
        if (over() || session.locked) return;
        if (!held && pinned(session.state)[cursor]) return;
        held = !held;
        render();
      };

      const ro = new ResizeObserver(layout);
      ro.observe(list);
      const offs = [
        session.hooks.change.tap(() => render(), { owner: "view" }),
        session.hooks.refresh.tap(() => { onCancel(); render(); }, { owner: "view" }),
      ];
      layout();

      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "pokemon-sort.submit": () => doSubmit(),
        "pokemon-sort.up": () => step(-1),
        "pokemon-sort.down": () => step(1),
        "pokemon-sort.grab": () => grab(),
      }, {
        "pokemon-sort.submit": { menu: "board", when: () => !over() },
        "pokemon-sort.grab": { menu: "board", when: () => !over() },
      });
      return {
        aspect: 440 / (78 * (N + 2.4)),
        commands,
        endDelayMs: N * STAGGER_MS + 320,
        destroy() {
          ro.disconnect();
          offs.forEach((f) => f());
          wrap.remove();
        },
      };
    },
  };
}
