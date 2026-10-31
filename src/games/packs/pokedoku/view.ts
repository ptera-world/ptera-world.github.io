import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, inputIs, style } from "../../core/dom";
import type { DataItem, Dataset, View } from "../../core/types";
import { applyLook } from "../../lib/dataset/look";
import { nameEntry } from "../../lib/dataset/ui";
import type { Criterion } from "./criteria";
import { analyse, cellRarity, datasetOf, isOver, left, needDataset, nounOf, type DataSource, type GridAction, type GridInteraction, type GridPuzzle, type GridState } from "./logic";

const FILLED_BG = "color-mix(in srgb, var(--verdict-match, #2a8a3a) 22%, var(--tile-bg, var(--cell)))";

const CSS = `
.pkd { position: relative; width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; container-type: size; user-select: none; -webkit-user-select: none; }
.pkd.has-look { padding: 10px; border-radius: 12px; color: var(--text); font-family: var(--font); }
.pkd .name-entry { max-width: none; flex: none; }
.pkd .name-entry input { padding-right: 44px; }
.pkd.has-look .name-entry input { font-family: var(--font); background: var(--panel-bg, var(--surface)); color: var(--panel-text, inherit); border: var(--panel-border, 1px solid var(--border)); border-radius: var(--panel-radius, 6px); }
.pkd-grid { flex: 1; min-height: 0; display: grid; gap: 4px; }
.pkd-head { display: flex; align-items: center; justify-content: center; text-align: center; padding: 2px; font-size: clamp(10px, 3.2cqmin, 15px); line-height: 1.15; color: var(--text); overflow: hidden; overflow-wrap: anywhere; }
.pkd.has-look .pkd-head { text-shadow: 0 2px 0 rgb(0 0 0 / .45); }
.pkd.has-look .pkd-head.col { border-bottom: var(--head-bar, none); }
.pkd-chip { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: clamp(11px, 3.4cqmin, 16px); color: #fff; text-shadow: 0 1px 1px rgb(0 0 0 / .5); white-space: nowrap; }
.pkd-corner { display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-dim); font-size: clamp(10px, 2.6cqmin, 13px); }
.pkd-corner b { font-size: clamp(16px, 6cqmin, 30px); color: var(--text); font-weight: 600; }
.pkd.has-look .pkd-corner { text-shadow: 0 2px 0 rgb(0 0 0 / .45); }
.pkd-cell { position: relative; min-width: 0; min-height: 0; border: var(--tile-border, 1px solid var(--border)); border-radius: var(--tile-radius, 8px); box-shadow: var(--tile-shadow, none); background: var(--tile-bg, var(--cell)); color: var(--tile-text, inherit); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; padding: 2px; box-sizing: border-box; }
.pkd-cell.sel { outline: 3px solid var(--focus); outline-offset: -2px; }
${inputIs("keyboard")} .pkd-cell.cur { outline: 3px solid var(--focus); outline-offset: -2px; }
.pkd-cell.filled { background: ${FILLED_BG}; cursor: default; }
.pkd-cell.over { cursor: pointer; }
.pkd-pic { object-fit: contain; }
.pkd-pic.pixel { image-rendering: pixelated; }
.pkd-pic.missing { display: inline-flex; align-items: center; justify-content: center; opacity: .6; font-size: 11px; border: 1px dashed currentColor; border-radius: 6px; box-sizing: border-box; }
.pkd-cell .pkd-pic { width: 72%; height: 62%; min-height: 0; }
.pkd-cell .nm { font-size: clamp(9px, 2.6cqmin, 13px); text-align: center; line-height: 1.1; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pkd-cell .nm.only { font-size: clamp(11px, 3.6cqmin, 18px); white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.pkd-cell .pct { position: absolute; top: 2px; right: 4px; font-size: clamp(9px, 2.3cqmin, 12px); opacity: .7; font-family: var(--mono); }
.pkd-cell .count { font-size: clamp(9px, 2.4cqmin, 12px); opacity: .7; }
.pkd-cell.miss { animation: pkd-shake .35s; }
.pkd-cell .tried { position: absolute; left: 3px; bottom: 2px; font-size: clamp(9px, 2.3cqmin, 12px); color: var(--danger, #c33); }
@keyframes pkd-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.pkd-answers { position: absolute; inset: 0; z-index: 20; background: var(--panel-bg, var(--surface)); color: var(--panel-text, inherit); border: var(--panel-border, 1px solid var(--border)); border-radius: var(--panel-radius, 10px); display: flex; flex-direction: column; box-shadow: 0 6px 20px rgb(0 0 0 / .25); }
.pkd-answers header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 14px; }
.pkd-answers header span { flex: 1; }
.pkd-answers ul { list-style: none; margin: 0; padding: 6px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 2px 8px; }
.pkd-answers li { display: flex; align-items: center; gap: 4px; font-size: 13px; }
.pkd-answers li .pkd-pic { width: 32px; height: 32px; flex: none; }
.pkd-answers li.mine { font-weight: 600; color: var(--accent); }
`;

const BINDINGS = {
  "pokedoku.left": { label: "square to the left", category: "grid", keys: ["ArrowLeft"] },
  "pokedoku.right": { label: "square to the right", category: "grid", keys: ["ArrowRight"] },
  "pokedoku.up": { label: "square above", category: "grid", keys: ["ArrowUp"] },
  "pokedoku.down": { label: "square below", category: "grid", keys: ["ArrowDown"] },
  "pokedoku.name": { label: "name one for this square", category: "grid", keys: ["Enter", "space"], description: "type into the name box for the selected square; after the game, list the square's answers" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

/** A rarity as shown: whole percents, one decimal below 10, "<0.1%" when that would round to 0 (thousands of answers). */
const pct = (x: number): string => (x < 0.05 ? "<0.1%" : `${x < 10 ? (Math.round(x * 10) / 10).toString() : Math.round(x)}%`);

/** A criterion as a header: a value with its own colour as a chip, the rest as words. */
function header(f: Criterion, col: boolean): HTMLElement {
  return h("div", { class: `pkd-head${col ? " col" : ""}`, title: f.detail ? `${f.label}: ${f.detail}` : f.label },
    f.chip ? h("span", { class: "pkd-chip", style: `background: ${f.chip.color}` }, f.chip.label) : f.label);
}

/**
 * An item's picture from the dataset's image media (pixel art first, as small squares suit it), a
 * labelled empty box when the item has none, or null when the dataset has no pictures at all.
 */
function picture(d: Dataset, it: DataItem, size: number): HTMLElement | null {
  const ms = Object.values(d.media ?? {}).filter((m) => m.type === "image");
  const m = ms.find((x) => x.pixel) ?? ms[0];
  if (!m) return null;
  const url = m.url(it);
  if (!url) return h("span", { class: "pkd-pic missing", style: `width: ${size}px; height: ${size}px`, role: "img", "aria-label": it.name }, "no picture");
  return h("img", { class: `pkd-pic${m.pixel ? " pixel" : ""}`, src: url, crossorigin: "anonymous", alt: it.name, width: size, height: size, decoding: "async", draggable: "false" });
}

export function gridView(data: DataSource): View<GridPuzzle, GridState, GridAction, GridInteraction> {
  const noun = (p: GridPuzzle) => nounOf(data.get(datasetOf(p)));
  return {
    id: "pokedoku.grid",
    name: "grid",
    puzzle: { id: "pokedoku" },
    controls: (p) => [
      { how: "click or tap a square, then type a name and pick it", what: `name one ${noun(p).one} for that square` },
      { how: "after the game, click or tap a square", what: `see every ${noun(p).one} that fits it` },
    ],
    legend: (p) => [
      { sample: `<svg viewBox="0 0 30 20"><rect x="1" y="1" width="28" height="18" rx="3" fill="var(--cell)" stroke="var(--focus)" stroke-width="2"/></svg>`, meaning: "the square you are naming" },
      { sample: `<svg viewBox="0 0 30 20"><rect x="1" y="1" width="28" height="18" rx="3" fill="color-mix(in srgb, var(--verdict-match, #2a8a3a) 22%, var(--cell))" stroke="var(--border)"/><text x="27" y="8" font-size="7" text-anchor="end" fill="var(--text-dim)">4%</text></svg>`, meaning: `a filled square; the number is its rarity: 100 ÷ how many ${noun(p).many} fit it` },
      { sample: `<svg viewBox="0 0 30 20"><rect x="1" y="1" width="28" height="18" rx="3" fill="var(--cell)" stroke="var(--border)"/><text x="4" y="17" font-size="7" fill="var(--danger, #c33)">✗2</text></svg>`, meaning: "wrong guesses made in this square" },
    ],
    mount(root, { session }) {
      style("pokedoku", CSS);
      const p = session.puzzle;
      const d = needDataset(data, p);
      const a = analyse(d, p);
      const C = p.cols.length, R = p.rows.length;
      const el = h("div", { class: "pkd" });
      const sel = () => session.interaction.cursor;
      const entry = nameEntry({
        items: () => a.pool,
        icon: (it) => picture(d, it, 36),
        used: (it) => session.state.cells.includes(it.id) || session.state.wrong.some((w) => w.cell === sel() && w.item === it.id),
        placeholder: `which ${nounOf(d).one}?`,
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
      grid.append(corner, ...a.cols.map((f) => header(f, true)));
      const cells: HTMLElement[] = [];
      a.rows.forEach((rf, r) => {
        grid.append(header(rf, false));
        for (let c = 0; c < C; c++) {
          const cell = h("div", { class: "pkd-cell", role: "button", "data-cell": r * C + c, "aria-label": `${rf.label} and ${a.cols[c]!.label}` });
          cells.push(cell);
          grid.append(cell);
        }
      });
      el.append(entry.el, grid);
      root.append(el);
      const unlook = applyLook(d, el);

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
            return h("li", { class: id === mine ? "mine" : undefined }, picture(d, it, 32), it.name);
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
          const pic = it ? picture(d, it, 96) : null;
          cell.replaceChildren(
            ...(it ? [...(pic ? [pic] : []), h("span", { class: `nm${pic ? "" : " only"}` }, it.name), h("span", { class: "pct" }, pct(cellRarity(a, st, i)))] : []),
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
          unlook();
          el.remove();
        },
      };
    },
  };
}
