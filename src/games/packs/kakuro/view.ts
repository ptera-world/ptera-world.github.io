import { bindCommands, bindingsOver, handlersOver, type BindingSchema, type Ids } from "../../core/commands";
import { s, style } from "../../core/dom";
import type { CommandDef, View } from "../../core/types";
import { DIGITS, type Digit } from "../../lib/digits";
import { bit, isSingle, valueOf } from "../../lib/grid-kit/csp";
import { fades } from "../../lib/grid-kit/fade";
import type { Focus } from "../../lib/grid-kit/names";
import {
  KIT_CSS, SIZE, cursorRect, drawFocus, focusCells, focusLegend, frame, sample, sampleCell,
  type BoardPrefs,
} from "../../lib/grid-kit/view";
import {
  DIGIT_MASK, kakuro,
  type KakuroAction, type KakuroConflicts, type KakuroInteraction, type KakuroPuzzle, type KakuroState,
} from "./logic";

/** Derived: KakuroConflicts to flag on the board. */
export const CONFLICTS_KEY = "kakuro.conflicts";

const CSS = `
.kakuro-board .wall { fill: var(--text); }
.kakuro-board .slash { stroke: var(--bg); stroke-width: 0.3; }
.kakuro-board .sum { fill: var(--bg); font: 600 3.2px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.kakuro-board .sel { fill: var(--accent-soft); }
.kakuro-board .bad { fill: var(--danger-soft); }
.kakuro-board .num { fill: var(--accent); font: 500 6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.kakuro-board .num.bad { fill: var(--danger); }
.kakuro-board .pencil { fill: var(--text-dim); font: 500 2.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
`;

const BINDINGS = {
  "kakuro.clear": { label: "clear cells", category: "kakuro", keys: ["Backspace", "Delete", "0"], description: "rub out the digits and notes in the selected cells" },
  "kakuro.notes": { label: "notes on / off", category: "kakuro", keys: ["n"], description: "while on, typing a digit toggles it as a small note instead of placing it" },
} satisfies BindingSchema;

const DIRS = ["left", "right", "up", "down"] as const;
type Dir = (typeof DIRS)[number];
const DIR_KEY: Record<Dir, string> = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };
const DIR_STEP: Record<Dir, readonly [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

const MOVE_BINDINGS = {
  ...bindingsOver("kakuro.", DIRS, (id) => ({ label: `cursor ${id}`, category: "kakuro", keys: [DIR_KEY[id]], description: `move the selection one cell ${id}` })),
  ...bindingsOver("kakuro.extend-", DIRS, (id) => ({ label: `extend selection ${id}`, category: "kakuro", keys: [`shift+${DIR_KEY[id]}`], description: `add the cell ${id === "up" ? "above" : id === "down" ? "below" : `to the ${id}`} to the selection` })),
};

const DIGIT_BINDINGS = bindingsOver("kakuro.d", DIGITS, (n) => ({ label: `${n}`, category: "kakuro", keys: [String(n)], description: `put ${n} in the selected cells (or toggle it as a note while notes are on)` }));

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS>, Ids<typeof MOVE_BINDINGS>, Ids<typeof DIGIT_BINDINGS> {}
}

export const digitCommand = (n: Digit): `kakuro.d${Digit}` => `kakuro.d${n}`;

/** The keys this view adds to the command context. */
export interface KakuroContext {
  kakuroNotes: boolean;
}

declare module "../../core/types" {
  interface CommandContext extends Partial<KakuroContext> {}
}

function legend(): { sample: string; meaning: string }[] {
  const num = (n: number, fill = "var(--accent)") => `<text x="5" y="5.3" fill="${fill}" font-size="6" font-weight="500" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${n}</text>`;
  const clue = (across: string, down: string) => `<rect width="10" height="10" fill="var(--text)"/><line x1="0" y1="0" x2="10" y2="10" stroke="var(--bg)" stroke-width="0.3"/>`
    + `<text x="7" y="3" fill="var(--bg)" font-size="3.2" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${across}</text>`
    + `<text x="3" y="7" fill="var(--bg)" font-size="3.2" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${down}</text>`;
  return [
    { sample: sample(clue("16", "")), meaning: "a sum above the line: the white cells to its right add up to it" },
    { sample: sample(clue("", "7")), meaning: "a sum below the line: the white cells under it add up to it" },
    { sample: sample(sampleCell() + num(3)), meaning: "a digit you placed" },
    { sample: sample(sampleCell() + `<text x="2" y="2.2" fill="var(--text-dim)" font-size="2.6" text-anchor="middle" dominant-baseline="central">1</text><text x="8" y="2.2" fill="var(--text-dim)" font-size="2.6" text-anchor="middle" dominant-baseline="central">3</text>`), meaning: "notes: the digits a cell could still be" },
    { sample: sample(`<rect width="10" height="10" fill="var(--accent-soft)" stroke="var(--border)" stroke-width="0.25"/>`), meaning: "selected: typed digits go here" },
    { sample: sample(`<rect width="10" height="10" fill="var(--danger-soft)" stroke="var(--border)" stroke-width="0.25"/>` + num(2, "var(--danger)")), meaning: "a digit repeated in its run, or a run whose digits don't add up" },
    ...focusLegend("the cells it changes", "the cells and sums it comes from", "other cells it mentions"),
  ];
}

export function kakuroView(board: BoardPrefs): View<KakuroPuzzle, KakuroState, KakuroAction, KakuroInteraction> {
  return {
    id: "kakuro.svg",
    name: "grid",
    puzzle: kakuro,
    controls: [
      { how: "click or tap a white cell", what: "select it; drag to select several. type a digit (or use the number pad) to fill them" },
      { how: "shift-click", what: "add a cell to the selection" },
    ],
    legend: legend(),
    mount(root, { session }) {
      style("kit", KIT_CSS);
      style("kakuro", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const f = frame(root, p, "kakuro-board", "kakuro", board);
      const fade = fades(f);
      const tint: SVGRectElement[] = [];
      for (let c = 0; c < n; c++) {
        const x = f.cx(c), y = f.cy(c);
        if (!p.white[c]) {
          const wall = s("rect", { x, y, width: SIZE, height: SIZE, class: "wall" });
          f.base.append(wall);
          f.anchor(c, wall);
          if (p.across[c] || p.down[c]) {
            f.base.append(s("line", { x1: x, y1: y, x2: x + SIZE, y2: y + SIZE, class: "slash" }));
            if (p.across[c]) f.base.append(s("text", { x: x + 7, y: y + 3, class: "sum" }, String(p.across[c])));
            if (p.down[c]) f.base.append(s("text", { x: x + 3, y: y + 7, class: "sum" }, String(p.down[c])));
          }
          continue;
        }
        const cell = s("rect", { x, y, width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.base.append(tint[c] = s("rect", { x, y, width: SIZE, height: SIZE, visibility: "hidden" }));
      }
      const placeCursor = cursorRect(f);
      let preview: KakuroState | null = null;
      let hover = -1;

      const drawCell = (el: Element, c: number, mask: number, bad: boolean) => {
        const x = f.cx(c), y = f.cy(c);
        if (isSingle(mask)) {
          el.append(s("text", { x: x + SIZE / 2, y: y + SIZE / 2 + 0.3, class: `num${bad ? " bad" : ""}` }, String(valueOf(mask))));
        } else if (mask !== DIGIT_MASK) {
          for (let v = 1; v <= 9; v++) {
            if (!(mask & bit(v))) continue;
            el.append(s("text", { x: x + 2 + ((v - 1) % 3) * 3, y: y + 2.2 + Math.floor((v - 1) / 3) * 3, class: "pencil" }, String(v)));
          }
        }
      };

      const render = () => {
        const doms = session.state.doms;
        const conflicts = session.derived()[CONFLICTS_KEY] as KakuroConflicts | undefined;
        const bad = new Set([...(conflicts?.repeats ?? []), ...(conflicts?.sums ?? [])]);
        const sel = new Set(session.interaction.selection);
        for (let c = 0; c < n; c++) {
          if (!p.white[c]) continue;
          const cls = bad.has(c) ? "bad" : sel.has(c) ? "sel" : "";
          tint[c]!.setAttribute("class", cls);
          tint[c]!.setAttribute("visibility", cls ? "visible" : "hidden");
        }
        while (f.marks.firstChild) f.marks.firstChild.remove();
        for (let c = 0; c < n; c++) if (p.white[c]) drawCell(f.marks, c, doms[c]!, bad.has(c));
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) {
          for (let c = 0; c < n; c++) {
            if (!p.white[c] || preview.doms[c] === doms[c]) continue;
            if (doms[c] !== DIGIT_MASK) fade.cell(c);
            drawCell(f.ghost, c, preview.doms[c]!, false);
          }
        }
        while (f.over.firstChild) f.over.firstChild.remove();
        drawFocus(f.over, f, session.activeHint?.focus as Focus | undefined);
        placeCursor(session.interaction.cursor);
      };

      let pointerId = -1;
      const select = (c: number, add: boolean) =>
        session.setInteraction((i) => ({ ...i, cursor: c, selection: add ? (i.selection.includes(c) ? i.selection : [...i.selection, c]) : [c] }));
      const listeners: [string, EventListener][] = [
        ["pointerdown", ((ev: PointerEvent) => {
          const c = f.cellAt(ev);
          if (c < 0 || pointerId !== -1) return;
          ev.preventDefault();
          pointerId = ev.pointerId;
          f.svg.setPointerCapture?.(ev.pointerId);
          select(c, ev.shiftKey);
        }) as EventListener],
        ["pointermove", ((ev: PointerEvent) => {
          const c = f.cellAt(ev);
          if (ev.pointerId !== pointerId) {
            if (ev.pointerType !== "touch") hover = c;
            return;
          }
          if (c >= 0 && p.white[c] && !session.interaction.selection.includes(c)) select(c, true);
        }) as EventListener],
        ["pointerup", ((ev: PointerEvent) => { if (ev.pointerId === pointerId) pointerId = -1; }) as EventListener],
        ["pointercancel", ((ev: PointerEvent) => { if (ev.pointerId === pointerId) pointerId = -1; }) as EventListener],
        ["pointerleave", ((ev: PointerEvent) => { if (ev.pointerType !== "touch") hover = -1; }) as EventListener],
      ];
      for (const [type, fn] of listeners) f.svg.addEventListener(type, fn);

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const targets = () => {
        const sel = session.interaction.selection;
        return (sel.length ? sel : [session.interaction.cursor]).filter((c) => p.white[c]);
      };
      const step = (id: Dir, extend: boolean) => () => {
        const [dx, dy] = DIR_STEP[id];
        const c = session.interaction.cursor;
        const x = Math.min(p.w - 1, Math.max(0, (c % p.w) + dx)), y = Math.min(p.h - 1, Math.max(0, Math.floor(c / p.w) + dy));
        select(y * p.w + x, extend);
      };
      const commands: CommandDef[] = bindCommands({ ...BINDINGS, ...MOVE_BINDINGS, ...DIGIT_BINDINGS }, {
        "kakuro.clear": () => {
          const cells = targets();
          if (cells.length && !session.locked) session.dispatch({ type: "clear", cells });
        },
        "kakuro.notes": () => session.setInteraction((i) => ({ ...i, candidates: !i.candidates })),
        ...handlersOver("kakuro.", DIRS, (id) => step(id, false)),
        ...handlersOver("kakuro.extend-", DIRS, (id) => step(id, true)),
        ...handlersOver("kakuro.d", DIGITS, (d) => () => {
          const cells = targets();
          if (!cells.length || session.locked) return;
          session.dispatch(session.interaction.candidates ? { type: "toggle", cells, value: d } : { type: "set", cells, mask: bit(d) });
        }),
      }, {
        "kakuro.clear": { menu: "board" },
        "kakuro.notes": { menu: "board", checked: () => session.interaction.candidates },
      });
      return {
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        context: (): KakuroContext => ({ kakuroNotes: session.interaction.candidates }),
        target: () => (hover >= 0 ? hover : session.interaction.cursor),
        preview: (st) => {
          preview = st as KakuroState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as KakuroState).doms, y = (b as KakuroState).doms;
          return f.rects(x.flatMap((m, c) => (m !== y[c] ? [c] : [])));
        },
        destroy() {
          for (const [type, fn] of listeners) f.svg.removeEventListener(type, fn);
          offs.forEach((o) => o());
          f.destroy();
        },
      };
    },
  };
}
