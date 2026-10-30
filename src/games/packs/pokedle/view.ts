import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, style, clear } from "../../core/dom";
import type { CommandDef, DataAttribute, DataValue, PuzzleRef, View } from "../../core/types";
import { formatValue, type Feedback } from "../../lib/dataset/compare";
import { VERDICT_CSS, arrow, nameEntry, verdictClass } from "../../lib/dataset/ui";
import { sprite, typeColor } from "../../lib/pokemon/ui";
import type { PokemonItem } from "../../lib/pokemon/types";
import {
  bestSoFar, ctxOf, givenLabel, isOpen, isOver, markOf, rowsOn, solvedAt,
  type DataSource, type PokedleAction, type PokedleFocus, type PokedleInteraction, type PokedlePuzzle, type PokedleState,
} from "./logic";
import { liveBoards } from "./techniques";

const CSS = `
.pkd { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 8px; min-height: 0; font-size: 12px; }
.pkd-top { display: flex; gap: 8px; align-items: center; flex: none; }
.pkd-top .name-entry { flex: 1; max-width: none; }
.pkd-left { color: var(--text-dim); white-space: nowrap; font-size: 13px; }
.pkd-tiles { flex: none; max-height: 40%; overflow: auto; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); padding: 2px; }
.pkd-tiles.grid { grid-template-columns: auto repeat(var(--cols), minmax(16px, 1fr)); gap: 2px; }
.pkd-tiles .hd { font-size: 10px; color: var(--text-dim); display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; }
.pkd-tiles .hd.col { writing-mode: vertical-rl; transform: rotate(180deg); padding: 2px 0; justify-content: flex-start; }
.pkd-tiles .hd.row { justify-content: flex-end; padding-right: 4px; }
.pkd-tiles .hd .chip, .pkd-tile .chip { border-radius: 99px; padding: 0 5px; color: #fff; text-shadow: 0 1px 1px rgb(0 0 0 / .5); }
.pkd-tiles .hole { min-height: 18px; }
.pkd-tile { container-type: inline-size; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 52px; padding: 3px 2px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; cursor: pointer; min-width: 0; }
.pkd-tiles.grid .pkd-tile { min-height: 20px; padding: 0; border-radius: 3px; }
.pkd-tile[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: 1px; }
.pkd-tile.hint { outline: 2px solid var(--hint); outline-offset: 1px; }
.pkd-tile.found { background: var(--verdict-match-c); color: #fff; border-color: transparent; }
.pkd-tile.lost { border-color: var(--danger); }
.pkd-tile.closed { opacity: .4; cursor: default; }
.pkd-tile .lbl { font-size: 10px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pkd-tile .pips { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center; max-width: 52px; }
.pkd-tile .pips i { width: 7px; height: 7px; border-radius: 2px; background: var(--border); }
.pkd-tile .pips i.match { background: var(--verdict-match-c); }
.pkd-tile .pips i.near { background: var(--verdict-near-c); }
.pkd-tile .pips i.miss { background: var(--verdict-miss-c); outline: 1px solid var(--border); }
.pkd-tile .cnt { display: none; font-size: 10px; font-weight: 600; }
.pkd-tile img, .pkd-tile .pk-sprite { width: 32px; height: 32px; }
@container (max-width: 40px) {
  .pkd-tile .pips, .pkd-tile .lbl, .pkd-tile img, .pkd-tile .pk-sprite { display: none; }
  .pkd-tile .cnt { display: block; }
}
.pkd-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; border-radius: 6px; }
.pkd-grid { display: grid; gap: 3px; grid-template-columns: var(--cols); width: max-content; min-width: 100%; }
.pkd-grid > div { min-height: 44px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2px 3px; box-sizing: border-box; line-height: 1.15; overflow: hidden; overflow-wrap: anywhere; }
.pkd-grid > .th { position: sticky; top: 0; z-index: 2; min-height: 0; padding: 4px 2px; background: var(--bg); color: var(--text-dim); font-size: 10.5px; }
.pkd-grid > .nm { position: sticky; left: 0; z-index: 1; background: var(--surface); padding: 0 2px; }
.pkd-grid > .th.nm { z-index: 3; background: var(--bg); color: var(--text); font-weight: 600; }
.pkd-grid > .nm.v-match { background: var(--verdict-match-c); color: #fff; }
.pkd-grid > .nm img, .pkd-grid > .nm .pk-sprite { width: 40px; height: 40px; margin: -4px 0 -3px; }
.pkd-grid > .nm span { font-size: 9.5px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pkd-grid .ar { font-size: 15px; font-weight: 700; line-height: 1; }
.pkd-grid .m { display: block; }
.pkd-grid .m.x { text-decoration: line-through; opacity: .55; }
.pkd-grid .chip { display: block; border-radius: 99px; padding: 0 5px; margin: 1px 0; color: #fff; text-shadow: 0 1px 1px rgb(0 0 0 / .6); font-size: 10.5px; }
.pkd-grid .chip.x { opacity: .35; text-decoration: line-through; }
.pkd-grid > .answer { outline: 2px dashed var(--danger); outline-offset: -2px; background: var(--surface); }
.pkd-grid > .hint { box-shadow: inset 0 0 0 2px var(--hint); }
.pkd-grid > .new { animation: pkd-in .35s ease-out both; }
@keyframes pkd-in { from { transform: rotateX(90deg); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .pkd-grid > .new { animation: none; } }
.pkd-empty { color: var(--text-dim); padding: 8px; }
`;

/** Column width by what a column holds. */
function colWidth(a: DataAttribute): string {
  if (a.kind === "set") return (a.values?.length ?? 0) > 30 ? "minmax(92px, 1.6fr)" : a.id === "type" ? "minmax(60px, 1fr)" : "minmax(70px, 1.2fr)";
  if (a.kind === "category") return "minmax(56px, 1fr)";
  return "minmax(46px, 1fr)";
}

/** Labels of an ordinal that share a prefix ("gen 1", "gen 2") lose it in cells: the header says it. */
function shortLabel(a: DataAttribute, v: DataValue): string {
  const full = formatValue(a, v);
  if (a.kind !== "ordinal" || !a.values?.length) return full;
  const words = a.values.map((x) => x.label.split(" "));
  const lead = words[0]!.length > 1 && words.every((w) => w.length > 1 && w[0] === words[0]![0]) ? `${words[0]![0]} ` : "";
  return lead && full.startsWith(lead) ? full.slice(lead.length) : full;
}

function cell(a: DataAttribute, v: DataValue, fb: Feedback | null, cls: string): HTMLElement {
  const el = h("div", { class: `${fb ? verdictClass(fb) : ""} ${cls}`, title: `${a.label}: ${formatValue(a, v)}` });
  if (a.kind === "set" && Array.isArray(v)) {
    const shared = new Set(fb?.shared ?? []);
    if (!v.length) el.append("none");
    for (const m of v as string[]) {
      const label = a.values?.find((x) => x.value === m)?.label ?? m;
      const off = fb && !shared.has(m) ? " x" : "";
      el.append(a.id === "type" ? h("span", { class: `chip${off}`, style: `background: ${typeColor(m)}` }, label) : h("span", { class: `m${off}` }, label));
    }
    return el;
  }
  const ar = fb ? arrow(fb) : "";
  if (ar) el.append(h("span", { class: "ar", "aria-label": fb!.dir === "higher" ? "higher" : "lower" }, ar));
  el.append(h("span", null, shortLabel(a, v)));
  return el;
}

const BINDINGS = {
  "pokedle.next-board": { label: "next board", category: "pokédle", keys: ["PageDown", "alt+ArrowRight"] },
  "pokedle.prev-board": { label: "previous board", category: "pokédle", keys: ["PageUp", "alt+ArrowLeft"] },
  "pokedle.name": { label: "type a guess", category: "pokédle", keys: ["slash"], description: "move to the name box" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const svgBox = (body: string) => `<span style="display:inline-flex;gap:3px">${body}</span>`;
const swatch = (bg: string, text = "", fg = "#fff") => `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;border-radius:5px;background:${bg};color:${fg};font:600 13px var(--font)">${text}</span>`;

export function pokedleView(data: DataSource, puzzle: PuzzleRef): View<PokedlePuzzle, PokedleState, PokedleAction, PokedleInteraction> {
  return {
    id: "pokedle.table",
    name: "table",
    puzzle,
    controls: [
      { how: "type a name, then pick it from the list (or press enter)", what: "guess that pokémon" },
      { how: "click or tap a board", what: "show its guesses" },
    ],
    legend: [
      { sample: swatch("var(--verdict-match-c)"), meaning: "right" },
      { sample: swatch("var(--verdict-near-c)", "↑", "#000"), meaning: "close; the arrow says the hidden pokémon's value is higher (↑) or lower (↓)" },
      { sample: swatch("var(--verdict-near-c)"), meaning: "a list (types, abilities, egg groups) that shares some members but isn't the same" },
      { sample: swatch("var(--verdict-miss-c)", "↓", "var(--text)"), meaning: "wrong" },
      { sample: svgBox(`<span style="text-decoration:line-through;opacity:.55">fire</span>`), meaning: "a member of a list the hidden pokémon doesn't have" },
      { sample: svgBox(swatch("var(--surface)") + swatch("var(--surface)")), meaning: "boards: each square shows how far you've got on that board's things to compare" },
    ],
    mount(root, { session }) {
      style("dataset-verdicts", VERDICT_CSS);
      style("pokedle", CSS);
      const p = session.puzzle;
      const c = ctxOf(data, p);
      const many = p.boards.length > 1;
      const grid = p.split.length === 2;

      const status = h("span", { class: "pkd-left", "aria-live": "polite" });
      const entry = nameEntry<PokemonItem>({
        items: () => c.guessable,
        pick: (it) => session.dispatch({ type: "guess", id: it.id }),
        used: (it) => session.state.guesses.includes(it.id),
        icon: (it) => sprite(it, { size: 36 }),
        placeholder: "guess a pokémon",
      });
      const tiles = h("div", { class: `pkd-tiles${grid ? " grid" : ""}`, role: "group", "aria-label": "boards" });
      const scroll = h("div", { class: "pkd-scroll" });
      const tableEl = h("div", { class: "pkd-grid", role: "table" });
      scroll.append(tableEl);
      const el = h("div", { class: "pkd" }, h("div", { class: "pkd-top" }, entry.el, status), many ? tiles : null, scroll);
      root.append(el);

      const select = (b: number) => {
        if (b < 0 || b >= p.boards.length || !isOpen(p, session.state, b)) return;
        session.setInteraction((i) => ({ ...i, board: b }));
      };

      // --- board tiles (built once; their contents change) ---
      const tileEls: HTMLButtonElement[] = [];
      const gridCols = grid ? [...new Set(p.boards.map((b) => JSON.stringify(b.given![p.split[1]!])))] : [];
      const gridRows = grid ? [...new Set(p.boards.map((b) => JSON.stringify(b.given![p.split[0]!])))] : [];
      const headLabel = (attrId: string, raw: string) => {
        const v = JSON.parse(raw) as string | boolean;
        const text = givenLabel(c.data, { [attrId]: v });
        return attrId === "type" ? h("span", { class: "chip", style: `background: ${typeColor(String(v))}` }, text) : h("span", null, text);
      };
      if (many) {
        p.boards.forEach((b, i) => {
          const t = h("button", { class: "pkd-tile", type: "button", onclick: () => select(i) });
          t.title = givenLabel(c.data, b.given) || `board ${i + 1}`;
          tileEls.push(t);
        });
        if (grid) {
          tiles.style.setProperty("--cols", String(gridCols.length));
          tiles.append(h("div", { class: "hd" }));
          for (const col of gridCols) tiles.append(h("div", { class: "hd col" }, headLabel(p.split[1]!, col)));
          for (const row of gridRows) {
            tiles.append(h("div", { class: "hd row" }, headLabel(p.split[0]!, row)));
            for (const col of gridCols) {
              const i = p.boards.findIndex((b) => JSON.stringify(b.given![p.split[0]!]) === row && JSON.stringify(b.given![p.split[1]!]) === col);
              tiles.append(i < 0 ? h("div", { class: "hole" }) : tileEls[i]!);
            }
          }
        } else tiles.append(...tileEls);
      }

      const renderTiles = (st: PokedleState, focus: PokedleFocus | undefined) => {
        const over = isOver(p, st);
        tileEls.forEach((t, i) => {
          const b = p.boards[i]!;
          const at = solvedAt(p, st, i);
          const open = isOpen(p, st, i);
          const ans = c.byId.get(b.answer);
          t.className = `pkd-tile${at >= 0 && open ? " found" : ""}${!open ? " closed" : ""}${over && at < 0 ? " lost" : ""}${focus?.board === i ? " hint" : ""}`;
          t.setAttribute("aria-pressed", String(session.interaction.board === i));
          t.disabled = !open;
          clear(t);
          const lbl = grid ? null : h("span", { class: "lbl" }, b.given ? (p.split[0] === "type" && p.split.length === 1 ? h("span", { class: "chip", style: `background: ${typeColor(String(b.given.type))}` }, givenLabel(c.data, b.given)) : givenLabel(c.data, b.given)) : String(i + 1));
          if (lbl) t.append(lbl);
          if (((at >= 0 && open) || over) && ans) {
            t.append(sprite(ans, { size: 32 }), h("span", { class: "cnt" }, at >= 0 ? "✓" : "✗"));
            t.setAttribute("aria-label", `${t.title}: ${at >= 0 ? `found on guess ${at + 1}` : "not found"}, ${ans.name}`);
          } else if (open) {
            const best = bestSoFar(data, p, st, i);
            t.append(h("span", { class: "pips" }, best.map((v) => h("i", { class: v }))), h("span", { class: "cnt" }, String(best.filter((v) => v === "match").length)));
            t.setAttribute("aria-label", `${t.title}: ${best.filter((v) => v === "match").length} of ${best.length} right`);
          } else t.setAttribute("aria-label", `${t.title}: not open yet`);
        });
      };

      // --- the shown board's guesses, newest first ---
      tableEl.style.setProperty("--cols", ["minmax(52px, 64px)", ...c.attrs.map(colWidth)].join(" "));
      let shownLen = session.state.guesses.length;
      let shownBoard = session.interaction.board;
      const renderTable = (st: PokedleState, focus: PokedleFocus | undefined) => {
        const b = Math.min(session.interaction.board, p.boards.length - 1);
        const board = p.boards[b]!;
        const n = rowsOn(p, st, b);
        const fresh = b === shownBoard && st.guesses.length > shownLen ? st.guesses.length - shownLen : 0;
        shownLen = st.guesses.length;
        shownBoard = b;
        clear(tableEl);
        tableEl.append(h("div", { class: "th nm", role: "columnheader" }, many ? (givenLabel(c.data, board.given) || `board ${b + 1}`) : ""));
        for (const a of c.attrs) tableEl.append(h("div", { class: "th", role: "columnheader" }, a.label));
        const over = isOver(p, st);
        const answer = c.byId.get(board.answer);
        const row = (item: PokemonItem | undefined, id: string, marks: ReturnType<typeof markOf> | null, cls: string) => {
          const nm = h("div", { class: `nm ${marks?.found ? "v-match" : ""} ${cls}`, role: "rowheader", title: item?.name ?? id });
          if (item) nm.append(sprite(item, { size: 40, alt: "" }), h("span", null, item.name));
          else nm.append(h("span", null, id));
          tableEl.append(nm);
          c.attrs.forEach((a, k) => {
            const ce = cell(a, item?.values[a.id] ?? null, marks?.attrs[k] ?? null, cls);
            if (cls.includes("new")) ce.style.animationDelay = `${(k + 1) * 70}ms`;
            tableEl.append(ce);
          });
        };
        if (!isOpen(p, st, b)) {
          tableEl.append(h("div", { class: "pkd-empty", style: "grid-column: 1 / -1" }, "opens once the board before it is found"));
          return;
        }
        if (over && solvedAt(p, st, b) < 0) row(answer, board.answer, null, "answer");
        for (let k = n - 1; k >= 0; k--) {
          const id = st.guesses[k]!;
          const cls = `${k >= st.guesses.length - fresh ? "new" : ""}${focus?.board === b && focus.guesses?.includes(k) ? " hint" : ""}`;
          row(c.byId.get(id), id, markOf(c, p, id, board.answer), cls);
        }
      };

      let lastFocus: unknown = null;
      const render = () => {
        const st = session.state;
        const focus = session.activeHint?.focus as PokedleFocus | undefined;
        if (focus && focus !== lastFocus && focus.board !== session.interaction.board && isOpen(p, st, focus.board)) {
          lastFocus = focus;
          select(focus.board);
          return;
        }
        lastFocus = focus ?? null;
        const over = isOver(p, st);
        entry.setDisabled(over || session.locked);
        entry.input.placeholder = over ? "" : "guess a pokémon";
        status.textContent = p.limit && !over ? `${p.limit - st.guesses.length} left` : "";
        renderTiles(st, focus);
        renderTable(st, focus);
      };

      /** After a guess finds the shown board, show the next board still in play. */
      const onChange = ({ prev, state }: { prev: PokedleState; state: PokedleState }) => {
        const b = session.interaction.board;
        if (state.guesses.length > prev.guesses.length && solvedAt(p, state, b) === state.guesses.length - 1) {
          const live = liveBoards(p, state);
          const next = live.find((x) => x > b) ?? live[0];
          if (next !== undefined) { select(next); return; }
        }
        render();
      };

      const offs = [
        session.hooks.change.tap(onChange, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();
      if (matchMedia?.("(pointer: fine)").matches && !isOver(p, session.state)) entry.focus();

      const step = (d: number) => {
        const open = p.boards.map((_, i) => i).filter((i) => isOpen(p, session.state, i));
        if (!open.length) return;
        const at = open.indexOf(session.interaction.board);
        select(open[(at + d + open.length) % open.length]!);
      };
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "pokedle.next-board": () => step(1),
        "pokedle.prev-board": () => step(-1),
        "pokedle.name": () => entry.focus(),
      }, {
        "pokedle.next-board": { captureInput: true, when: () => many },
        "pokedle.prev-board": { captureInput: true, when: () => many },
      });

      const rectOf = (e: Element | undefined) => (e ? [e.getBoundingClientRect()] : []);
      return {
        get aspect() {
          // fill the space the board gets: a list of guesses has no shape of its own
          const w = innerWidth, hgt = innerHeight;
          return w < 700 ? Math.min(1, Math.max(0.45, w / Math.max(1, hgt - 140))) : Math.min(1.5, Math.max(0.75, (w - 380) / Math.max(1, hgt - 110)));
        },
        // the last row's cells turn one after another (see the animation delays above)
        endDelayMs: (c.attrs.length + 1) * 70 + 350,
        commands,
        target: () => ({ board: session.interaction.board }),
        locate: (focus) => {
          const f = focus as PokedleFocus | undefined;
          if (!f) return [];
          return many ? rectOf(tileEls[f.board]) : rectOf(scroll);
        },
        locateChange: () => rectOf(tableEl.children[1 + c.attrs.length]),
        destroy() {
          offs.forEach((f) => f());
          el.remove();
        },
      };
    },
  };
}
