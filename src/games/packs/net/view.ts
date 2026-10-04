import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { bindCommands, type BindingSchema, type CommandHandler } from "../../core/commands";
import { colName, rowName } from "../../ui/board";
import { s, style } from "../../ui/dom";
import { KEYS } from "./assists";
import { D, DIRS, L, R, U, degree, orientations, turnsBetween, type NetPuzzle } from "./grid";
import type { NetAction, NetHintFocus, NetInteraction, NetState, TapMode } from "./logic";

const SIZE = 10;
const MID = SIZE / 2;
const ANIM_MS = 130;
/** A touch shorter than this, without moving, is a tap. */
const TAP_MS = 450;
const MOVE_PX = 12;
/** Viewbox units reserved on a side that shows edge labels. */
const LABEL = 6;
/** Rotation (degrees, SVG's clockwise) taking an arm drawn pointing right to direction d. */
const ARM_ANGLE: Record<number, number> = { [R]: 0, [D]: 90, [L]: 180, [U]: 270 };

/** Themeable graphics, all drawn in a SIZE×SIZE tile; colours come from the view's CSS unless the markup sets its own. */
export const ASSETS = {
  /** One pipe arm from the centre to the right edge (rotated for the other sides). */
  arm: ["net.arm", `<line x1="${MID}" y1="${MID}" x2="${SIZE}" y2="${MID}"/>`],
  /** Junction drawn where two or more arms meet. */
  hub: ["net.hub", `<rect x="${MID - 1}" y="${MID - 1}" width="2" height="2"/>`],
  /** Cap on a tile with a single arm. */
  end: ["net.end", `<rect x="${MID - 2.2}" y="${MID - 2.2}" width="4.4" height="4.4" rx="0.6"/>`],
  /** Marker on the cell power flows from. */
  source: ["net.source", `<rect x="${MID - 1.6}" y="${MID - 1.6}" width="3.2" height="3.2" rx="0.4"/>`],
} as const;

export type AssetLookup = (id: string, fallback: string) => string;

const CSS = `
.net-board { width: 100%; height: 100%; display: block; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.net-board .bg { fill: var(--cell); stroke: var(--bg); stroke-width: 0.4; }
.net-board .bg.locked { fill: var(--border); }
.net-board .bg.paint { fill: var(--accent-soft); }
.net-board .bg.conflict, .net-board .bg.wrong { fill: var(--danger-soft); }
.net-board .bg.hint { fill: var(--hint-soft); }
.net-board .bg.hint-main { stroke: var(--hint); stroke-width: 0.9; }
.net-board .pipe { stroke: var(--text-dim); stroke-width: 2; stroke-linecap: butt; fill: var(--text-dim); }
.net-board .on .pipe { stroke: var(--accent); fill: var(--accent); }
.net-board .pipe.loose { stroke: var(--warn); fill: var(--warn); }
.net-board .pipe.loop { stroke: var(--danger); fill: var(--danger); }
.net-board .hub { fill: var(--text-dim); }
.net-board .on .hub { fill: var(--accent); }
.net-board .end { fill: var(--surface); stroke: var(--text-dim); stroke-width: 0.9; }
.net-board .on .end { stroke: var(--accent); }
.net-board .src { fill: var(--cell-lit); stroke: none; }
.net-board .wall { stroke: var(--text); stroke-width: 1.1; stroke-linecap: round; }
.net-board .ghost { stroke: var(--hint); fill: var(--hint); stroke-width: 2; opacity: 0.85; pointer-events: none; }
.net-board .tile.superseded { opacity: 0.3; }
.net-board .label { fill: var(--text-dim); font-size: 3.2px; font-family: var(--mono, monospace); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.net-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
[data-input="pointer"] .net-board .cursor { display: none; }
[data-solved] .net-board .pipe { stroke: var(--accent); fill: var(--accent); }
`;

const settings = defineSchema({
  animate: { type: "bool", label: "animate turning", default: true },
});

/** Acting on "the tile": the cursor, which a pointer press also moves, so these work from the board menu too. */
const bindings: BindingSchema = {
  "net.tap-at": { label: "tap a tile", category: "net", mouse: ["click"], description: "do what the tap buttons say: turn the tile clockwise (the default), anticlockwise, or lock it" },
  "net.rotate-ccw-at": { label: "turn anticlockwise (pointer)", category: "net", mouse: [], description: "turn the clicked tile anticlockwise. has no button by default: right-click opens the board menu, but you can bind it here" },
  "net.lock-at": { label: "lock / unlock (pointer)", category: "net", mouse: ["middleclick", "shift+click"], description: "lock or unlock the clicked tile; keep the button down and drag to lock or unlock several" },
  "net.source-at": { label: "move the source (pointer)", category: "net", mouse: ["$mod+click"], description: "make the clicked tile the source: pipes joined to it light up" },
  "net.left": { label: "cursor left", category: "net", keys: ["arrowleft"], description: "move the keyboard cursor one tile left" },
  "net.right": { label: "cursor right", category: "net", keys: ["arrowright"], description: "move the keyboard cursor one tile right" },
  "net.up": { label: "cursor up", category: "net", keys: ["arrowup"], description: "move the keyboard cursor one tile up" },
  "net.down": { label: "cursor down", category: "net", keys: ["arrowdown"], description: "move the keyboard cursor one tile down" },
  "net.rotate-cw": { label: "turn clockwise", category: "net", keys: ["d", "enter"], description: "turn the tile a quarter turn clockwise" },
  "net.rotate-ccw": { label: "turn anticlockwise", category: "net", keys: ["a"], description: "turn the tile a quarter turn anticlockwise" },
  "net.rotate-half": { label: "turn halfway", category: "net", keys: ["f"], description: "turn the tile round by half a turn" },
  "net.lock": { label: "lock / unlock", category: "net", keys: ["s", "space"], description: "lock the tile so it can't be turned by accident, or unlock it. locked tiles are shaded" },
  "net.source": { label: "move the source here", category: "net", keys: ["x"], description: "make this tile the source: pipes joined to it light up. only a viewing aid, it doesn't change the answer" },
  "net.jumble": { label: "jumble unlocked tiles", category: "net", keys: ["j"], description: "turn every tile you haven't locked to a random way round. a quick way to throw away guesses and keep only what you've locked" },
  "net.tap-cw": { label: "tap turns clockwise", category: "net", description: "a tap or click on a tile turns it clockwise" },
  "net.tap-ccw": { label: "tap turns anticlockwise", category: "net", description: "a tap or click on a tile turns it anticlockwise" },
  "net.tap-lock": { label: "tap locks", category: "net", description: "a tap or click on a tile locks or unlocks it; drag across tiles to lock or unlock them all" },
};

/** On the board menu (right-click when unbound, long-press on touch). */
const BOARD_MENU = ["net.rotate-cw", "net.rotate-ccw", "net.rotate-half", "net.lock", "net.source", "net.jumble", "net.recentre"];

/** Only meaningful on wrapping boards. */
const wrapBindings: BindingSchema = {
  "net.shift-left": { label: "scroll left", category: "net", keys: ["shift+arrowleft"], description: "slide the whole wrapping board one tile left; tiles leaving one edge come back on the other" },
  "net.shift-right": { label: "scroll right", category: "net", keys: ["shift+arrowright"], description: "slide the whole wrapping board one tile right; tiles leaving one edge come back on the other" },
  "net.shift-up": { label: "scroll up", category: "net", keys: ["shift+arrowup"], description: "slide the whole wrapping board one tile up; tiles leaving one edge come back on the other" },
  "net.shift-down": { label: "scroll down", category: "net", keys: ["shift+arrowdown"], description: "slide the whole wrapping board one tile down; tiles leaving one edge come back on the other" },
  "net.recentre": { label: "centre the source", category: "net", keys: ["c"], description: "scroll the wrapping board so the source sits in the middle" },
};

const controls = [
  { how: "tap a tile", what: "turn it clockwise. the tap buttons under the board switch this to anticlockwise or to locking" },
  { how: "with tap set to lock, drag across tiles", what: "lock (or unlock) every tile you pass over" },
  { how: "touch and hold a tile", what: "a menu of everything you can do to that tile" },
];

interface CellEls {
  g: SVGGElement;
  bg: SVGRectElement;
  tile: SVGGElement;
  pipes: SVGGElement[];
  hub: SVGGElement;
  end: SVGGElement;
  src: SVGGElement;
}

/** Markup as given, or an image filling the tile for a URL. */
function art(look: AssetLookup, [id, fallback]: readonly [string, string]): string {
  const v = look(id, fallback).trim();
  if (v.startsWith("<")) return v;
  const href = v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<image href="${href}" x="0" y="0" width="${SIZE}" height="${SIZE}"/>`;
}

function part(markup: string, attrs: Record<string, string | number>): SVGGElement {
  const g = s("g", attrs);
  g.innerHTML = markup;
  return g;
}

export interface NetViewDeps {
  look?: AssetLookup;
  /** Board edges that show column letters / row numbers. */
  labelSides?: () => ReadonlySet<string>;
}

export function netView({ look = (_id, fallback) => fallback, labelSides = () => new Set() }: NetViewDeps = {}): View<NetPuzzle, NetState, NetAction, NetInteraction> {
  return {
    id: "net.svg",
    name: "grid",
    puzzle: "net",
    settings,
    controls,
    mount(root, { session, settings }) {
      style("net", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const sides = labelSides();
      const pad = (side: string) => (sides.has(side) ? LABEL : 0.5);
      const [padL, padR, padT, padB] = [pad("left"), pad("right"), pad("top"), pad("bottom")];
      const vbW = p.w * SIZE + padL + padR, vbH = p.h * SIZE + padT + padB;
      const arm = art(look, ASSETS.arm), hubArt = art(look, ASSETS.hub), endArt = art(look, ASSETS.end), srcArt = art(look, ASSETS.source);
      const svg = s("svg", {
        viewBox: `${-padL} ${-padT} ${vbW} ${vbH}`,
        class: "net-board", role: "grid", "aria-label": `${p.w} by ${p.h} pipes puzzle`,
      });
      const armAt = (d: number, cls: string) => part(arm, { class: cls, transform: `rotate(${ARM_ANGLE[d]} ${MID} ${MID})` });
      const cells: CellEls[] = [];
      for (let i = 0; i < n; i++) {
        const pipes = DIRS.map((d) => armAt(d, "pipe"));
        const hub = part(hubArt, { class: "hub" });
        const end = part(endArt, { class: "end" });
        const src = part(srcArt, { class: "src" });
        const tile = s("g", { class: "tile" }, pipes, hub, end, src);
        const bg = s("rect", { x: 0, y: 0, width: SIZE, height: SIZE, class: "bg" });
        const walls: SVGLineElement[] = [];
        for (const d of DIRS) {
          if (!(p.barriers[i]! & d)) continue;
          const [a, b] = d === R ? [[SIZE, 0], [SIZE, SIZE]] : d === L ? [[0, 0], [0, SIZE]] : d === U ? [[0, 0], [SIZE, 0]] : [[0, SIZE], [SIZE, SIZE]];
          walls.push(s("line", { x1: a![0], y1: a![1], x2: b![0], y2: b![1], class: "wall" }));
        }
        const g = s("g", { "data-cell": i }, bg, tile, walls);
        svg.append(g);
        cells.push({ g, bg, tile, pipes, hub, end, src });
      }
      // edge labels name tiles, not screen positions, so they travel with a scrolled wrapping board
      const colLabels: SVGTextElement[] = [], rowLabels: SVGTextElement[] = [];
      for (const side of ["top", "bottom"]) {
        if (!sides.has(side)) continue;
        const y = side === "top" ? -LABEL / 2 : p.h * SIZE + LABEL / 2;
        for (let x = 0; x < p.w; x++) colLabels.push(s("text", { x: x * SIZE + MID, y, class: "label", "data-col": x }));
      }
      for (const side of ["left", "right"]) {
        if (!sides.has(side)) continue;
        const x = side === "left" ? -LABEL / 2 : p.w * SIZE + LABEL / 2;
        for (let y = 0; y < p.h; y++) rowLabels.push(s("text", { x, y: y * SIZE + MID, class: "label", "data-row": y }));
      }
      const ghostArms = DIRS.map((d) => armAt(d, "ghost-arm"));
      const ghost = s("g", { class: "ghost", visibility: "hidden" }, ghostArms);
      const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1, class: "cursor" });
      svg.append(...colLabels, ...rowLabels, ghost, cursor);
      root.append(svg);

      const shown = new Int8Array(n).fill(-1);
      const angle = new Float64Array(n);
      const anim = new Map<number, { from: number; t0: number }>();
      let raf = 0;
      let shownOffset = "";

      const displayPos = (i: number, it: NetInteraction): [number, number] => {
        const x = (((i % p.w) - it.ox) % p.w + p.w) % p.w;
        const y = ((Math.floor(i / p.w) - it.oy) % p.h + p.h) % p.h;
        return [x * SIZE, y * SIZE];
      };

      const setAngle = (i: number, a: number) => {
        angle[i] = a;
        cells[i]!.tile.setAttribute("transform", a ? `rotate(${a} ${MID} ${MID})` : "");
      };

      const tickAnim = (now: number) => {
        raf = 0;
        for (const [i, { from, t0 }] of anim) {
          const t = Math.min(1, (now - t0) / ANIM_MS);
          const ease = 1 - (1 - t) * (1 - t);
          setAngle(i, from * (1 - ease));
          if (t >= 1) anim.delete(i);
        }
        if (anim.size) raf = requestAnimationFrame(tickAnim);
      };

      const render = () => {
        const st = session.state;
        const it = session.interaction;
        const d = session.derived();
        const powered = d[KEYS.powered] as Uint8Array | undefined;
        const loops = d[KEYS.loops] as Uint8Array | undefined;
        const loose = d[KEYS.loose] as Uint8Array | undefined;
        const conflicts = d[KEYS.conflicts] as Uint8Array | undefined;
        const wrong = d[KEYS.wrong] as Uint8Array | undefined;
        const focus = session.activeHint?.focus as NetHintFocus | undefined;
        const hinted = new Set(focus?.cells ?? []);
        const paint = new Set(it.drag?.cells ?? []);
        const ghostMask = focus && focus.cell >= 0 && focus.mask !== undefined && st.tiles[focus.cell] !== focus.mask ? focus.mask : -1;
        const ghostCell = ghostMask >= 0 ? focus!.cell : -1;
        const offset = `${it.ox},${it.oy}`;
        const moveAll = offset !== shownOffset;
        shownOffset = offset;
        if (moveAll) {
          for (const t of colLabels) t.textContent = colName((Number(t.dataset.col) + it.ox) % p.w);
          for (const t of rowLabels) t.textContent = rowName((Number(t.dataset.row) + it.oy) % p.h);
        }
        for (let i = 0; i < n; i++) {
          const c = cells[i]!;
          const m = st.tiles[i]!;
          if (moveAll) {
            const [x, y] = displayPos(i, it);
            c.g.setAttribute("transform", `translate(${x} ${y})`);
          }
          if (m !== shown[i]) {
            const k = shown[i]! < 0 ? 0 : turnsBetween(shown[i]!, m);
            if (k > 0 && settings.animate) {
              const from = angle[i]! - (k === 3 ? -90 : k * 90);
              anim.set(i, { from, t0: performance.now() });
              setAngle(i, from);
              raf ||= requestAnimationFrame(tickAnim);
            }
            shown[i] = m;
            DIRS.forEach((dir, k2) => c.pipes[k2]!.setAttribute("visibility", m & dir ? "visible" : "hidden"));
            const leaf = degree(m) === 1;
            c.end.setAttribute("visibility", leaf ? "visible" : "hidden");
            c.hub.setAttribute("visibility", leaf || m === 0 ? "hidden" : "visible");
          }
          c.tile.classList.toggle("on", powered?.[i] === 1);
          DIRS.forEach((dir, k2) => {
            c.pipes[k2]!.classList.toggle("loop", ((loops?.[i] ?? 0) & dir) !== 0);
            c.pipes[k2]!.classList.toggle("loose", ((loose?.[i] ?? 0) & dir) !== 0);
          });
          c.src.setAttribute("visibility", i === it.source ? "visible" : "hidden");
          const bg = c.bg.classList;
          bg.toggle("locked", st.locked[i] === 1);
          bg.toggle("conflict", (conflicts?.[i] ?? 0) !== 0);
          bg.toggle("wrong", wrong?.[i] === 1);
          bg.toggle("hint", hinted.has(i));
          bg.toggle("hint-main", focus?.cell === i);
          bg.toggle("paint", paint.has(i));
          c.tile.classList.toggle("superseded", i === ghostCell);
        }
        ghost.setAttribute("visibility", ghostCell >= 0 ? "visible" : "hidden");
        if (ghostCell >= 0) {
          const [gx, gy] = displayPos(ghostCell, it);
          ghost.setAttribute("transform", `translate(${gx} ${gy})`);
          DIRS.forEach((dir, k) => ghostArms[k]!.setAttribute("visibility", ghostMask & dir ? "visible" : "hidden"));
        }
        const [cx, cy] = displayPos(it.cursor, it);
        cursor.setAttribute("x", String(cx));
        cursor.setAttribute("y", String(cy));
      };

      const cellAt = (target: EventTarget | null): number => {
        if (!(target instanceof Element) || !svg.contains(target)) return -1;
        const attr = target.closest("[data-cell]")?.getAttribute("data-cell");
        return attr == null ? -1 : Number(attr);
      };

      const rotate = (cell: number, turns: number) => session.dispatch({ type: "rotate", cell, turns });
      const toggleLock = (cell: number) => session.dispatch({ type: "lock", cells: [cell], on: !session.state.locked[cell] });
      const setCursor = (cell: number) => session.setInteraction((i) => (i.cursor === cell ? i : { ...i, cursor: cell }));
      const startPaint = (cell: number) => {
        session.setInteraction((i) => ({ ...i, cursor: cell, drag: { on: !session.state.locked[cell], cells: [cell] } }));
      };
      const extendPaint = (cell: number) => {
        const drag = session.interaction.drag;
        if (!drag || cell < 0 || drag.cells.includes(cell)) return;
        session.setInteraction((i) => ({ ...i, drag: { ...drag, cells: [...drag.cells, cell] } }));
      };
      const finishPaint = () => {
        const drag = session.interaction.drag;
        if (!drag) return;
        session.setInteraction((i) => ({ ...i, drag: null }));
        session.dispatch({ type: "lock", cells: drag.cells, on: drag.on });
      };
      const tapMode = (): TapMode => session.interaction.tap ?? "cw";
      /** A tap or plain click; locking starts a paint so a drag extends it. */
      const tap = (cell: number) => {
        const mode = tapMode();
        if (mode === "lock") startPaint(cell);
        else rotate(cell, mode === "ccw" ? -1 : 1);
      };

      let rightClickAt = -Infinity;
      const pointerCell = (fn: (cell: number) => void): CommandHandler => (_ctx, e) => {
        const cell = cellAt(e?.target ?? null);
        if (cell < 0) return false;
        setCursor(cell);
        fn(cell);
        return true;
      };

      // touch: a quick tap acts; holding still is left to the shell's board menu; moving to another tile while locking paints
      let press: { id: number; cell: number; t0: number; x: number; y: number; moved: boolean } | null = null;
      const onPointerDown = (e: PointerEvent) => {
        const cell = cellAt(e.target);
        if (cell >= 0) setCursor(cell);
        if (e.pointerType !== "touch" || cell < 0 || press) return;
        e.preventDefault();
        press = { id: e.pointerId, cell, t0: performance.now(), x: e.clientX, y: e.clientY, moved: false };
      };
      const onPointerMove = (e: PointerEvent) => {
        if (press && e.pointerId === press.id && !press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_PX) {
          press.moved = true;
          if (tapMode() === "lock") startPaint(press.cell);
        }
        if (session.interaction.drag) extendPaint(cellAt(document.elementFromPoint(e.clientX, e.clientY)));
      };
      const onPointerUp = (e: PointerEvent) => {
        if (press && e.pointerId === press.id) {
          const { cell, t0, moved } = press;
          press = null;
          if (e.type === "pointerup" && !moved && performance.now() - t0 < TAP_MS) {
            if (tapMode() === "lock") toggleLock(cell);
            else tap(cell);
          }
        }
        finishPaint();
      };
      // a right-click that turned a tile isn't also a request for the board menu
      const onContextMenu = (e: Event) => {
        if (performance.now() - rightClickAt < TAP_MS) e.preventDefault();
      };
      svg.addEventListener("pointerdown", onPointerDown);
      svg.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);

      const step = (i: number, dx: number, dy: number): number => {
        let x = (i % p.w) + dx, y = Math.floor(i / p.w) + dy;
        if (p.wrap) {
          x = (x + p.w) % p.w;
          y = (y + p.h) % p.h;
        } else {
          x = Math.min(p.w - 1, Math.max(0, x));
          y = Math.min(p.h - 1, Math.max(0, y));
        }
        return y * p.w + x;
      };
      const atCursor = (fn: (cell: number) => void) => () => fn(session.interaction.cursor);
      const move = (dx: number, dy: number) => () => {
        session.setInteraction((i) => ({ ...i, cursor: step(i.cursor, dx, dy) }));
      };
      const shift = (dx: number, dy: number) => () => {
        session.setInteraction((i) => ({ ...i, ox: (i.ox + dx + p.w) % p.w, oy: (i.oy + dy + p.h) % p.h }));
      };
      const setSource = (cell: number) => session.setInteraction((i) => ({ ...i, source: cell, cursor: cell }));
      const setTap = (mode: TapMode) => () => session.setInteraction((i) => ({ ...i, tap: mode }));

      if (session.interaction.drag) session.setInteraction((i) => ({ ...i, drag: null }));

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (list: Iterable<number>) => [...new Set(list)].filter((i) => i >= 0 && i < n).map((i) => cells[i]!.bg.getBoundingClientRect());
      const playing = (c: Record<string, unknown>) => !c.solved;
      const tapMenu = (mode: TapMode): Partial<CommandDef> => ({ checked: () => tapMode() === mode });

      const commands: CommandDef[] = [
        ...bindCommands(bindings, {
          "net.left": move(-1, 0),
          "net.right": move(1, 0),
          "net.up": move(0, -1),
          "net.down": move(0, 1),
          "net.rotate-cw": atCursor((c) => rotate(c, 1)),
          "net.rotate-ccw": atCursor((c) => rotate(c, -1)),
          "net.rotate-half": atCursor((c) => rotate(c, 2)),
          "net.lock": atCursor(toggleLock),
          "net.source": atCursor(setSource),
          "net.jumble": () => {
            const { state } = session;
            const cs = state.tiles.flatMap((m, i) => (!state.locked[i] && orientations(m).length > 1 ? [i] : []));
            session.dispatch({ type: "rotateMany", cells: cs, turns: cs.map(() => Math.floor(Math.random() * 4)) });
          },
          "net.tap-cw": setTap("cw"),
          "net.tap-ccw": setTap("ccw"),
          "net.tap-lock": setTap("lock"),
          "net.tap-at": pointerCell(tap),
          "net.rotate-ccw-at": pointerCell((c) => {
            rightClickAt = performance.now();
            rotate(c, -1);
          }),
          "net.lock-at": pointerCell(startPaint),
          "net.source-at": pointerCell(setSource),
        }, {
          "net.jumble": { when: playing },
          "net.tap-cw": tapMenu("cw"),
          "net.tap-ccw": tapMenu("ccw"),
          "net.tap-lock": tapMenu("lock"),
        }),
        ...(p.wrap ? bindCommands(wrapBindings, {
          "net.shift-left": shift(1, 0),
          "net.shift-right": shift(-1, 0),
          "net.shift-up": shift(0, 1),
          "net.shift-down": shift(0, -1),
          "net.recentre": () => {
            const src = session.interaction.source;
            session.setInteraction((i) => ({
              ...i,
              ox: ((src % p.w) - Math.floor(p.w / 2) + p.w) % p.w,
              oy: (Math.floor(src / p.w) - Math.floor(p.h / 2) + p.h) % p.h,
            }));
          },
        }) : []),
      ].map((c) => (BOARD_MENU.includes(c.id) ? { ...c, menu: "board" } : c));

      return {
        aspect: vbW / vbH,
        locate(focus) {
          const f = focus as Partial<NetHintFocus> | null;
          if (!f || !Array.isArray(f.cells)) return [];
          return rects(f.cell !== undefined && f.cell >= 0 ? [f.cell, ...f.cells] : f.cells);
        },
        locateChange(a, b) {
          const x = a as NetState, y = b as NetState;
          return rects(x.tiles.flatMap((m, i) => (m !== y.tiles[i] || x.locked[i] !== y.locked[i] ? [i] : [])));
        },
        destroy() {
          offs.forEach((f) => f());
          if (raf) cancelAnimationFrame(raf);
          svg.removeEventListener("pointerdown", onPointerDown);
          svg.removeEventListener("contextmenu", onContextMenu);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);
          svg.remove();
        },
        commands,
      };
    },
  };
}
