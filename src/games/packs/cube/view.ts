import { bindCommands, type BindingSchema } from "../../core/commands";
import { h, s, style } from "../../core/dom";
import type { View, WidgetDef } from "../../core/types";
import { SOLIDS } from "./geometry";
import { arena, type CubeAction, type CubeFocus, type CubePuzzle, type CubeState } from "./logic";
import { animate, ease, type Animation } from "../../core/anim";
import { add, cross, dot, hull, norm, pose, rotate, signedAngle, sub, type V3 } from "./pose";

const UNIT = 10;
/** Oblique view: a point z above the arena is drawn this much up and to the right. */
const LIFT_X = 0.18, LIFT_Y = 0.55;
const BLUE = "var(--cube-blue, #3b6fd6)";
/** How long one roll takes on screen. */
const ROLL_MS = 200;

const CSS = `
.cube-board { display: block; width: 100%; height: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.cube-board .sq { fill: var(--cell); stroke: var(--border); stroke-width: 0.3; cursor: pointer; }
.cube-board .sq.blue { fill: ${BLUE}; }
.cube-board .sq.next:hover { stroke: var(--accent); stroke-width: 0.7; }
.cube-board .face { stroke: var(--text); stroke-width: 0.35; stroke-linejoin: round; pointer-events: none; }
.cube-board .face.plain { fill: color-mix(in srgb, var(--surface) 85%, transparent); }
.cube-board .face.blue { fill: ${BLUE}; fill-opacity: 0.85; }
.cube-board .shadow { fill: rgb(0 0 0 / 0.12); pointer-events: none; }
.cube-board .ghost { opacity: 0.45; pointer-events: none; }
.cube-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.8; stroke-linejoin: round; pointer-events: none; }
.cube-board .mark.route { stroke-dasharray: 1.4 1; stroke-width: 0.6; }
.cube-moves { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

const BINDINGS: BindingSchema = {
  "cube.left": { label: "roll left", category: "cube", keys: ["ArrowLeft", "a"] },
  "cube.right": { label: "roll right", category: "cube", keys: ["ArrowRight", "d"] },
  "cube.up": { label: "roll up", category: "cube", keys: ["ArrowUp", "w"] },
  "cube.down": { label: "roll down", category: "cube", keys: ["ArrowDown", "s"] },
};

const swatch = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;

export const cubeView: View<CubePuzzle, CubeState, CubeAction, null> = {
  id: "cube.svg",
  name: "arena",
  puzzle: "cube",
  controls: [{ how: "click or tap a square next to the solid", what: "roll the solid onto it" }],
  legend: [
    { sample: swatch(`<rect width="10" height="10" fill="var(--cell)" stroke="var(--border)" stroke-width="0.3"/>`), meaning: "a plain square" },
    { sample: swatch(`<rect width="10" height="10" fill="${BLUE}" stroke="var(--border)" stroke-width="0.3"/>`), meaning: "a blue square: land a plain face on it to pick it up" },
    { sample: swatch(`<path d="M2 8L8 8L8 2L2 2Z" fill="${BLUE}" fill-opacity="0.85" stroke="var(--text)" stroke-width="0.35"/>`), meaning: "a blue face of the solid" },
    { sample: swatch(`<path d="M2 8L8 8L8 2L2 2Z" fill="var(--surface)" stroke="var(--text)" stroke-width="0.35"/>`), meaning: "a plain face of the solid" },
    { sample: swatch(`<rect x="0.6" y="0.6" width="8.8" height="8.8" fill="none" stroke="var(--hint)" stroke-width="0.8"/>`), meaning: "hint: the blue square to fetch" },
    { sample: swatch(`<rect x="0.6" y="0.6" width="8.8" height="8.8" fill="none" stroke="var(--hint)" stroke-width="0.6" stroke-dasharray="1.4 1"/>`), meaning: "hint: squares on the suggested route" },
  ],
  mount(root, { session }) {
    style("cube", CSS);
    const p = session.puzzle;
    const a = arena(p);
    const solid = SOLIDS[p.solid];
    const xs = a.squares.flatMap((q) => q.points.map(([x]) => x)), ys = a.squares.flatMap((q) => q.points.map(([, y]) => y));
    const top = Math.max(...solid.vertices.map((v) => Math.hypot(...v))) * 2;
    const minX = Math.min(...xs) - 0.3, maxX = Math.max(...xs) + top * LIFT_X + 0.3;
    const minY = Math.min(...ys) - top * LIFT_Y - 0.3, maxY = Math.max(...ys) + 0.3;
    const svg = s("svg", {
      viewBox: `${minX * UNIT} ${minY * UNIT} ${(maxX - minX) * UNIT} ${(maxY - minY) * UNIT}`,
      class: "cube-board", role: "grid", "aria-label": `${p.solid} arena`,
    });
    const poly = (pts: [number, number][]) => pts.map(([x, y]) => `${(x * UNIT).toFixed(2)},${(y * UNIT).toFixed(2)}`).join(" ");
    const cells = a.squares.map((q, i) => s("polygon", { points: poly(q.points), class: "sq", "data-sq": i }));
    const marks = s("g"), body = s("g"), ghost = s("g", { class: "ghost" });
    svg.append(...cells, marks, body, ghost);
    root.append(svg);

    const project = ([x, y, z]: V3): [number, number] => [x + z * LIFT_X, y - z * LIFT_Y];
    const view: V3 = [-LIFT_X, LIFT_Y, 1];
    /** The solid drawn from vertex positions: its shadow straight down, then the faces turned toward the viewer. */
    const drawSolid = (g: SVGGElement, world: readonly V3[], blueFaces: readonly number[]) => {
      g.replaceChildren(s("polygon", { points: poly(hull(world.map(([x, y]) => [x, y]))), class: "shadow" }));
      const centre = world.reduce<V3>((acc, v) => [acc[0] + v[0] / world.length, acc[1] + v[1] / world.length, acc[2] + v[2] / world.length], [0, 0, 0]);
      solid.faces.forEach((vs, i) => {
        const pts = vs.map((v) => world[v]!);
        const [p0, p1, p2] = pts as [V3, V3, V3];
        let n = cross(sub(p1, p0), sub(p2, p0));
        const mid = pts.reduce<V3>((acc, v) => [acc[0] + v[0] / pts.length, acc[1] + v[1] / pts.length, acc[2] + v[2] / pts.length], [0, 0, 0]);
        if (dot(n, sub(mid, centre)) < 0) n = [-n[0], -n[1], -n[2]];
        if (dot(n, view) > 1e-6) g.append(s("polygon", { points: poly(pts.map(project)), class: `face ${blueFaces[i] ? "blue" : "plain"}` }));
      });
    };

    let rolling: Animation | null = null;
    let previewing: CubeState | null = null;
    const drawBoard = (st: CubeState) => {
      const near = new Set(a.links[st.square]!.map((l) => l.to));
      cells.forEach((c, i) => {
        c.classList.toggle("blue", !!st.blue[i]);
        c.classList.toggle("next", near.has(i));
      });
      marks.replaceChildren();
      const f = session.activeHint?.focus as CubeFocus | undefined;
      for (const i of f?.route ?? []) if (i !== f?.target) marks.append(s("polygon", { points: poly(a.squares[i]!.points), class: "mark route" }));
      if (f?.target !== undefined) marks.append(s("polygon", { points: poly(a.squares[f.target]!.points), class: "mark" }));
    };
    const drawGhost = () => {
      ghost.replaceChildren();
      const g = previewing;
      if (!g) return;
      const st = session.state;
      for (let i = 0; i < a.squares.length; i++) {
        if (g.blue[i] !== st.blue[i]) ghost.append(s("polygon", { points: poly(a.squares[i]!.points), class: `sq ${g.blue[i] ? "blue" : ""}` }));
      }
      if (g.square !== st.square || g.key.some((v, i) => v !== st.key[i]) || g.faces.some((v, i) => v !== st.faces[i])) {
        const solidG = s("g");
        drawSolid(solidG, pose(p, g), g.faces);
        ghost.append(solidG);
      }
    };
    const render = () => {
      if (rolling) return;
      const st = session.state;
      drawBoard(st);
      drawSolid(body, pose(p, st), st.faces);
      drawGhost();
    };

    /**
     * A roll between neighboring squares turns the solid about the edge both poses share. Anything
     * else (a jump through history, a new puzzle) just redraws.
     */
    const animateRoll = (prev: CubeState, next: CubeState) => {
      rolling?.cancel();
      rolling = null;
      if (!a.links[prev.square]!.some((l) => l.to === next.square)) return render();
      const w0 = pose(p, prev), w1 = pose(p, next);
      const pivot = w0.flatMap((v, i) => (Math.hypot(...sub(v, w1[i]!)) < 1e-6 ? [i] : []));
      if (pivot.length !== 2) return render();
      const o = w0[pivot[0]!]!, axis = norm(sub(w0[pivot[1]!]!, o));
      const moving = w0.findIndex((v, i) => !pivot.includes(i) && Math.hypot(...sub(v, w1[i]!)) > 1e-6);
      const angle = signedAngle(sub(w0[moving]!, o), sub(w1[moving]!, o), axis);
      drawBoard(prev);
      const anim = animate(ROLL_MS, (t) => {
        drawSolid(body, w0.map((v) => add(o, rotate(sub(v, o), axis, angle * t))), prev.faces);
      }, ease.inOut);
      rolling = anim;
      void anim.then(() => {
        if (rolling !== anim) return;
        rolling = null;
        render();
      });
    };

    const onDown = (e: PointerEvent) => {
      const v = (e.target as Element).getAttribute("data-sq");
      if (v === null || e.button !== 0) return;
      e.preventDefault();
      session.dispatch({ type: "roll", to: Number(v) });
    };
    svg.addEventListener("pointerdown", onDown);

    /** The neighbor lying most nearly in direction (dx, dy), if any is within 60°. */
    const toward = (dx: number, dy: number) => () => {
      const here = a.squares[session.state.square]!;
      let best = -1, bestCos = 0.5;
      for (const l of a.links[session.state.square]!) {
        const t = a.squares[l.to]!;
        const vx = t.x - here.x, vy = t.y - here.y;
        const cos = (vx * dx + vy * dy) / Math.hypot(vx, vy);
        if (cos > bestCos) { bestCos = cos; best = l.to; }
      }
      if (best >= 0) session.dispatch({ type: "roll", to: best });
    };

    const offs = [session.hooks.change.tap(({ prev, state }) => animateRoll(prev, state), { owner: "view" }), session.hooks.refresh.tap(render, { owner: "view" })];
    render();
    const rects = (list: Iterable<number>) => [...new Set(list)].map((i) => cells[i]!.getBoundingClientRect());
    return {
      aspect: (maxX - minX) / (maxY - minY),
      cells: { cols: Math.ceil(maxX - minX), rows: Math.ceil(maxY - minY) },
      commands: bindCommands(BINDINGS, {
        "cube.left": toward(-1, 0),
        "cube.right": toward(1, 0),
        "cube.up": toward(0, -1),
        "cube.down": toward(0, 1),
      }),
      preview: (st) => {
        previewing = st as CubeState | null;
        drawGhost();
      },
      locate: (focus) => {
        const f = focus as CubeFocus | undefined;
        return rects([...(f?.route ?? []), ...(f?.target !== undefined ? [f.target] : [])]);
      },
      locateChange: (x, y) => {
        const a1 = x as CubeState, b1 = y as CubeState;
        return rects([a1.square, b1.square, ...a1.blue.flatMap((v, i) => (v !== b1.blue[i] ? [i] : []))]);
      },
      destroy() {
        rolling?.cancel();
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};

export const facesWidget: WidgetDef<CubePuzzle, CubeState, CubeAction, null> = {
  id: "cube.faces",
  name: "faces",
  description: "blue faces so far, and rolls made",
  puzzles: ["cube"],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("cube", CSS);
    const box = h("div", { class: "cube-moves", "aria-live": "polite" });
    el.append(box);
    const render = () => {
      const st = session.state;
      box.textContent = `${st.faces.filter(Boolean).length} / ${st.faces.length} faces blue · ${st.moves} ${st.moves === 1 ? "roll" : "rolls"}`;
    };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
