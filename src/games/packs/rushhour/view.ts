import { animate, ease, lerp, type Animation } from "../../core/anim";
import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, s, style, inputIs } from "../../core/dom";
import type { View, WidgetDef } from "../../core/types";
import { rushhour, carName, type RushAction, type RushFocus, type RushInteraction, type RushPuzzle, type RushState } from "./logic";
import { exitAt, occupancy, reach } from "./solver";

const SIZE = 10;
const GAP = 0.8;
const MS_PER_CELL = 70;

const CSS = `
.rushhour-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.rushhour-board .floor { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.rushhour-board .frame { fill: none; stroke: var(--text); stroke-width: 0.8; }
.rushhour-board .wall { fill: var(--text); }
.rushhour-board .exit { stroke: var(--cell); stroke-width: 1.2; }
.rushhour-board .exit-arrow { fill: none; stroke: var(--text-dim); stroke-width: 0.7; stroke-linecap: round; stroke-linejoin: round; }
.rushhour-board .car { cursor: grab; }
.rushhour-board .car rect { stroke: color-mix(in srgb, currentColor 55%, var(--text)); stroke-width: 0.5; fill: currentColor; }
.rushhour-board .car text { fill: rgb(0 0 0 / 0.6); font: 700 4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.rushhour-board .car.selected rect { stroke: var(--focus); stroke-width: 0.9; }
.rushhour-board .car.faded { opacity: 0.3; }
.rushhour-board .ghost rect { fill: none; stroke: var(--text); stroke-width: 0.6; stroke-dasharray: 1.4 0.9; opacity: 0.7; }
.rushhour-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.rushhour-board .mark.to { stroke-dasharray: 1.4 0.9; }
.rushhour-board .mark.cell { fill: var(--hint); opacity: 0.25; stroke: none; }
${inputIs("pointer")} .rushhour-board .car.selected rect { stroke: color-mix(in srgb, currentColor 55%, var(--text)); stroke-width: 0.5; }
.rushhour-moves { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

const RED = "var(--rushhour-red, #d63a2f)";
/** Other cars by index; a theme can override any with --rushhour-1 … --rushhour-8. */
const PALETTE = ["#4f86c6", "#e0b23c", "#5aa36a", "#9a6fc0", "#e07b39", "#4bb3b3", "#c0587e", "#8a8f3a"];
const carColor = (i: number) => (i === 0 ? RED : `var(--rushhour-${((i - 1) % PALETTE.length) + 1}, ${PALETTE[(i - 1) % PALETTE.length]})`);

const BINDINGS = {
  "rushhour.next": { label: "next car", category: "rush hour", keys: ["bracketright", "c"], description: "pick the next car for the arrow keys" },
  "rushhour.prev": { label: "previous car", category: "rush hour", keys: ["bracketleft", "shift+c"], description: "pick the previous car for the arrow keys" },
  "rushhour.up": { label: "slide up", category: "rush hour", keys: ["ArrowUp", "w"], description: "slide the picked car one cell up" },
  "rushhour.down": { label: "slide down", category: "rush hour", keys: ["ArrowDown", "s"], description: "slide the picked car one cell down" },
  "rushhour.left": { label: "slide left", category: "rush hour", keys: ["ArrowLeft", "a"], description: "slide the picked car one cell left" },
  "rushhour.right": { label: "slide right", category: "rush hour", keys: ["ArrowRight", "d"], description: "slide the picked car one cell right" },
  "rushhour.far-up": { label: "slide all the way up", category: "rush hour", keys: ["shift+ArrowUp", "shift+w"], description: "slide the picked car up as far as it goes" },
  "rushhour.far-down": { label: "slide all the way down", category: "rush hour", keys: ["shift+ArrowDown", "shift+s"], description: "slide the picked car down as far as it goes" },
  "rushhour.far-left": { label: "slide all the way left", category: "rush hour", keys: ["shift+ArrowLeft", "shift+a"], description: "slide the picked car left as far as it goes" },
  "rushhour.far-right": { label: "slide all the way right", category: "rush hour", keys: ["shift+ArrowRight", "shift+d"], description: "slide the picked car right as far as it goes" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const swatch = (body: string, w = 20) => `<svg viewBox="-0.5 -0.5 ${w + 1} 11">${body}</svg>`;
const carSample = (color: string, len: number, label: string) =>
  `<rect x="${GAP}" y="${GAP}" width="${len * SIZE - 2 * GAP}" height="${SIZE - 2 * GAP}" rx="2" fill="${color}" stroke="var(--text)" stroke-width="0.5"/><text x="${(len * SIZE) / 2}" y="5.2" font-size="4" font-weight="700" font-family="var(--font)" text-anchor="middle" dominant-baseline="central" fill="rgb(0 0 0 / 0.6)">${label}</text>`;

export const rushView: View<RushPuzzle, RushState, RushAction, RushInteraction> = {
  id: "rushhour.svg",
  name: "lot",
  puzzle: rushhour,
  controls: [
    { how: "drag a car along its length", what: "slide it (any distance is one move)" },
    { how: "click or tap a car", what: "pick it for the arrow keys" },
  ],
  legend: [
    { sample: swatch(carSample(RED, 2, "A")), meaning: "the red car: get it to the exit" },
    { sample: swatch(carSample(PALETTE[0]!, 2, "B")), meaning: "another car (trucks are three long)" },
    { sample: swatch(`<rect width="10" height="10" fill="var(--text)"/>`, 10), meaning: "a wall" },
    { sample: swatch(`<path d="M3 2L8 5L3 8" fill="none" stroke="var(--text-dim)" stroke-width="0.7"/>`, 10), meaning: "the exit, on the right edge of the red car's row" },
    { sample: swatch(`<rect x="0.5" y="0.5" width="19" height="9" rx="2" fill="none" stroke="var(--hint)" stroke-width="0.9"/>`), meaning: "hint: the car to move" },
    { sample: swatch(`<rect x="0.5" y="0.5" width="19" height="9" rx="2" fill="none" stroke="var(--hint)" stroke-width="0.9" stroke-dasharray="1.4 0.9"/>`), meaning: "hint: where it goes" },
  ],
  mount(root, { session }) {
    style("rushhour", CSS);
    const p = session.puzzle;
    const row = p.cars[0]!.y;
    const vbW = (p.w + 1) * SIZE, vbH = p.h * SIZE;
    const svg = s("svg", { viewBox: `-1 -1 ${vbW + 2} ${vbH + 2}`, class: "rushhour-board", role: "img", "aria-label": `rush hour, ${p.w} by ${p.h}` });
    for (let c = 0; c < p.w * p.h; c++) {
      const x = (c % p.w) * SIZE, y = Math.floor(c / p.w) * SIZE;
      svg.append(s("rect", { x, y, width: SIZE, height: SIZE, class: p.walls.includes(c) ? "wall" : "floor" }));
    }
    svg.append(s("rect", { x: 0, y: 0, width: p.w * SIZE, height: p.h * SIZE, class: "frame" }));
    svg.append(s("line", { x1: p.w * SIZE, y1: row * SIZE + 0.6, x2: p.w * SIZE, y2: (row + 1) * SIZE - 0.6, class: "exit" }));
    svg.append(s("path", { d: `M${p.w * SIZE + 3} ${row * SIZE + 3}L${p.w * SIZE + 7} ${row * SIZE + 5}L${p.w * SIZE + 3} ${row * SIZE + 7}`, class: "exit-arrow" }));
    const marks = s("g"), ghost = s("g", { class: "ghost" }), carsLayer = s("g"), over = s("g");
    svg.append(marks, carsLayer, ghost, over);
    root.append(svg);

    const carEls = p.cars.map((car, i) => {
      const g = s("g", { class: "car", style: `color: ${carColor(i)}`, "data-car": i });
      const w = car.horizontal ? car.len * SIZE : SIZE, hgt = car.horizontal ? SIZE : car.len * SIZE;
      g.append(s("rect", { x: GAP, y: GAP, width: w - 2 * GAP, height: hgt - 2 * GAP, rx: 2 }));
      g.append(s("text", { x: w / 2, y: hgt / 2 + 0.2 }, carName(i)));
      carsLayer.append(g);
      return g;
    });
    const xy = (i: number, at: number) => {
      const car = p.cars[i]!;
      return car.horizontal ? ([at * SIZE, car.y * SIZE] as const) : ([car.x * SIZE, at * SIZE] as const);
    };
    /** Drawn place of each car (fractional while sliding). */
    const shown = session.state.pos.slice();
    const place = (i: number) => {
      const [x, y] = xy(i, shown[i]!);
      carEls[i]!.setAttribute("transform", `translate(${x} ${y})`);
    };
    let preview: RushState | null = null;
    let anims: Animation[] = [];
    let drag: { pointerId: number; car: number; start: number; origin: number; min: number; max: number; moved: boolean } | null = null;

    /** Where the state puts each car; the red car drives off once it reaches the exit. */
    const target = (st: RushState, i: number) => (i === 0 && st.pos[0] === exitAt(p) && session.solved ? exitAt(p) + 1.4 : st.pos[i]!);

    const render = () => {
      const st = session.state;
      for (const a of anims) a.cancel();
      anims = [];
      p.cars.forEach((_, i) => {
        if (drag?.car === i) return;
        const from = shown[i]!, to = target(st, i);
        if (from === to) { place(i); return; }
        anims.push(animate(Math.abs(to - from) * MS_PER_CELL, (k) => { shown[i] = lerp(from, to, Math.max(0, k)); place(i); }, ease.out));
      });
      const sel = session.interaction.selected;
      carEls.forEach((el, i) => {
        el.classList.toggle("selected", i === sel);
        el.classList.toggle("faded", !!preview && preview.pos[i] !== st.pos[i]);
      });
      ghost.replaceChildren();
      if (preview) {
        p.cars.forEach((car, i) => {
          if (preview!.pos[i] === st.pos[i]) return;
          const [x, y] = xy(i, preview!.pos[i]!);
          ghost.append(s("rect", { x: x + GAP, y: y + GAP, width: (car.horizontal ? car.len * SIZE : SIZE) - 2 * GAP, height: (car.horizontal ? SIZE : car.len * SIZE) - 2 * GAP, rx: 2 }));
        });
      }
      over.replaceChildren();
      marks.replaceChildren();
      const f = session.activeHint?.focus as RushFocus | undefined;
      const outline = (i: number, at: number, cls: string) => {
        const car = p.cars[i]!;
        const [x, y] = xy(i, at);
        over.append(s("rect", { x: x + 0.4, y: y + 0.4, width: (car.horizontal ? car.len * SIZE : SIZE) - 0.8, height: (car.horizontal ? SIZE : car.len * SIZE) - 0.8, rx: 2.2, class: cls }));
      };
      for (const i of f?.cars ?? []) outline(i, st.pos[i]!, "mark");
      if (f?.slide) outline(f.slide.car, f.slide.to, "mark to");
      for (const c of f?.cells ?? []) marks.append(s("rect", { x: (c % p.w) * SIZE, y: Math.floor(c / p.w) * SIZE, width: SIZE, height: SIZE, class: "mark cell" }));
    };

    const unit = () => {
      const r = svg.getBoundingClientRect();
      return r.width / (vbW + 2);
    };
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element).closest?.(".car");
      if (!el || drag || (e.pointerType !== "touch" && e.button !== 0)) return;
      e.preventDefault();
      const car = Number(el.getAttribute("data-car"));
      session.setInteraction((i) => (i.selected === car ? i : { ...i, selected: car }));
      if (session.locked) return;
      const r = reach(p, session.state.pos, occupancy(p, session.state.pos), car);
      svg.setPointerCapture?.(e.pointerId);
      const c = p.cars[car]!;
      drag = { pointerId: e.pointerId, car, start: c.horizontal ? e.clientX : e.clientY, origin: session.state.pos[car]!, min: r.min, max: r.max, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const c = p.cars[drag.car]!;
      const delta = ((c.horizontal ? e.clientX : e.clientY) - drag.start) / unit() / SIZE;
      if (Math.abs(delta) > 0.1) drag.moved = true;
      shown[drag.car] = Math.max(drag.min, Math.min(drag.max, drag.origin + delta));
      place(drag.car);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      drag = null;
      const to = Math.round(shown[d.car]!);
      if (!d.moved || to === d.origin || !session.dispatch({ type: "slide", car: d.car, to })) render();
    };
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
      session.hooks.solved.tap(render, { owner: "view" }),
    ];
    p.cars.forEach((_, i) => place(i));
    render();

    const pick = (step: number) => () => session.setInteraction((i) => ({ ...i, selected: (((i.selected < 0 ? 0 : i.selected) + step) % p.cars.length + p.cars.length) % p.cars.length }));
    const slide = (horizontal: boolean, dir: number, far: boolean) => () => {
      const car = Math.max(0, session.interaction.selected);
      if (p.cars[car]!.horizontal !== horizontal) return;
      const r = reach(p, session.state.pos, occupancy(p, session.state.pos), car);
      const to = far ? (dir > 0 ? r.max : r.min) : session.state.pos[car]! + dir;
      if (to >= r.min && to <= r.max) session.dispatch({ type: "slide", car, to });
    };
    const commands = bindCommands(BINDINGS, {
      "rushhour.next": pick(1),
      "rushhour.prev": pick(-1),
      "rushhour.up": slide(false, -1, false),
      "rushhour.down": slide(false, 1, false),
      "rushhour.left": slide(true, -1, false),
      "rushhour.right": slide(true, 1, false),
      "rushhour.far-up": slide(false, -1, true),
      "rushhour.far-down": slide(false, 1, true),
      "rushhour.far-left": slide(true, -1, true),
      "rushhour.far-right": slide(true, 1, true),
    });
    const carRect = (i: number) => carEls[i]!.getBoundingClientRect();
    return {
      aspect: (vbW + 2) / (vbH + 2),
      cells: { cols: p.w + 1, rows: p.h },
      commands,
      preview: (st) => {
        preview = st as RushState | null;
        render();
      },
      locate: (focus) => {
        const f = focus as RushFocus | undefined;
        return [...new Set([...(f?.cars ?? []), ...(f?.slide ? [f.slide.car] : [])])].map(carRect);
      },
      locateChange: (a, b) => {
        const x = (a as RushState).pos, y = (b as RushState).pos;
        return x.flatMap((v, i) => (v !== y[i] ? [carRect(i)] : []));
      },
      destroy() {
        for (const a of anims) a.cancel();
        offs.forEach((o) => o());
        svg.remove();
      },
    };
  },
};

export const movesWidget: WidgetDef<RushPuzzle, RushState, RushAction, RushInteraction> = {
  id: "rushhour.moves",
  name: "moves",
  description: "how many moves so far",
  puzzles: [rushhour],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("rushhour", CSS);
    const box = h("div", { class: "rushhour-moves", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `${session.state.moves} ${session.state.moves === 1 ? "move" : "moves"}`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
