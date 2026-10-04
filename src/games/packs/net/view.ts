import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { bindCommands, type BindingSchema, type CommandHandler } from "../../core/commands";
import { s, style } from "../../ui/dom";
import { KEYS } from "./assists";
import { D, DIRS, L, R, U, degree, orientations, turnsBetween, type NetPuzzle } from "./grid";
import type { NetAction, NetHintFocus, NetInteraction, NetState } from "./logic";

const SIZE = 10;
const MID = SIZE / 2;
const ANIM_MS = 130;
const LONG_PRESS_MS = 450;
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
.net-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
[data-input="pointer"] .net-board .cursor { display: none; }
[data-solved] .net-board .pipe { stroke: var(--accent); fill: var(--accent); }
`;

const settings = defineSchema({
  tap: {
    type: "enum", label: "tap on touch screens turns", default: "cw",
    options: [{ value: "cw", label: "clockwise" }, { value: "ccw", label: "anticlockwise" }],
  },
  animate: { type: "bool", label: "animate turning", default: true },
});

const bindings: BindingSchema = {
  "net.left": { label: "cursor left", category: "net", keys: ["arrowleft"] },
  "net.right": { label: "cursor right", category: "net", keys: ["arrowright"] },
  "net.up": { label: "cursor up", category: "net", keys: ["arrowup"] },
  "net.down": { label: "cursor down", category: "net", keys: ["arrowdown"] },
  "net.rotate-cw": { label: "turn clockwise", category: "net", keys: ["d", "enter"] },
  "net.rotate-ccw": { label: "turn anticlockwise", category: "net", keys: ["a"] },
  "net.rotate-half": { label: "turn halfway", category: "net", keys: ["f"] },
  "net.lock": { label: "lock / unlock", category: "net", keys: ["s", "space"] },
  "net.source": { label: "move the source here", category: "net", keys: ["x"] },
  "net.jumble": { label: "jumble unlocked tiles", category: "net", keys: ["j"] },
  "net.rotate-cw-at": { label: "turn clockwise (pointer)", category: "net", mouse: ["click"] },
  "net.rotate-ccw-at": { label: "turn anticlockwise (pointer)", category: "net", mouse: ["rightclick"] },
  "net.lock-at": { label: "lock / unlock, drag to paint (pointer)", category: "net", mouse: ["middleclick", "shift+click"] },
  "net.source-at": { label: "move the source (pointer)", category: "net", mouse: ["$mod+click"] },
};

/** Only meaningful on wrapping boards. */
const wrapBindings: BindingSchema = {
  "net.shift-left": { label: "scroll wrapped grid left", category: "net", keys: ["shift+arrowleft"] },
  "net.shift-right": { label: "scroll wrapped grid right", category: "net", keys: ["shift+arrowright"] },
  "net.shift-up": { label: "scroll wrapped grid up", category: "net", keys: ["shift+arrowup"] },
  "net.shift-down": { label: "scroll wrapped grid down", category: "net", keys: ["shift+arrowdown"] },
  "net.recentre": { label: "centre the source", category: "net", keys: ["c"] },
};

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

export function netView(look: AssetLookup): View<NetPuzzle, NetState, NetAction, NetInteraction> {
  return {
    id: "net.svg",
    name: "grid",
    puzzle: "net",
    settings,
    mount(root, { session, settings }) {
      style("net", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const arm = art(look, ASSETS.arm), hubArt = art(look, ASSETS.hub), endArt = art(look, ASSETS.end), srcArt = art(look, ASSETS.source);
      const svg = s("svg", {
        viewBox: `-0.5 -0.5 ${p.w * SIZE + 1} ${p.h * SIZE + 1}`,
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
      const ghostArms = DIRS.map((d) => armAt(d, "ghost-arm"));
      const ghost = s("g", { class: "ghost", visibility: "hidden" }, ghostArms);
      const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1, class: "cursor" });
      svg.append(ghost, cursor);
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
        ghost.setAttribute("visibility", ghostMask >= 0 ? "visible" : "hidden");
        if (ghostMask >= 0) {
          const [gx, gy] = displayPos(focus!.cell, it);
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

      const pointerCell = (fn: (cell: number) => void): CommandHandler => (_ctx, e) => {
        const cell = cellAt(e?.target ?? null);
        if (cell < 0) return false;
        fn(cell);
        return true;
      };

      let press: { id: number; cell: number; timer: number; x: number; y: number } | null = null;
      const onPointerDown = (e: PointerEvent) => {
        if (e.pointerType !== "touch") return;
        e.preventDefault();
        if (press) return;
        const cell = cellAt(e.target);
        if (cell < 0) return;
        const timer = window.setTimeout(() => {
          if (!press) return;
          press.timer = 0;
          startPaint(press.cell);
        }, LONG_PRESS_MS);
        press = { id: e.pointerId, cell, timer, x: e.clientX, y: e.clientY };
      };
      const onPointerMove = (e: PointerEvent) => {
        if (press && e.pointerId === press.id && press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) {
          clearTimeout(press.timer);
          press.timer = 0;
        }
        if (session.interaction.drag) extendPaint(cellAt(document.elementFromPoint(e.clientX, e.clientY)));
      };
      const onPointerUp = (e: PointerEvent) => {
        if (press && e.pointerId === press.id) {
          const { timer, cell, x, y } = press;
          press = null;
          if (timer) {
            clearTimeout(timer);
            if (e.type === "pointerup" && Math.hypot(e.clientX - x, e.clientY - y) <= 12) rotate(cell, settings.tap === "ccw" ? -1 : 1);
          }
        }
        finishPaint();
      };
      const onContextMenu = (e: Event) => e.preventDefault();
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
      const withCursor = (fn: (cell: number) => void) => (c: number) => {
        session.setInteraction((i) => ({ ...i, cursor: c }));
        fn(c);
      };

      if (session.interaction.drag) session.setInteraction((i) => ({ ...i, drag: null }));

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (list: Iterable<number>) => [...new Set(list)].filter((i) => i >= 0 && i < n).map((i) => cells[i]!.bg.getBoundingClientRect());

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
          "net.rotate-cw-at": pointerCell(withCursor((c) => rotate(c, 1))),
          "net.rotate-ccw-at": pointerCell(withCursor((c) => rotate(c, -1))),
          "net.lock-at": pointerCell(startPaint),
          "net.source-at": pointerCell(setSource),
        }, { "net.jumble": { when: (c) => !c.solved } }),
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
      ];

      return {
        aspect: (p.w * SIZE + 1) / (p.h * SIZE + 1),
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
          if (press?.timer) clearTimeout(press.timer);
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
