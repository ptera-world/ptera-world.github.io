import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { secondary } from "../../core/gestures";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { EMPTY, GHOST, MIRROR_L, VAMPIRE, ZOMBIE, bit, clueAt, geometry } from "./grid";
import {
  undead, sightCountsOf,
  type Conflicts, type UndeadAction, type UndeadFocus, type UndeadInteraction, type UndeadPuzzle, type UndeadState,
} from "./logic";
import type { UndeadTarget } from "./techniques";
import { themedAssets } from "../../lib/assets";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "undead.conflicts";

/** Themed graphics this view draws, in a 10×10 cell box. */
export const ASSETS = {
  ghost: `<svg viewBox="0 0 10 10"><path d="M2.6 8.6V4.6a2.4 2.4 0 0 1 4.8 0v4l-.8-.7-.8.7-.8-.7-.8.7-.8-.7z" fill="color-mix(in srgb, var(--text) 12%, var(--cell))" stroke="var(--text)" stroke-width=".45" stroke-linejoin="round"/><circle cx="4.2" cy="4.8" r=".45" fill="var(--text)"/><circle cx="5.8" cy="4.8" r=".45" fill="var(--text)"/></svg>`,
  vampire: `<svg viewBox="0 0 10 10"><path d="M1.6 8.8 5 2.4l3.4 6.4z" fill="hsl(350 55% 40%)"/><circle cx="5" cy="5.4" r="1.9" fill="hsl(30 30% 88%)" stroke="hsl(350 55% 30%)" stroke-width=".3"/><path d="M3.3 4.6 5 3.6l1.7 1-1.7-.2z" fill="hsl(350 30% 15%)"/><path d="M4.3 6.4l.25.8.25-.8zM5.2 6.4l.25.8.25-.8z" fill="#fff"/></svg>`,
  zombie: `<svg viewBox="0 0 10 10"><rect x="2.7" y="2.4" width="4.6" height="5.4" rx=".9" fill="hsl(100 35% 45%)" stroke="hsl(100 35% 25%)" stroke-width=".3"/><path d="M3.6 4.1l.9.9M4.5 4.1l-.9.9M5.5 4.1l.9.9M6.4 4.1l-.9.9M3.8 6.6h2.4M4.3 6.3v.6M5 6.3v.6M5.7 6.3v.6" stroke="hsl(100 35% 15%)" stroke-width=".3" fill="none"/></svg>`,
} as const;

export type Look = { asset(id: string, fallback: string): string };

const CSS = `
.undead-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.undead-board .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.undead-board .cell.path { fill: color-mix(in srgb, var(--accent) 16%, var(--cell)); }
.undead-board .mirror { stroke: var(--text); stroke-width: 0.8; stroke-linecap: round; pointer-events: none; }
.undead-board .given { fill: var(--surface-2, var(--cell)); }
.undead-board .clue { fill: var(--text); font: 600 4.4px var(--font); text-anchor: middle; dominant-baseline: central; }
.undead-board .clue.done { opacity: var(--done-opacity); }
.undead-board .clue.bad { fill: var(--danger); opacity: 1; }
.undead-board .clue-hit { fill: transparent; cursor: pointer; }
.undead-board .total { fill: var(--text); font: 500 3.6px var(--font); dominant-baseline: central; }
.undead-board .total.bad { fill: var(--danger); }
.undead-board .total.done { opacity: var(--done-opacity); }
.undead-board .monster, .undead-board .pencil { pointer-events: none; }
.undead-board .monster.preview { opacity: 0.5; }
.undead-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.undead-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.undead-board .labels text { fill: var(--text-dim); font: 500 3.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.undead-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .undead-board .cursor { display: none; }
`;

const settings = defineSchema({
  trace: { type: "bool", label: "show a number's line of sight when pointing at it", default: true },
  dimDone: { type: "bool", label: "fade numbers whose line is full and right", default: true },
});

const SIZE = 10;
const LABEL = 5;
/** Height of the monster totals band above the clues. */
const BAND = 7;

const BINDINGS = {
  "undead.ghost": { label: "ghost", category: "undead", keys: ["g", "1"], description: "put a ghost in the selected cell (or a ghost pencil mark, in pencil mode). again to remove it" },
  "undead.vampire": { label: "vampire", category: "undead", keys: ["v", "2"], description: "put a vampire in the selected cell (or a pencil mark). again to remove it" },
  "undead.zombie": { label: "zombie", category: "undead", keys: ["z", "3"], description: "put a zombie in the selected cell (or a pencil mark). again to remove it" },
  "undead.clear": { label: "clear cell", category: "undead", keys: ["Backspace", "Delete", "0"], description: "remove the monster or pencil marks from the selected cell" },
  "undead.pencil": { label: "pencil mode", category: "undead", keys: ["p"], description: "while on, typed monsters go in as small pencil marks: your notes of what a cell could still be" },
  "undead.pencil-ghost": { label: "pencil mark: ghost", category: "undead", keys: ["shift+g"], description: "toggle a ghost pencil mark in the selected cell" },
  "undead.pencil-vampire": { label: "pencil mark: vampire", category: "undead", keys: ["shift+v"], description: "toggle a vampire pencil mark in the selected cell" },
  "undead.pencil-zombie": { label: "pencil mark: zombie", category: "undead", keys: ["shift+z"], description: "toggle a zombie pencil mark in the selected cell" },
  "undead.left": { label: "cursor left", category: "undead", keys: ["ArrowLeft", "a"] },
  "undead.right": { label: "cursor right", category: "undead", keys: ["ArrowRight", "d"] },
  "undead.up": { label: "cursor up", category: "undead", keys: ["ArrowUp", "w"] },
  "undead.down": { label: "cursor down", category: "undead", keys: ["ArrowDown", "s"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

function inner(markup: string): string {
  const t = markup.trim();
  return t.startsWith("<svg") ? t.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "") : `<image href="${t}" width="10" height="10"/>`;
}

function legend(look: Look): { sample: string; meaning: string }[] {
  const svg = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;
  const cell = (fill = "var(--cell)") => `<rect width="10" height="10" fill="${fill}" stroke="var(--border)" stroke-width="0.25"/>`;
  const art = themedAssets(look, "undead", ASSETS);
  const mon = (id: keyof typeof ASSETS) => inner(art(id));
  const small = (id: keyof typeof ASSETS, x: number, y: number) => `<g transform="translate(${x} ${y}) scale(0.42)">${mon(id)}</g>`;
  const num = (n: number, fill = "var(--text)", op = "1") => `<text x="5" y="5.3" fill="${fill}" style="opacity:${op}" font-size="4.4" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${n}</text>`;
  return [
    { sample: svg(cell() + mon("ghost")), meaning: "a ghost: only seen in a mirror (after the sight line bounces)" },
    { sample: svg(cell() + mon("vampire")), meaning: "a vampire: only seen directly (before the sight line bounces)" },
    { sample: svg(cell() + mon("zombie")), meaning: "a zombie: always seen" },
    { sample: svg(cell() + `<line x1="2" y1="2" x2="8" y2="8" stroke="var(--text)" stroke-width="0.8" stroke-linecap="round"/>`), meaning: "a mirror: sight lines bounce off it (both sides)" },
    { sample: svg(num(2)), meaning: "a sight count: how many monsters you'd see looking in from here" },
    { sample: svg(num(2, "var(--text)", "var(--done-opacity)")), meaning: "a faded count: its line is full and sees exactly this many" },
    { sample: svg(num(2, "var(--danger)")), meaning: "a count that can't be met any more" },
    { sample: svg(cell("var(--surface-2, var(--cell))") + mon("zombie")), meaning: "a monster shown from the start" },
    { sample: svg(cell() + small("ghost", 0.4, 0.4) + small("zombie", 2.9, 5.6)), meaning: "pencil marks: your notes of what a cell could still be" },
    { sample: svg(cell("color-mix(in srgb, var(--accent) 16%, var(--cell))")), meaning: "the line of sight of the count you're pointing at" },
    { sample: svg(cell() + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.9"/>`), meaning: "hint: a cell it changes" },
    { sample: svg(cell() + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.6" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the reason (a count, a total, or other cells)" },
    { sample: svg(cell() + `<rect x="0.3" y="0.3" width="9.4" height="9.4" rx="1" fill="none" stroke="var(--focus)" stroke-width="0.6"/>`), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

const KIND = ["", "ghost", "vampire", "zombie"] as const;

/** The keys this view adds to the command context. */
export interface UndeadContext {
  undeadPencil: boolean;
}

declare module "../../core/types" {
  interface CommandContext extends Partial<UndeadContext> {}
}

export function undeadView(look: Look, board: Board): View<UndeadPuzzle, UndeadState, UndeadAction, UndeadInteraction, typeof settings> {
  return {
    id: "undead.svg",
    name: "grid",
    puzzle: undead,
    settings,
    controls: [
      { how: "click or tap a cell", what: "cycle it through ghost, vampire, zombie and empty" },
      { how: "right-click a cell", what: "cycle it the other way" },
      { how: "point at, click or tap a number on the edge", what: "shows its line of sight; a click or tap keeps it shown until you click elsewhere or press Esc" },
    ],
    get legend() {
      return legend(look);
    },
    mount(root, { session, settings }) {
      style("undead", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const art = themedAssets(look, "undead", ASSETS);
      const icon = (m: number) => inner(art(KIND[m] as keyof typeof ASSETS));
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : 0);
      const left = SIZE + m("left"), top = SIZE + BAND + m("top");
      const vbW = (p.w + 2) * SIZE + m("left") + m("right"), vbH = (p.h + 2) * SIZE + BAND + m("top") + m("bottom");
      const svg = s("svg", { viewBox: `${-left} ${-top} ${vbW} ${vbH}`, class: "undead-board", role: "grid", "aria-label": `undead, ${p.w} by ${p.h}` });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -SIZE - LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: (p.h + 1) * SIZE + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -SIZE - LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: (p.w + 1) * SIZE + LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      const base = s("g"), monL = s("g"), clueL = s("g"), band = s("g"), over = s("g");
      const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
      svg.append(labels, base, monL, clueL, band, over, cursor);
      root.append(svg);

      const cx = (c: number) => (c % p.w) * SIZE;
      const cy = (c: number) => Math.floor(c / p.w) * SIZE;
      const tiles: SVGRectElement[] = [];
      const holders: SVGGElement[] = [];
      for (let c = 0; c < g.n; c++) {
        base.append(tiles[c] = s("rect", { x: cx(c), y: cy(c), width: SIZE, height: SIZE, class: p.given[c] ? "cell given" : "cell" }));
        if (p.cells[c] !== EMPTY) {
          const l = p.cells[c] === MIRROR_L;
          base.append(s("line", { x1: cx(c) + 2, y1: cy(c) + (l ? 2 : 8), x2: cx(c) + 8, y2: cy(c) + (l ? 8 : 2), class: "mirror" }));
        }
        monL.append(holders[c] = s("g", { transform: `translate(${cx(c)} ${cy(c)})` }));
      }
      const clueText: SVGTextElement[] = [];
      const cluePos = (i: number) => {
        const a = clueAt(p.w, p.h, i);
        return { x: a.x * SIZE + SIZE / 2, y: a.y * SIZE + SIZE / 2 };
      };
      for (let i = 0; i < p.clues.length; i++) {
        const { x, y } = cluePos(i);
        clueL.append(s("rect", { x: x - SIZE / 2, y: y - SIZE / 2, width: SIZE, height: SIZE, class: "clue-hit", "data-clue": i }));
        clueL.append(clueText[i] = s("text", { x, y: y + 0.3, class: "clue" }, String(p.clues[i])));
      }
      const totals: SVGTextElement[] = [];
      const bandY = -SIZE - BAND / 2;
      const span = (p.w * SIZE) / 3;
      [GHOST, VAMPIRE, ZOMBIE].forEach((mon, j) => {
        const x0 = j * span + span / 2 - 7;
        const ic = s("g", { transform: `translate(${x0} ${bandY - 3.2}) scale(0.64)` });
        ic.innerHTML = icon(mon);
        band.append(ic, totals[mon] = s("text", { x: x0 + 7, y: bandY, class: "total" }));
      });

      let hoverCell = -1, hoverClue = -1, pinClue = -1;
      let preview: UndeadState | null = null;
      const drawn: string[] = [];

      const render = () => {
        const st = session.state;
        const conf = session.derived()[CONFLICTS_KEY] as Conflicts | undefined;
        const badClues = new Set(conf?.clues), badTotals = new Set(conf?.totals);
        const sights = sightCountsOf(p, st.monsters);
        const lit = pinClue >= 0 ? pinClue : hoverClue;
        const path = settings.trace && lit >= 0 ? new Set(g.trace[lit]) : null;
        for (let c = 0; c < g.n; c++) {
          tiles[c]!.classList.toggle("path", !!path?.has(c));
          if (p.cells[c] !== EMPTY) continue;
          const pv = preview && (preview.monsters[c] !== st.monsters[c] || preview.marks[c] !== st.marks[c]) ? preview : null;
          const mon = (pv ?? st).monsters[c]!, marks = (pv ?? st).marks[c]!;
          const key = `${mon}|${marks}|${pv ? 1 : 0}`;
          if (drawn[c] === key) continue;
          drawn[c] = key;
          const hd = holders[c]!;
          if (mon) hd.innerHTML = `<g class="monster${pv ? " preview" : ""}">${icon(mon)}</g>`;
          else {
            const spots: [number, number, number][] = [[GHOST, 0.4, 0.4], [VAMPIRE, 5.4, 0.4], [ZOMBIE, 2.9, 5.6]];
            hd.innerHTML = spots.filter(([mm]) => marks & bit(mm)).map(([mm, x, y]) => `<g class="pencil${pv ? " preview" : ""}" transform="translate(${x} ${y}) scale(0.42)">${icon(mm)}</g>`).join("");
          }
        }
        for (let i = 0; i < p.clues.length; i++) {
          const full = g.paths[i]!.every((vis) => st.monsters[vis.cell]);
          clueText[i]!.classList.toggle("bad", badClues.has(i));
          clueText[i]!.classList.toggle("done", !!settings.dimDone && full && sights[i] === p.clues[i]);
        }
        for (const mon of [GHOST, VAMPIRE, ZOMBIE]) {
          const placed = g.empties.filter((c) => st.monsters[c] === mon).length;
          const t = totals[mon]!;
          t.textContent = `${placed}/${p.counts[mon - 1]}`;
          t.classList.toggle("bad", badTotals.has(mon));
          t.classList.toggle("done", placed === p.counts[mon - 1]);
        }
        while (over.firstChild) over.firstChild.remove();
        const focus = session.activeHint?.focus as UndeadFocus | undefined;
        if (focus) {
          const box = (x: number, y: number, cls: string) => over.append(s("rect", { x: x + 0.5, y: y + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: cls }));
          for (const i of focus.clues ?? []) {
            const { x, y } = cluePos(i);
            box(x - SIZE / 2, y - SIZE / 2, "focus why");
          }
          for (const mon of focus.totals ?? []) {
            const x0 = [GHOST, VAMPIRE, ZOMBIE].indexOf(mon) * span + span / 2 - 8;
            over.append(s("rect", { x: x0, y: bandY - 3.6, width: 17, height: 7.2, rx: 1, class: "focus why" }));
          }
          for (const c of focus.because ?? []) box(cx(c), cy(c), "focus why");
          for (const c of focus.cells ?? []) box(cx(c), cy(c), "focus");
        }
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String(cx(cur) + 0.3));
        cursor.setAttribute("y", String(cy(cur) + 0.3));
      };

      const pointAt = (e: PointerEvent): { cell: number; clue: number } => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return { cell: -1, clue: -1 };
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        if (x >= 0 && y >= 0 && x < p.w && y < p.h) return { cell: y * p.w + x, clue: -1 };
        let clue = -1;
        if (y === -1 && x >= 0 && x < p.w) clue = x;
        else if (x === p.w && y >= 0 && y < p.h) clue = p.w + y;
        else if (y === p.h && x >= 0 && x < p.w) clue = p.w + p.h + (p.w - 1 - x);
        else if (x === -1 && y >= 0 && y < p.h) clue = 2 * p.w + p.h + (p.h - 1 - y);
        return { cell: -1, clue };
      };
      const editable = (c: number) => p.cells[c] === EMPTY && !p.given[c];
      const cycle = (c: number, dir: 1 | -1) => {
        if (!editable(c)) return;
        const next = (session.state.monsters[c]! + dir + 4) % 4;
        session.dispatch({ type: "set", cells: [c], value: next });
      };
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const at = pointAt(e);
        const pinned = pinClue;
        pinClue = at.cell < 0 && at.clue >= 0 && at.clue !== pinned ? at.clue : -1;
        if (pinClue !== pinned) render();
        if (at.cell < 0) return;
        e.preventDefault();
        session.setInteraction((i) => ({ ...i, cursor: at.cell }));
        if (session.locked) return;
        if (e.button !== 0 && e.button !== 2) return;
        cycle(at.cell, secondary(e, session.def.id) ? -1 : 1);
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        const at = pointAt(e);
        if (at.cell !== hoverCell || at.clue !== hoverClue) {
          hoverCell = at.cell;
          hoverClue = at.clue;
          render();
        }
      };
      const onLeave = () => {
        if (hoverCell !== -1 || hoverClue !== -1) {
          hoverCell = hoverClue = -1;
          render();
        }
      };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerleave", onLeave);
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || pinClue < 0) return;
        pinClue = -1;
        render();
      };
      document.addEventListener("keydown", onKey);

      const move = (dx: number, dy: number) => () => session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
        const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });
      const place = (mon: number, pencil = session.interaction.pencil) => () => {
        const c = session.interaction.cursor;
        if (!editable(c)) return;
        if (pencil) session.dispatch({ type: "toggle-mark", cell: c, value: mon });
        else session.dispatch({ type: "set", cells: [c], value: session.state.monsters[c] === mon ? 0 : mon });
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (cells: Iterable<number>) => [...new Set(cells)].map((c) => tiles[c]!.getBoundingClientRect());
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "undead.ghost": place(GHOST),
        "undead.vampire": place(VAMPIRE),
        "undead.zombie": place(ZOMBIE),
        "undead.clear": () => {
          const c = session.interaction.cursor;
          if (!editable(c)) return;
          if (session.state.monsters[c]) session.dispatch({ type: "set", cells: [c], value: 0 });
          else session.dispatch({ type: "marks", cells: [c], marks: 0 });
        },
        "undead.pencil": () => session.setInteraction((i) => ({ ...i, pencil: !i.pencil })),
        "undead.pencil-ghost": place(GHOST, true),
        "undead.pencil-vampire": place(VAMPIRE, true),
        "undead.pencil-zombie": place(ZOMBIE, true),
        "undead.left": move(-1, 0),
        "undead.right": move(1, 0),
        "undead.up": move(0, -1),
        "undead.down": move(0, 1),
      }, {
        "undead.ghost": { menu: "board" },
        "undead.vampire": { menu: "board" },
        "undead.zombie": { menu: "board" },
        "undead.clear": { menu: "board" },
        "undead.pencil": { menu: "board", checked: () => session.interaction.pencil },
        "undead.pencil-ghost": { menu: "board" },
        "undead.pencil-vampire": { menu: "board" },
        "undead.pencil-zombie": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, labels: ["cycle", "cycle back"] },
        aspect: vbW / vbH,
        cells: { cols: p.w + 2, rows: p.h + 3 },
        commands,
        context: (): UndeadContext => ({ undeadPencil: session.interaction.pencil }),
        target: (): UndeadTarget => (hoverClue >= 0 ? { clue: hoverClue } : { cell: hoverCell >= 0 ? hoverCell : session.interaction.cursor }),
        preview: (st) => {
          preview = st as UndeadState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as UndeadFocus | undefined;
          if (!f) return [];
          const out = rects([...(f.cells ?? []), ...(f.because ?? [])]);
          for (const i of f.clues ?? []) out.push(clueText[i]!.getBoundingClientRect());
          for (const mon of f.totals ?? []) out.push(totals[mon]!.getBoundingClientRect());
          return out;
        },
        locateChange: (a, b) => {
          const x = a as UndeadState, y = b as UndeadState;
          return rects(g.empties.filter((c) => x.monsters[c] !== y.monsters[c] || x.marks[c] !== y.marks[c]));
        },
        destroy() {
          offs.forEach((f) => f());
          document.removeEventListener("keydown", onKey);
          svg.remove();
        },
      };
    },
  };
}
