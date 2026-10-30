import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, inputIs, style } from "../../core/dom";
import type { View } from "../../core/types";
import { nameEntry } from "../../lib/dataset/ui";
import type { Facet } from "../../lib/pokemon/facets";
import { sprite, typeChip } from "../../lib/pokemon/ui";
import { analyse, cellRarity, isOver, left, needDataset, type Dataset, type GridAction, type GridInteraction, type GridPuzzle, type GridState } from "./logic";

const CSS = `
.pkd { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; gap: 6px; container-type: size; user-select: none; -webkit-user-select: none; }
.pkd .name-entry { max-width: none; flex: none; }
.pkd-grid { flex: 1; min-height: 0; display: grid; gap: 4px; }
.pkd-head { display: flex; align-items: center; justify-content: center; text-align: center; padding: 2px; font-size: clamp(10px, 3.2cqmin, 15px); line-height: 1.15; color: var(--text); overflow: hidden; overflow-wrap: anywhere; }
.pkd-head .pk-type { font-size: clamp(11px, 3.4cqmin, 16px); padding: 2px 10px; }
.pkd-corner { display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-dim); font-size: clamp(10px, 2.6cqmin, 13px); }
.pkd-corner b { font-size: clamp(16px, 6cqmin, 30px); color: var(--text); font-weight: 600; }
.pkd-cell { position: relative; min-width: 0; min-height: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--cell); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; padding: 2px; }
.pkd-cell.sel { outline: 3px solid var(--focus); outline-offset: -2px; }
${inputIs("keyboard")} .pkd-cell.cur { outline: 3px solid var(--focus); outline-offset: -2px; }
.pkd-cell.filled { background: color-mix(in srgb, var(--verdict-match, #2a8a3a) 22%, var(--cell)); cursor: default; }
.pkd-cell.over { cursor: pointer; }
.pkd-cell img, .pkd-cell .pk-sprite { width: 72%; height: 62%; min-height: 0; }
.pkd-cell .nm { font-size: clamp(9px, 2.6cqmin, 13px); text-align: center; line-height: 1.1; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pkd-cell .pct { position: absolute; top: 2px; right: 4px; font-size: clamp(9px, 2.3cqmin, 12px); color: var(--text-dim); font-family: var(--mono); }
.pkd-cell .count { font-size: clamp(9px, 2.4cqmin, 12px); color: var(--text-dim); }
.pkd-cell.miss { animation: pkd-shake .35s; }
.pkd-cell .tried { position: absolute; left: 3px; bottom: 2px; font-size: clamp(9px, 2.3cqmin, 12px); color: var(--danger, #c33); }
@keyframes pkd-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.pkd-answers { position: absolute; inset: 0; z-index: 20; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; display: flex; flex-direction: column; box-shadow: 0 6px 20px rgb(0 0 0 / .25); }
.pkd-answers header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 14px; }
.pkd-answers header span { flex: 1; }
.pkd-answers ul { list-style: none; margin: 0; padding: 6px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 2px 8px; }
.pkd-answers li { display: flex; align-items: center; gap: 4px; font-size: 13px; }
.pkd-answers li img, .pkd-answers li .pk-sprite { width: 32px; height: 32px; flex: none; }
.pkd-answers li.mine { font-weight: 600; color: var(--accent); }
`;

const BINDINGS = {
  "pokedoku.left": { label: "square to the left", category: "pokémon grid", keys: ["ArrowLeft"] },
  "pokedoku.right": { label: "square to the right", category: "pokémon grid", keys: ["ArrowRight"] },
  "pokedoku.up": { label: "square above", category: "pokémon grid", keys: ["ArrowUp"] },
  "pokedoku.down": { label: "square below", category: "pokémon grid", keys: ["ArrowDown"] },
  "pokedoku.name": { label: "name a pokémon for this square", category: "pokémon grid", keys: ["Enter", "space"], description: "type into the name box for the selected square; after the game, list the square's answers" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

/** A criterion as a header: types as their colored chip, the rest as words. */
function header(f: Facet): HTMLElement {
  return h("div", { class: "pkd-head", title: f.detail ?? f.label }, f.typeChip ? typeChip(f.typeChip, f.label.replace(/ type$/, "")) : f.label);
}

export function gridView(get: Dataset): View<GridPuzzle, GridState, GridAction, GridInteraction> {
  return {
    id: "pokedoku.grid",
    name: "grid",
    puzzle: { id: "pokedoku" },
    controls: [
      { how: "click or tap a square, then type a name and pick it", what: "name a pokémon for that square" },
      { how: "after the game, click or tap a square", what: "see every pokémon that fits it" },
    ],
    legend: [
      { sample: `<svg viewBox="0 0 30 20"><rect x="1" y="1" width="28" height="18" rx="3" fill="var(--cell)" stroke="var(--focus)" stroke-width="2"/></svg>`, meaning: "the square you are naming" },
      { sample: `<svg viewBox="0 0 30 20"><rect x="1" y="1" width="28" height="18" rx="3" fill="color-mix(in srgb, var(--verdict-match, #2a8a3a) 22%, var(--cell))" stroke="var(--border)"/><text x="27" y="8" font-size="7" text-anchor="end" fill="var(--text-dim)">4%</text></svg>`, meaning: "a filled square; the number is its rarity: 100 ÷ how many pokémon fit it" },
      { sample: `<svg viewBox="0 0 30 20"><rect x="1" y="1" width="28" height="18" rx="3" fill="var(--cell)" stroke="var(--border)"/><text x="4" y="17" font-size="7" fill="var(--danger, #c33)">✗2</text></svg>`, meaning: "wrong guesses made in this square" },
    ],
    mount(root, { session }) {
      style("pokedoku", CSS);
      const p = session.puzzle;
      const ds = needDataset(get);
      const a = analyse(ds, p);
      const C = p.cols.length, R = p.rows.length;
      const el = h("div", { class: "pkd" });
      const sel = () => session.interaction.cursor;
      const entry = nameEntry({
        items: () => a.pool,
        icon: (it) => sprite(it, { size: 36 }),
        used: (it) => session.state.cells.includes(it.id) || session.state.wrong.some((w) => w.cell === sel() && w.item === it.id),
        placeholder: "name a pokémon for the selected square",
        pick: (it) => {
          const before = session.state.wrong.length;
          session.dispatch({ type: "guess", cell: sel(), item: it.id });
          if (session.state.wrong.length > before) {
            const cell = cells[sel()]!;
            cell.classList.remove("miss");
            void cell.offsetWidth;
            cell.classList.add("miss");
          } else {
            // on to the next empty square, so a run of answers needs no clicking
            const next = session.state.cells.findIndex((c, i) => c === null && i > sel());
            const any = next >= 0 ? next : session.state.cells.findIndex((c) => c === null);
            if (any >= 0) session.setInteraction((i) => ({ ...i, cursor: any }));
          }
        },
      });
      const grid = h("div", { class: "pkd-grid", style: `grid-template-columns: minmax(0, .8fr) repeat(${C}, minmax(0, 1fr)); grid-template-rows: minmax(0, .55fr) repeat(${R}, minmax(0, 1fr))` });
      const corner = h("div", { class: "pkd-corner" });
      grid.append(corner, ...a.cols.map(header));
      const cells: HTMLElement[] = [];
      a.rows.forEach((rf, r) => {
        grid.append(header(rf));
        for (let c = 0; c < C; c++) {
          const cell = h("div", { class: "pkd-cell", role: "button", "data-cell": r * C + c, "aria-label": `${rf.label} and ${a.cols[c]!.label}` });
          cells.push(cell);
          grid.append(cell);
        }
      });
      el.append(entry.el, grid);
      root.append(el);

      let answersOf: number | null = null;
      const answersBox = h("div", { class: "pkd-answers" });
      const showAnswers = (cell: number | null) => {
        answersOf = cell;
        answersBox.remove();
        if (cell === null) return;
        const ids = a.answers[cell]!;
        const mine = session.state.cells[cell];
        const close = h("button", { type: "button", onclick: () => showAnswers(null) }, "close");
        answersBox.replaceChildren(
          h("header", null, h("span", null, `${a.rows[Math.floor(cell / C)]!.label} × ${a.cols[cell % C]!.label}: ${ids.length}`), close),
          h("ul", null, ids.map((id) => {
            const it = a.byId.get(id)!;
            return h("li", { class: id === mine ? "mine" : undefined }, sprite(it, { size: 32 }), it.name);
          })),
        );
        el.append(answersBox);
        close.focus({ preventScroll: true });
      };

      const render = () => {
        const st = session.state;
        const over = isOver(p, st) || session.finished;
        entry.el.style.visibility = over ? "hidden" : "";
        entry.setDisabled(over);
        corner.replaceChildren(h("b", null, String(Math.max(0, left(p, st)))), over ? "guesses left" : "guesses");
        cells.forEach((cell, i) => {
          const id = st.cells[i];
          const it = id ? a.byId.get(id) : undefined;
          const tried = st.wrong.filter((w) => w.cell === i).length;
          cell.className = `pkd-cell${it ? " filled" : ""}${over ? " over" : ""}${!over && i === sel() ? " sel" : ""}${i === sel() ? " cur" : ""}`;
          cell.replaceChildren(
            ...(it ? [sprite(it, { size: 96 }), h("span", { class: "nm" }, it.name), h("span", { class: "pct" }, `${Math.round(cellRarity(a, st, i))}%`)] : []),
            ...(over && !it ? [h("span", { class: "count" }, `${a.answers[i]!.length} fit`)] : []),
            ...(tried ? [h("span", { class: "tried" }, `✗${tried}`)] : []),
          );
        });
        if (!over && answersOf !== null) showAnswers(null);
      };

      const open = (cell: number) => {
        session.setInteraction((i) => ({ ...i, cursor: cell }));
        if (isOver(p, session.state) || session.finished) showAnswers(cell);
        else if (session.state.cells[cell] === null) entry.focus();
      };
      const onDown = (e: PointerEvent) => {
        const t = (e.target as Element).closest("[data-cell]");
        if (!t || e.button !== 0) return;
        e.preventDefault();
        open(Number(t.getAttribute("data-cell")));
      };
      grid.addEventListener("pointerdown", onDown);

      const move = (dc: number, dr: number) => () => session.setInteraction((i) => {
        const c = Math.min(C - 1, Math.max(0, (i.cursor % C) + dc));
        const r = Math.min(R - 1, Math.max(0, Math.floor(i.cursor / C) + dr));
        return { ...i, cursor: r * C + c };
      });

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (list: number[]) => list.map((c) => cells[c]!.getBoundingClientRect());
      return {
        aspect: (C + 0.8) / (R + 0.55 + 0.6),
        commands: bindCommands(BINDINGS, {
          "pokedoku.left": move(-1, 0),
          "pokedoku.right": move(1, 0),
          "pokedoku.up": move(0, -1),
          "pokedoku.down": move(0, 1),
          "pokedoku.name": () => open(sel()),
        }, { "pokedoku.name": { menu: "board" } }),
        target: () => sel(),
        locate: () => rects([sel()]),
        locateChange: (x, y) => {
          const before = x as GridState, after = y as GridState;
          return rects(after.cells.flatMap((c, i) => (c !== before.cells[i] || after.wrong.filter((w) => w.cell === i).length !== before.wrong.filter((w) => w.cell === i).length ? [i] : [])));
        },
        destroy() {
          offs.forEach((f) => f());
          el.remove();
        },
      };
    },
  };
}
