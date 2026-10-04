import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import type { View } from "../../core/types";
import { DOWN, LEFT, RIGHT, UP, edgeGrid, step } from "../../lib/edges";
import type { Focus } from "../../lib/grid-kit/names";
import { KIT_CSS, SIZE, drawFocus, focusCells, focusLegend, frame, sample, sampleCell, type BoardPrefs } from "../../lib/grid-kit/view";
import { type ZipAction, type ZipFocus, type ZipPuzzle, type ZipState } from "./logic";
import { CONFLICTS_KEY } from "./plugins";
import { board } from "./solver";

const CSS = `
.zip-board .visited { fill: var(--accent); opacity: 0.16; pointer-events: none; }
.zip-board .bad { fill: var(--danger-soft); pointer-events: none; }
.zip-board .wall { stroke: var(--text); stroke-width: 1.4; stroke-linecap: round; pointer-events: none; }
.zip-board .trail { fill: none; stroke: var(--accent); stroke-width: 4.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.zip-board .trail.faded { opacity: 0.25; }
.zip-board .head { fill: none; stroke: var(--accent); stroke-width: 0.9; pointer-events: none; }
.zip-board .badge { fill: var(--text); pointer-events: none; }
.zip-board .badge.done { fill: color-mix(in srgb, var(--accent) 70%, var(--text)); }
.zip-board .num { fill: var(--bg); font: 700 4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.zip-board .route { fill: none; stroke: var(--hint); stroke-width: 1.4; stroke-dasharray: 1.6 1; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
`;

const BINDINGS: BindingSchema = {
  "zip.up": { label: "path up", category: "zip", keys: ["ArrowUp", "w"], description: "carry the path on upwards (or take back its last step, if that's where it came from)" },
  "zip.right": { label: "path right", category: "zip", keys: ["ArrowRight", "d"], description: "carry the path on to the right (or take back its last step)" },
  "zip.down": { label: "path down", category: "zip", keys: ["ArrowDown", "s"], description: "carry the path on downwards (or take back its last step)" },
  "zip.left": { label: "path left", category: "zip", keys: ["ArrowLeft", "a"], description: "carry the path on to the left (or take back its last step)" },
  "zip.back": { label: "step back", category: "zip", keys: ["Backspace"], description: "take back the path's last step" },
};

function legend(): { sample: string; meaning: string }[] {
  const badge = `<circle cx="5" cy="5" r="3.2" fill="var(--text)"/><text x="5" y="5.2" font-size="4" font-weight="700" font-family="var(--font)" text-anchor="middle" dominant-baseline="central" fill="var(--bg)">1</text>`;
  return [
    { sample: sample(sampleCell() + badge), meaning: "a number: the path passes the numbers in order, starting on 1 and ending on the last" },
    { sample: sample(sampleCell(0) + sampleCell(10) + `<path d="M5 5H15" stroke="var(--accent)" stroke-width="4.2" stroke-linecap="round"/>`, 2), meaning: "the path" },
    { sample: sample(sampleCell(0) + sampleCell(10) + `<path d="M10 0V10" stroke="var(--text)" stroke-width="1.4" stroke-linecap="round"/>`, 2), meaning: "a wall: the path can't cross it" },
    { sample: sample(`<rect width="10" height="10" fill="var(--danger-soft)" stroke="var(--border)" stroke-width="0.25"/>`), meaning: "can't work any more: a stuck path, a cell with too few ways in, or cells cut off" },
    { sample: sample(sampleCell(0) + sampleCell(10) + `<path d="M5 5H15" stroke="var(--hint)" stroke-width="1.4" stroke-dasharray="1.6 1" stroke-linecap="round"/>`, 2), meaning: "hint: where the path goes next" },
    ...focusLegend("the cells it adds", "the reason").slice(0, 2),
  ];
}


export function zipView(prefs: BoardPrefs): View<ZipPuzzle, ZipState, ZipAction, null> {
  return {
    id: "zip.svg",
    name: "grid",
    puzzle: "zip",
    controls: [
      { how: "drag from the end of the path", what: "draw it on; drag back over it to take steps back" },
      { how: "click or tap a cell on the path", what: "cut the path back to there" },
      { how: "click or tap a cell next to the end of the path", what: "take one step there" },
    ],
    legend: legend(),
    mount(root, { session }) {
      style("kit", KIT_CSS);
      style("zip", CSS);
      const p = session.puzzle;
      const g = edgeGrid(p.w, p.h);
      const b = board(p);
      const f = frame(root, p, "zip-board", "zip", prefs);
      const mid = (c: number) => [f.cx(c) + SIZE / 2, f.cy(c) + SIZE / 2] as const;
      const tints: SVGRectElement[] = [], bads: SVGRectElement[] = [];
      for (let c = 0; c < g.n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.base.append(tints[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "visited", visibility: "hidden" }));
        f.base.append(bads[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "bad", visibility: "hidden" }));
      }
      for (const e of p.walls) {
        const a = g.ea[e]!, c = g.eb[e]!;
        const vertical = c === a + 1;
        const x = vertical ? f.cx(c) : f.cx(a), y = vertical ? f.cy(a) : f.cy(c);
        f.base.append(s("line", { x1: x, y1: y, x2: vertical ? x : x + SIZE, y2: vertical ? y + SIZE : y, class: "wall" }));
      }
      const trail = s("path", { class: "trail" });
      const headRing = s("circle", { r: 4.4, class: "head" });
      f.marks.append(trail, headRing);
      const badges: SVGCircleElement[] = [];
      const badgeLayer = s("g");
      f.svg.insertBefore(badgeLayer, f.ghost);
      for (let v = 1; v <= b.last; v++) {
        const [x, y] = mid(b.numCell[v]!);
        badgeLayer.append(badges[v] = s("circle", { cx: x, cy: y, r: 3.2, class: "badge" }));
        badgeLayer.append(s("text", { x, y: y + 0.2, class: "num" }, String(v)));
      }
      let preview: ZipState | null = null;
      const pathD = (cells: readonly number[]) => (cells.length < 2 ? "" : `M${cells.map((c) => mid(c).join(" ")).join("L")}`);

      const render = () => {
        const path = session.state.path;
        const on = new Set(path);
        const bad = session.derived()[CONFLICTS_KEY] as Record<string, number[]> | undefined;
        const flagged = new Set([...(bad?.stuck ?? []), ...(bad?.dead ?? []), ...(bad?.cut ?? [])]);
        for (let c = 0; c < g.n; c++) {
          tints[c]!.setAttribute("visibility", on.has(c) ? "visible" : "hidden");
          bads[c]!.setAttribute("visibility", flagged.has(c) ? "visible" : "hidden");
        }
        for (let v = 1; v <= b.last; v++) badges[v]!.classList.toggle("done", on.has(b.numCell[v]!));
        trail.setAttribute("d", pathD(path));
        trail.classList.toggle("faded", !!preview);
        const [hx, hy] = mid(path[path.length - 1]!);
        headRing.setAttribute("cx", String(hx));
        headRing.setAttribute("cy", String(hy));
        f.ghost.replaceChildren();
        if (preview) f.ghost.append(s("path", { d: pathD(preview.path), class: "trail" }));
        f.over.replaceChildren();
        const focus = session.activeHint?.focus as ZipFocus | undefined;
        drawFocus(f.over, f, focus as Focus | undefined);
        if (focus?.route?.length) f.over.append(s("path", { d: pathD(focus.route), class: "route" }));
      };

      const extend = (cells: number[]) => session.dispatch({ type: "extend", cells });
      const cutTo = (length: number) => session.dispatch({ type: "cut", length });
      const indexOf = (c: number) => session.state.path.indexOf(c);
      /** Step the path's end into neighbour n: back if n is where it came from, else on. */
      const stepInto = (n: number) => {
        const path = session.state.path;
        if (path.length > 1 && path[path.length - 2] === n) return cutTo(path.length - 1);
        return extend([n]);
      };

      let drag: { pointerId: number; moved: boolean } | null = null;
      const onDown = (e: PointerEvent) => {
        const c = f.cellAt(e);
        if (c < 0 || drag || session.locked || (e.pointerType !== "touch" && e.button !== 0)) return;
        e.preventDefault();
        f.svg.setPointerCapture?.(e.pointerId);
        drag = { pointerId: e.pointerId, moved: false };
        session.beginBatch();
        const i = indexOf(c);
        if (i >= 0) cutTo(i + 1);
        else stepInto(c);
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const c = f.cellAt(e);
        const path = session.state.path;
        let head = path[path.length - 1]!;
        if (c < 0 || c === head) return;
        drag.moved = true;
        for (let guard = 0; guard < 64 && head !== c; guard++) {
          const hx = head % p.w, hy = Math.floor(head / p.w), tx = c % p.w, ty = Math.floor(c / p.w);
          const next = hx !== tx ? step(g, head, tx > hx ? RIGHT : LEFT) : step(g, head, ty > hy ? DOWN : UP);
          if (!stepInto(next)) break;
          const now = session.state.path;
          head = now[now.length - 1]!;
        }
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag = null;
        session.endBatch();
      };
      f.svg.addEventListener("pointerdown", onDown);
      f.svg.addEventListener("pointermove", onMove);
      f.svg.addEventListener("pointerup", onUp);
      f.svg.addEventListener("pointercancel", onUp);

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked && drag) { drag = null; session.endBatch(); }
          render();
        }, { owner: "view" }),
      ];
      render();

      const dirTo = (d: number) => () => {
        const path = session.state.path;
        const n = step(g, path[path.length - 1]!, d);
        if (n >= 0) stepInto(n);
      };
      const commands = bindCommands(BINDINGS, {
        "zip.up": dirTo(UP),
        "zip.right": dirTo(RIGHT),
        "zip.down": dirTo(DOWN),
        "zip.left": dirTo(LEFT),
        "zip.back": () => cutTo(session.state.path.length - 1),
      }, { "zip.back": { menu: "board" } });

      return {
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        preview: (st) => {
          preview = st as ZipState | null;
          render();
        },
        locate: (focus) => f.rects([...focusCells(focus), ...((focus as ZipFocus | undefined)?.route ?? [])]),
        locateChange: (a, b2) => {
          const x = (a as ZipState).path, y = (b2 as ZipState).path;
          const i = x.findIndex((c, k) => c !== y[k]);
          const from = i < 0 ? Math.min(x.length, y.length) : i;
          return f.rects([...x.slice(Math.max(0, from - 1)), ...y.slice(Math.max(0, from - 1))]);
        },
        destroy() {
          if (drag) session.endBatch();
          offs.forEach((o) => o());
          f.destroy();
        },
      };
    },
  };
}
