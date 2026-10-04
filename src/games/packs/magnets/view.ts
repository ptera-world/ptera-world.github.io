import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { bit, isSingle, popcount } from "../../lib/grid-kit/csp";
import type { Focus } from "../../lib/grid-kit/names";
import {
  KIT_CSS, SIZE, Strokes, cursorBindings, cursorHandlers, cursorRect, drawFocus, focusCells, focusLegend, frame, sample, sampleCell,
  type BoardPrefs,
} from "../../lib/grid-kit/view";
import { fades } from "../../lib/grid-kit/fade";
import {
  BLANK, FULL, MAGNET, MINUS, NEUTRAL, PLUS, cellSigns, geometry, shownSigns, targets, valueFor,
  type MagnetsAction, type MagnetsConflicts, type MagnetsInteraction, type MagnetsPuzzle, type MagnetsState,
} from "./logic";

/** Derived: MagnetsConflicts to flag on the board. */
export const CONFLICTS_KEY = "magnets.conflicts";

const CSS = `
.magnets-board .domino { fill: var(--cell); stroke: var(--text-dim); stroke-width: 0.5; }
.magnets-board .domino.magnet { fill: var(--surface-2); stroke: var(--text); }
.magnets-board .domino.blank { fill: var(--bg); stroke: var(--border); }
.magnets-board .lone { fill: var(--bg); stroke: var(--border); stroke-width: 0.25; }
.magnets-board .sign { fill: var(--text); font: 700 7.5px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.magnets-board .sign.bad { fill: var(--danger); }
.magnets-board .cross { stroke: var(--text-dim); stroke-width: 0.5; stroke-linecap: round; }
.magnets-board .pencil { fill: var(--text-dim); font: 600 3.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.magnets-board .clue { fill: var(--text); font: 600 5px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.magnets-board .clue.done { opacity: var(--done-opacity); }
.magnets-board .clue.bad { fill: var(--danger); }
.magnets-board .corner { fill: var(--text-dim); font: 700 6px var(--font); text-anchor: middle; dominant-baseline: central; }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold to mark a blank (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const BINDINGS: BindingSchema = {
  "magnets.cycle": { label: "cycle plus / minus / empty", category: "magnets", keys: ["space"], description: "the selected cell goes plus → minus → empty; its domino's other end follows" },
  "magnets.cycle-blank": { label: "cycle blank / magnet / empty", category: "magnets", keys: ["Enter"], description: "the selected cell's domino goes blank → magnet (not yet turned) → empty" },
  "magnets.plus": { label: "plus", category: "magnets", keys: ["equal", "shift+equal"], description: "make the selected cell a plus end" },
  "magnets.minus": { label: "minus", category: "magnets", keys: ["minus"], description: "make the selected cell a minus end" },
  "magnets.blank": { label: "blank domino", category: "magnets", keys: ["0", "x"], description: "mark the selected cell's domino blank" },
  "magnets.magnet": { label: "magnet, not turned yet", category: "magnets", keys: ["m"], description: "mark the selected cell's domino as a magnet without saying which end is plus" },
  "magnets.clear": { label: "clear domino", category: "magnets", keys: ["Backspace", "Delete"], description: "forget everything marked on the selected cell's domino" },
  ...cursorBindings("magnets", "magnets"),
};

/** Stroke intents: what a press does to the pressed cell. */
const CLEAR = 0, SET_PLUS = 1, SET_MINUS = 2, SET_BLANK = 3, SET_MAGNET = 4;

const GLYPH = ["×", "+", "−"];

function legend(): { sample: string; meaning: string }[] {
  const dom = (cls: string) => `<rect x="0.8" y="0.8" width="18.4" height="8.4" rx="2" ${cls}/>`;
  const plain = `fill="var(--cell)" stroke="var(--text-dim)" stroke-width="0.5"`;
  const magnet = `fill="var(--surface-2)" stroke="var(--text)" stroke-width="0.5"`;
  const glyph = (x: number, t: string, fill = "var(--text)") => `<text x="${x}" y="5.2" fill="${fill}" font-size="7.5" font-weight="700" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  const pencil = (x: number, t: string) => `<text x="${x}" y="2.6" fill="var(--text-dim)" font-size="3.4" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  const cross = (x: number) => `<path d="M${x - 2} 3 L${x + 2} 7 M${x + 2} 3 L${x - 2} 7" stroke="var(--text-dim)" stroke-width="0.5"/>`;
  return [
    { sample: sample(sampleCell() + sampleCell(10) + dom(plain), 2), meaning: "a domino you haven't decided yet" },
    { sample: sample(sampleCell() + sampleCell(10) + dom(magnet) + glyph(5, "+") + glyph(15, "−"), 2), meaning: "a magnet: one plus end and one minus end" },
    { sample: sample(sampleCell() + sampleCell(10) + `<rect x="0.8" y="0.8" width="18.4" height="8.4" rx="2" fill="var(--bg)" stroke="var(--border)" stroke-width="0.5"/>` + cross(5) + cross(15), 2), meaning: "a blank domino" },
    { sample: sample(sampleCell() + sampleCell(10) + dom(magnet) + pencil(5, "+−") + pencil(15, "+−"), 2), meaning: "a magnet you haven't turned yet; small signs are what a cell can still be (× blank)" },
    { sample: sample(sampleCell() + sampleCell(10) + dom(plain) + pencil(5, "+×") + pencil(15, "−×"), 2), meaning: "small signs: a cell that can only be one of these" },
    { sample: sample(`<rect width="10" height="10" fill="var(--bg)" stroke="var(--border)" stroke-width="0.25"/>`), meaning: "a lone cell: always blank" },
    { sample: sample(sampleCell() + sampleCell(10) + dom(magnet) + glyph(5, "+", "var(--danger)") + glyph(15, "−"), 2), meaning: "an end touching a like pole" },
    { sample: sample(`<text x="5" y="5.2" fill="var(--text)" font-size="5" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="var(--font)">2</text>`), meaning: "numbers at the top and left count plus ends, at the bottom and right minus ends (faded when met, red when they can't be)" },
    ...focusLegend("the dominoes it changes", "the end it comes from", "the line or cells it's about"),
  ];
}

export function magnetsView(board: BoardPrefs): View<MagnetsPuzzle, MagnetsState, MagnetsAction, MagnetsInteraction> {
  return {
    id: "magnets.svg",
    name: "grid",
    puzzle: "magnets",
    settings,
    controls: [
      { how: "click or tap a cell", what: "make it plus, then minus, then empty again; the other end of its domino follows. drag to do several" },
      { how: "right-click, or hold on a touch screen", what: "mark its domino blank, then magnet (not turned yet), then empty" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("magnets", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const f = frame(root, p, "magnets-board", "magnets", board, { top: 1, right: 1, bottom: 1, left: 1 });
      const fade = fades(f);
      for (let c = 0; c < g.n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: g.domOf[c]! < 0 ? "lone" : "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
      }
      const domEls = g.dominoes.map(([a, b]) => {
        const x = Math.min(f.cx(a), f.cx(b)), y = Math.min(f.cy(a), f.cy(b));
        const horiz = f.cy(a) === f.cy(b);
        const el = s("rect", { x: x + 0.8, y: y + 0.8, width: (horiz ? 2 : 1) * SIZE - 1.6, height: (horiz ? 1 : 2) * SIZE - 1.6, rx: 2, class: "domino" });
        f.base.append(el);
        return el;
      });
      // clues: plus on top and left, minus on bottom and right
      const clueEls: SVGTextElement[][] = g.lines.map(() => []);
      const clue = (li: number, si: number, x: number, y: number) => {
        const v = targets(p, li)[si]!;
        if (v < 0) return;
        const el = s("text", { x, y, class: "clue" }, String(v));
        f.base.append(el);
        clueEls[li]![si] = el;
      };
      for (let y = 0; y < p.h; y++) {
        clue(y, 0, -SIZE / 2, y * SIZE + SIZE / 2 + 0.2);
        clue(y, 1, p.w * SIZE + SIZE / 2, y * SIZE + SIZE / 2 + 0.2);
      }
      for (let x = 0; x < p.w; x++) {
        clue(p.h + x, 0, x * SIZE + SIZE / 2, -SIZE / 2 + 0.2);
        clue(p.h + x, 1, x * SIZE + SIZE / 2, p.h * SIZE + SIZE / 2 + 0.2);
      }
      f.base.append(s("text", { x: -SIZE / 2, y: -SIZE / 2 + 0.3, class: "corner" }, "+"), s("text", { x: p.w * SIZE + SIZE / 2, y: p.h * SIZE + SIZE / 2 + 0.3, class: "corner" }, "−"));
      const holders = Array.from({ length: g.n }, () => {
        const h = s("g");
        f.marks.append(h);
        return h;
      });
      const placeCursor = cursorRect(f);
      let preview: MagnetsState | null = null;

      const drawCell = (el: Element, c: number, mask: number, bad: boolean) => {
        const sm = cellSigns(g, c, mask);
        const cx = f.cx(c) + SIZE / 2, cy = f.cy(c) + SIZE / 2;
        if (sm === bit(BLANK)) {
          el.append(s("path", { d: `M${cx - 2} ${cy - 2} L${cx + 2} ${cy + 2} M${cx + 2} ${cy - 2} L${cx - 2} ${cy + 2}`, class: "cross" }));
        } else if (isSingle(sm)) {
          el.append(s("text", { x: cx, y: cy + 0.2, class: `sign${bad ? " bad" : ""}` }, GLYPH[sm === bit(PLUS) ? PLUS : MINUS]!));
        } else if (popcount(sm) === 2) {
          const text = [PLUS, MINUS, BLANK].filter((v) => sm & bit(v)).map((v) => GLYPH[v]).join("");
          el.append(s("text", { x: cx, y: f.cy(c) + 2.6, class: "pencil" }, text));
        }
      };

      const domAt = (c: number) => g.domOf[c]!;
      const intentFor = (c: number, kind: "primary" | "secondary"): number => {
        const d = domAt(c);
        const m = session.state.doms[d]!;
        const sm = cellSigns(g, c, m);
        if (kind === "primary") return sm === bit(PLUS) ? SET_MINUS : sm === bit(MINUS) ? CLEAR : SET_PLUS;
        return m === bit(NEUTRAL) ? SET_MAGNET : m === MAGNET ? CLEAR : SET_BLANK;
      };
      const maskFor = (c: number, intent: number): number =>
        intent === SET_PLUS ? bit(valueFor(g, c, PLUS)) : intent === SET_MINUS ? bit(valueFor(g, c, MINUS)) : intent === SET_BLANK ? bit(NEUTRAL) : intent === SET_MAGNET ? MAGNET : FULL;
      const apply = (cells: number[], intent: number) => {
        const byMask = new Map<number, number[]>();
        for (const c of cells) {
          const d = domAt(c);
          if (d < 0) continue;
          const m = maskFor(c, intent);
          for (const [k, list] of byMask) if (k !== m) byMask.set(k, list.filter((x) => x !== d));
          byMask.set(m, [...(byMask.get(m) ?? []).filter((x) => x !== d), d]);
        }
        session.batch(() => {
          for (const [mask, doms] of byMask) if (doms.length) session.dispatch({ type: "set", doms, mask });
        });
      };

      const strokes = new Strokes(f, session, {
        editable: (c) => domAt(c) >= 0,
        mark: (c) => session.state.doms[domAt(c)]! * 8 + cellSigns(g, c, session.state.doms[domAt(c)]!),
        next: (c, kind) => intentFor(c, kind),
        commit: (cells, intent) => apply(cells, intent),
        redraw: () => render(),
        holdMs: () => settings.longPressMs as number,
      });

      /** Masks with the stroke in progress applied. */
      const shownMasks = (): number[] => {
        const out = session.state.doms.slice();
        const st = strokes.stroke;
        if (st) for (const c of st.cells) if (domAt(c) >= 0) out[domAt(c)] = maskFor(c, st.value);
        return out;
      };

      const render = () => {
        const doms = shownMasks();
        const bad = session.derived()[CONFLICTS_KEY] as MagnetsConflicts | undefined;
        const poles = new Set(bad?.poles);
        g.dominoes.forEach((_, d) => {
          const m = doms[d]!;
          domEls[d]!.setAttribute("class", `domino${m === bit(NEUTRAL) ? " blank" : !(m & bit(NEUTRAL)) ? " magnet" : ""}`);
        });
        for (let c = 0; c < g.n; c++) {
          const h = holders[c]!;
          while (h.firstChild) h.firstChild.remove();
          if (domAt(c) >= 0) drawCell(h, c, doms[domAt(c)]!, poles.has(c));
        }
        const signs = shownSigns(p, doms);
        const badCounts = new Set(bad?.counts);
        g.lines.forEach((line, li) => {
          targets(p, li).forEach((t, si) => {
            const el = clueEls[li]![si];
            if (!el) return;
            const have = line.filter((c) => signs[c] === (si === 0 ? PLUS : MINUS)).length;
            el.classList.toggle("bad", badCounts.has(li * 2 + si));
            el.classList.toggle("done", have === t && !badCounts.has(li * 2 + si));
          });
        });
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) {
          for (let c = 0; c < g.n; c++) {
            const d = domAt(c);
            if (d < 0 || preview.doms[d] === doms[d]) continue;
            if (doms[d] !== FULL) fade.cell(c);
            drawCell(f.ghost, c, preview.doms[d]!, false);
          }
        }
        while (f.over.firstChild) f.over.firstChild.remove();
        drawFocus(f.over, f, session.activeHint?.focus as Focus | undefined);
        placeCursor(session.interaction.cursor);
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) strokes.cancel();
          render();
        }, { owner: "view" }),
      ];
      render();

      const atCursor = (intent: (c: number) => number) => () => {
        const c = session.interaction.cursor;
        if (domAt(c) >= 0) apply([c], intent(c));
      };
      const commands = bindCommands(BINDINGS, {
        "magnets.cycle": atCursor((c) => intentFor(c, "primary")),
        "magnets.cycle-blank": atCursor((c) => intentFor(c, "secondary")),
        "magnets.plus": atCursor(() => SET_PLUS),
        "magnets.minus": atCursor(() => SET_MINUS),
        "magnets.blank": atCursor(() => SET_BLANK),
        "magnets.magnet": atCursor(() => SET_MAGNET),
        "magnets.clear": atCursor(() => CLEAR),
        ...cursorHandlers("magnets", p, session),
      }, {
        "magnets.plus": { menu: "board" },
        "magnets.minus": { menu: "board" },
        "magnets.blank": { menu: "board" },
        "magnets.magnet": { menu: "board" },
        "magnets.clear": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: f.aspect,
        cells: { cols: p.w + 2, rows: p.h + 2 },
        commands,
        target: () => strokes.target(),
        preview: (st) => {
          preview = st as MagnetsState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as MagnetsState).doms, y = (b as MagnetsState).doms;
          return f.rects(g.dominoes.flatMap((cells, d) => (x[d] !== y[d] ? cells : [])));
        },
        destroy() {
          strokes.destroy();
          offs.forEach((o) => o());
          f.destroy();
        },
      };
    },
  };
}
