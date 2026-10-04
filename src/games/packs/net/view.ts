import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { bindCommands, type BindingSchema, type CommandHandler } from "../../core/commands";
import { s, style } from "../../ui/dom";
import { KEYS } from "./assists";
import { D, DIRS, L, R, U, degree, turnsBetween, type NetPuzzle } from "./grid";
import type { NetAction, NetHintFocus, NetInteraction, NetState } from "./logic";

const SIZE = 10;
const MID = SIZE / 2;
const END: Record<number, [number, number]> = { [R]: [SIZE, MID], [U]: [MID, 0], [L]: [0, MID], [D]: [MID, SIZE] };
const ANIM_MS = 130;
const LONG_PRESS_MS = 450;

const CSS = `
.net-board { width: min(100%, 85vh); height: auto; max-height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.net-board .bg { fill: var(--cell); stroke: var(--bg); stroke-width: 0.4; }
.net-board .bg.locked { fill: var(--border); }
.net-board .bg.paint { fill: var(--accent-soft); }
.net-board .bg.conflict, .net-board .bg.wrong { fill: var(--danger-soft); }
.net-board .bg.hint { fill: var(--hint-soft); }
.net-board .bg.hint-main { stroke: var(--hint); stroke-width: 0.9; }
.net-board .pipe { stroke: var(--text-dim); stroke-width: 2; stroke-linecap: butt; }
.net-board .on .pipe { stroke: var(--accent); }
.net-board .pipe.loose { stroke: var(--warn); }
.net-board .pipe.loop { stroke: var(--danger); }
.net-board .hub { fill: var(--text-dim); }
.net-board .on .hub { fill: var(--accent); }
.net-board .end { fill: var(--surface); stroke: var(--text-dim); stroke-width: 0.9; }
.net-board .on .end { stroke: var(--accent); }
.net-board .src { fill: var(--cell-lit); stroke: none; }
.net-board .wall { stroke: var(--text); stroke-width: 1.1; stroke-linecap: round; }
.net-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
.net-board .cursor[hidden] { display: none; }
[data-solved] .net-board .pipe { stroke: var(--accent); }
`;

const settings = defineSchema({
  tap: {
    type: "enum", label: "tap on touch screens turns", default: "cw",
    options: [{ value: "cw", label: "clockwise" }, { value: "ccw", label: "anticlockwise" }],
  },
  animate: { type: "bool", label: "animate turning", default: true },
});

interface CellEls {
  g: SVGGElement;
  bg: SVGRectElement;
  tile: SVGGElement;
  pipes: SVGLineElement[];
  hub: SVGRectElement;
  end: SVGRectElement;
  src: SVGRectElement;
}

export const netView: View<NetPuzzle, NetState, NetAction, NetInteraction> & { bindings: BindingSchema } = {
  id: "net.svg",
  name: "grid",
  puzzle: "net",
  settings,
  bindings: {
    "net.left": { label: "Cursor left", category: "Net", keys: ["arrowleft"] },
    "net.right": { label: "Cursor right", category: "Net", keys: ["arrowright"] },
    "net.up": { label: "Cursor up", category: "Net", keys: ["arrowup"] },
    "net.down": { label: "Cursor down", category: "Net", keys: ["arrowdown"] },
    "net.rotate-cw": { label: "Turn clockwise", category: "Net", keys: ["d", "enter"] },
    "net.rotate-ccw": { label: "Turn anticlockwise", category: "Net", keys: ["a"] },
    "net.rotate-half": { label: "Turn halfway", category: "Net", keys: ["f"] },
    "net.lock": { label: "Lock / unlock", category: "Net", keys: ["s", "space"] },
    "net.source": { label: "Move the source here", category: "Net", keys: ["x"] },
    "net.shift-left": { label: "Scroll wrapped grid left", category: "Net", keys: ["shift+arrowleft"] },
    "net.shift-right": { label: "Scroll wrapped grid right", category: "Net", keys: ["shift+arrowright"] },
    "net.shift-up": { label: "Scroll wrapped grid up", category: "Net", keys: ["shift+arrowup"] },
    "net.shift-down": { label: "Scroll wrapped grid down", category: "Net", keys: ["shift+arrowdown"] },
    "net.recentre": { label: "Centre the source", category: "Net", keys: ["c"] },
    "net.rotate-cw-at": { label: "Turn clockwise (pointer)", category: "Net", mouse: ["click"] },
    "net.rotate-ccw-at": { label: "Turn anticlockwise (pointer)", category: "Net", mouse: ["rightclick"] },
    "net.lock-at": { label: "Lock / unlock, drag to paint (pointer)", category: "Net", mouse: ["middleclick", "shift+click"] },
    "net.source-at": { label: "Move the source (pointer)", category: "Net", mouse: ["$mod+click"] },
  },
  mount(root, { session, settings }) {
    style("net", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const svg = s("svg", {
      viewBox: `-0.5 -0.5 ${p.w * SIZE + 1} ${p.h * SIZE + 1}`,
      class: "net-board", role: "grid", "aria-label": `${p.w} by ${p.h} net puzzle`,
    });
    const cells: CellEls[] = [];
    for (let i = 0; i < n; i++) {
      const pipes = DIRS.map((d) => s("line", { x1: MID, y1: MID, x2: END[d]![0], y2: END[d]![1], class: "pipe" }));
      const hub = s("rect", { x: MID - 1, y: MID - 1, width: 2, height: 2, class: "hub" });
      const end = s("rect", { x: MID - 2.2, y: MID - 2.2, width: 4.4, height: 4.4, rx: 0.6, class: "end" });
      const src = s("rect", { x: MID - 1.6, y: MID - 1.6, width: 3.2, height: 3.2, rx: 0.4, class: "src" });
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
    const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1, class: "cursor", hidden: true });
    svg.append(cursor);
    root.append(svg);

    const shown = new Int8Array(n).fill(-1);
    const angle = new Float64Array(n);
    const anim = new Map<number, { from: number; t0: number }>();
    let raf = 0;
    let shownOffset = "";
    let showCursor = false;

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
      }
      const [cx, cy] = displayPos(it.cursor, it);
      cursor.setAttribute("x", String(cx));
      cursor.setAttribute("y", String(cy));
      cursor.toggleAttribute("hidden", !showCursor);
    };

    const cellAt = (target: EventTarget | null): number => {
      if (!(target instanceof Element) || !svg.contains(target)) return -1;
      const attr = target.closest("[data-cell]")?.getAttribute("data-cell");
      return attr == null ? -1 : Number(attr);
    };

    const rotate = (cell: number, turns: number) => session.dispatch({ type: "rotate", cell, turns });
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
      showCursor = false;
      fn(cell);
      return true;
    };

    let press: { id: number; cell: number; timer: number; x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        if (showCursor && cellAt(e.target) >= 0) {
          showCursor = false;
          render();
        }
        return;
      }
      e.preventDefault();
      if (press) return;
      const cell = cellAt(e.target);
      if (cell < 0) return;
      showCursor = false;
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
    const atCursor = (fn: (cell: number) => void) => () => {
      showCursor = true;
      fn(session.interaction.cursor);
      render();
    };
    const move = (dx: number, dy: number) => () => {
      showCursor = true;
      session.setInteraction((i) => ({ ...i, cursor: step(i.cursor, dx, dy) }));
      render();
    };
    const shift = (dx: number, dy: number) => () => {
      if (!p.wrap) return false;
      session.setInteraction((i) => ({ ...i, ox: (i.ox + dx + p.w) % p.w, oy: (i.oy + dy + p.h) % p.h }));
      return true;
    };
    const setSource = (cell: number) => session.setInteraction((i) => ({ ...i, source: cell, cursor: cell }));

    if (session.interaction.drag) session.setInteraction((i) => ({ ...i, drag: null }));

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();

    return {
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
      commands: bindCommands(netView.bindings, {
        "net.left": move(-1, 0),
        "net.right": move(1, 0),
        "net.up": move(0, -1),
        "net.down": move(0, 1),
        "net.rotate-cw": atCursor((c) => rotate(c, 1)),
        "net.rotate-ccw": atCursor((c) => rotate(c, -1)),
        "net.rotate-half": atCursor((c) => rotate(c, 2)),
        "net.lock": atCursor((c) => session.dispatch({ type: "lock", cells: [c] })),
        "net.source": atCursor(setSource),
        "net.shift-left": shift(1, 0),
        "net.shift-right": shift(-1, 0),
        "net.shift-up": shift(0, 1),
        "net.shift-down": shift(0, -1),
        "net.recentre": () => {
          if (!p.wrap) return false;
          const src = session.interaction.source;
          session.setInteraction((i) => ({
            ...i,
            ox: ((src % p.w) - Math.floor(p.w / 2) + p.w) % p.w,
            oy: (Math.floor(src / p.w) - Math.floor(p.h / 2) + p.h) % p.h,
          }));
          return true;
        },
        "net.rotate-cw-at": pointerCell((c) => {
          session.setInteraction((i) => ({ ...i, cursor: c }));
          rotate(c, 1);
        }),
        "net.rotate-ccw-at": pointerCell((c) => {
          session.setInteraction((i) => ({ ...i, cursor: c }));
          rotate(c, -1);
        }),
        "net.lock-at": pointerCell(startPaint),
        "net.source-at": pointerCell(setSource),
      }),
    };
  },
};
