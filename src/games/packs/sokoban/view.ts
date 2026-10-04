import { animate, ease, lerp, type Animation } from "../../core/anim";
import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, s, style } from "../../core/dom";
import type { View, WidgetDef } from "../../core/types";
import type { SokoAction, SokoFocus, SokoInteraction, SokoPuzzle, SokoState } from "./logic";
import { STUCK_KEY } from "./plugins";
import { FLOOR, boxRoute, stepFrom, walkPath, walkable } from "./solver";
import { sokoban } from "./logic";

const SIZE = 10;
const MS_PER_STEP = 60;

const CSS = `
.sokoban-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.sokoban-board .floor { fill: var(--cell); stroke: var(--border); stroke-width: 0.2; }
.sokoban-board .wall { fill: color-mix(in srgb, var(--text) 75%, var(--bg)); stroke: var(--text); stroke-width: 0.2; }
.sokoban-board .goal { fill: none; stroke: var(--accent); stroke-width: 0.8; }
.sokoban-board .box rect { fill: var(--sokoban-box, #c08a4a); stroke: color-mix(in srgb, var(--sokoban-box, #c08a4a) 50%, var(--text)); stroke-width: 0.6; }
.sokoban-board .box path { stroke: color-mix(in srgb, var(--sokoban-box, #c08a4a) 50%, var(--text)); stroke-width: 0.5; fill: none; }
.sokoban-board .box.home rect { fill: var(--accent); stroke: color-mix(in srgb, var(--accent) 50%, var(--text)); }
.sokoban-board .box.home path { stroke: color-mix(in srgb, var(--accent) 50%, var(--text)); }
.sokoban-board .box.stuck rect { fill: var(--danger); }
.sokoban-board .box.picked rect { stroke: var(--focus); stroke-width: 1; }
.sokoban-board .player { fill: var(--text); stroke: var(--bg); stroke-width: 0.6; }
.sokoban-board .faded { opacity: 0.3; }
.sokoban-board .ghost rect, .sokoban-board .ghost circle { fill: none; stroke: var(--text); stroke-width: 0.6; stroke-dasharray: 1.4 0.9; opacity: 0.75; }
.sokoban-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.sokoban-board .mark.goal-mark { stroke-dasharray: 1.4 0.9; }
.sokoban-board .arrow { fill: none; stroke: var(--hint); stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.sokoban-count { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

const BINDINGS = {
  "sokoban.up": { label: "step up", category: "sokoban", keys: ["ArrowUp", "w"], description: "step up, pushing a box if one is there" },
  "sokoban.right": { label: "step right", category: "sokoban", keys: ["ArrowRight", "d"], description: "step right, pushing a box if one is there" },
  "sokoban.down": { label: "step down", category: "sokoban", keys: ["ArrowDown", "s"], description: "step down, pushing a box if one is there" },
  "sokoban.left": { label: "step left", category: "sokoban", keys: ["ArrowLeft", "a"], description: "step left, pushing a box if one is there" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const swatch = (body: string) => `<svg viewBox="-0.5 -0.5 11 11"><rect width="10" height="10" fill="var(--cell)" stroke="var(--border)" stroke-width="0.2"/>${body}</svg>`;
const BOX = (fill: string) => `<rect x="1.2" y="1.2" width="7.6" height="7.6" rx="1" fill="${fill}" stroke="var(--text)" stroke-width="0.6"/>`;

export const sokoView: View<SokoPuzzle, SokoState, SokoAction, SokoInteraction> = {
  id: "sokoban.svg",
  name: "warehouse",
  puzzle: sokoban,
  controls: [
    { how: "click or tap a floor cell", what: "walk there" },
    { how: "click or tap a box next to the keeper", what: "push it one cell away" },
    { how: "click or tap a box further away, then a cell", what: "push that box to the cell, if it can get there without moving the others" },
  ],
  legend: [
    { sample: swatch(`<circle cx="5" cy="5" r="3" fill="var(--text)"/>`), meaning: "the warehouse keeper" },
    { sample: swatch(BOX("var(--sokoban-box, #c08a4a)")), meaning: "a box" },
    { sample: swatch(`<circle cx="5" cy="5" r="2.2" fill="none" stroke="var(--accent)" stroke-width="0.8"/>`), meaning: "a goal" },
    { sample: swatch(BOX("var(--accent)")), meaning: "a box on a goal" },
    { sample: swatch(BOX("var(--danger)")), meaning: "a stuck box: it can never reach a goal" },
    { sample: `<svg viewBox="-0.5 -0.5 11 11"><rect width="10" height="10" fill="color-mix(in srgb, var(--text) 75%, var(--bg))"/></svg>`, meaning: "a wall" },
    { sample: swatch(`<path d="M2 5H8M6 3L8 5L6 7" fill="none" stroke="var(--hint)" stroke-width="1.2"/>`), meaning: "hint: the push to make" },
  ],
  mount(root, { session }) {
    style("sokoban", CSS);
    const p = session.puzzle;
    const inside = walkable(p, new Set(), p.player);
    const near = (c: number) => {
      const x = c % p.w, y = Math.floor(c / p.w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < p.w && yy < p.h && inside[yy * p.w + xx]) return true;
      }
      return false;
    };
    const svg = s("svg", { viewBox: `-0.5 -0.5 ${p.w * SIZE + 1} ${p.h * SIZE + 1}`, class: "sokoban-board", role: "img", "aria-label": `sokoban, ${p.w} by ${p.h}` });
    const cellX = (c: number) => (c % p.w) * SIZE, cellY = (c: number) => Math.floor(c / p.w) * SIZE;
    for (let c = 0; c < p.w * p.h; c++) {
      if (p.cells[c] === FLOOR && inside[c]) svg.append(s("rect", { x: cellX(c), y: cellY(c), width: SIZE, height: SIZE, class: "floor" }));
      else if (p.cells[c] !== FLOOR && near(c)) svg.append(s("rect", { x: cellX(c), y: cellY(c), width: SIZE, height: SIZE, class: "wall" }));
    }
    for (const g of p.goals) svg.append(s("circle", { cx: cellX(g) + SIZE / 2, cy: cellY(g) + SIZE / 2, r: 2.2, class: "goal" }));
    const marks = s("g"), things = s("g"), ghost = s("g", { class: "ghost" }), over = s("g");
    svg.append(marks, things, ghost, over);
    root.append(svg);

    const makeBox = () => {
      const g = s("g", { class: "box" });
      g.append(s("rect", { x: 1.2, y: 1.2, width: 7.6, height: 7.6, rx: 1 }), s("path", { d: "M2.6 2.6L7.4 7.4M7.4 2.6L2.6 7.4" }));
      things.append(g);
      return g;
    };
    const player = s("circle", { cx: SIZE / 2, cy: SIZE / 2, r: 3, class: "player" });
    things.append(player);
    /** Box elements by the cell they're drawn on, with fractional positions while moving. */
    let boxEls = new Map<number, { el: SVGGElement; x: number; y: number }>();
    for (const b of session.state.boxes) boxEls.set(b, { el: makeBox(), x: cellX(b), y: cellY(b) });
    let px = cellX(session.state.player), py = cellY(session.state.player);
    const placeAll = () => {
      for (const v of boxEls.values()) v.el.setAttribute("transform", `translate(${v.x} ${v.y})`);
      player.setAttribute("transform", `translate(${px} ${py})`);
    };
    let anim: Animation | null = null;
    let lastState = session.state;
    let preview: SokoState | null = null;

    const dirBetween = (from: number, to: number) => [0, 1, 2, 3].find((d) => stepFrom(p, from, d) === to) ?? -1;

    /** Move the drawing from the last drawn state to the session's, animating a walk, or a walk and one push. */
    const sync = () => {
      const prev = lastState, next = session.state;
      lastState = next;
      anim?.cancel();
      const gone = prev.boxes.filter((c) => !next.boxes.includes(c));
      const came = next.boxes.filter((c) => !prev.boxes.includes(c));
      const pushDir = gone.length === 1 && came.length === 1 ? dirBetween(gone[0]!, came[0]!) : -1;
      const pushed = pushDir >= 0 && next.player === gone[0] ? { from: gone[0]!, to: came[0]!, dir: pushDir } : null;
      if (pushed) {
        const v = boxEls.get(pushed.from)!;
        boxEls.delete(pushed.from);
        boxEls.set(pushed.to, v);
      } else if (gone.length || came.length) {
        for (const v of boxEls.values()) v.el.remove();
        boxEls = new Map(next.boxes.map((c) => [c, { el: makeBox(), x: cellX(c), y: cellY(c) }]));
      }
      for (const [c, v] of boxEls) if (c !== pushed?.to) { v.x = cellX(c); v.y = cellY(c); }
      const finish = () => {
        px = cellX(next.player); py = cellY(next.player);
        for (const [c, v] of boxEls) { v.x = cellX(c); v.y = cellY(c); }
        placeAll();
      };
      const route = pushed
        ? walkPath(p, new Set(prev.boxes), prev.player, stepFrom(p, pushed.from, (pushed.dir + 2) % 4))
        : gone.length || came.length ? null : walkPath(p, new Set(prev.boxes), prev.player, next.player);
      if (!route || route.length > 60) { finish(); return; }
      if (pushed) route.push(pushed.dir);
      const pts: (readonly [number, number])[] = [[cellX(prev.player), cellY(prev.player)]];
      let at = prev.player;
      for (const d of route) { at = stepFrom(p, at, d); pts.push([cellX(at), cellY(at)]); }
      const steps = pts.length - 1;
      if (!steps) { finish(); return; }
      anim = animate(steps * MS_PER_STEP, (k) => {
        const t = Math.max(0, k) * steps, i = Math.min(steps - 1, Math.floor(t)), fr = t - i;
        px = lerp(pts[i]![0], pts[i + 1]![0], fr);
        py = lerp(pts[i]![1], pts[i + 1]![1], fr);
        if (pushed) {
          const v = boxEls.get(pushed.to)!, g = i === steps - 1 ? fr : 0;
          v.x = lerp(cellX(pushed.from), cellX(pushed.to), g);
          v.y = lerp(cellY(pushed.from), cellY(pushed.to), g);
        }
        placeAll();
      }, ease.linear);
      void anim.then((done) => { if (done) finish(); });
    };

    const render = () => {
      if (session.state !== lastState) sync();
      const st = session.state;
      const stuck = new Set((session.derived()[STUCK_KEY] as number[] | undefined) ?? []);
      const goals = new Set(p.goals);
      const picked = session.interaction.picked;
      for (const [b, v] of boxEls) {
        v.el.classList.toggle("home", goals.has(b));
        v.el.classList.toggle("stuck", stuck.has(b));
        v.el.classList.toggle("picked", b === picked);
        v.el.classList.toggle("faded", !!preview && !preview.boxes.includes(b));
      }
      player.classList.toggle("faded", !!preview && preview.player !== st.player);
      ghost.replaceChildren();
      if (preview) {
        for (const b of preview.boxes) if (!st.boxes.includes(b)) ghost.append(s("rect", { x: cellX(b) + 1.2, y: cellY(b) + 1.2, width: 7.6, height: 7.6, rx: 1 }));
        if (preview.player !== st.player) ghost.append(s("circle", { cx: cellX(preview.player) + SIZE / 2, cy: cellY(preview.player) + SIZE / 2, r: 3 }));
      }
      over.replaceChildren();
      const f = session.activeHint?.focus as SokoFocus | undefined;
      for (const b of f?.boxes ?? []) over.append(s("rect", { x: cellX(b) + 0.5, y: cellY(b) + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1.2, class: "mark" }));
      for (const c of f?.cells ?? []) over.append(s("rect", { x: cellX(c) + 0.5, y: cellY(c) + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1.2, class: "mark goal-mark" }));
      if (f?.pushes?.length) {
        const first = f.pushes[0]!;
        let at = first.box;
        const pts = [[cellX(at) + SIZE / 2, cellY(at) + SIZE / 2]];
        for (const m of f.pushes) { at = stepFrom(p, m.box, m.dir); pts.push([cellX(at) + SIZE / 2, cellY(at) + SIZE / 2]); }
        const last = pts[pts.length - 1]!, prevPt = pts[pts.length - 2]!;
        const dx = Math.sign(last[0]! - prevPt[0]!), dy = Math.sign(last[1]! - prevPt[1]!);
        const head = `M${last[0]! - dx * 2 - dy * 2} ${last[1]! - dy * 2 - dx * 2}L${last[0]} ${last[1]}L${last[0]! - dx * 2 + dy * 2} ${last[1]! - dy * 2 + dx * 2}`;
        over.append(s("path", { d: `M${pts.map((q) => q.join(" ")).join("L")}${head}`, class: "arrow" }));
      }
    };

    const cellAt = (e: PointerEvent): number => {
      const r = svg.getBoundingClientRect();
      const k = (p.w * SIZE + 1) / r.width;
      const x = Math.floor(((e.clientX - r.left) * k - 0.5) / SIZE), y = Math.floor(((e.clientY - r.top) * k - 0.5) / SIZE);
      return x < 0 || y < 0 || x >= p.w || y >= p.h ? -1 : y * p.w + x;
    };
    const pick = (b: number) => session.setInteraction((i) => (i.picked === b ? i : { ...i, picked: b }));
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.button !== 0) return;
      const c = cellAt(e);
      if (c < 0 || !inside[c]) return;
      e.preventDefault();
      if (session.locked) return;
      const st = session.state;
      if (st.boxes.includes(c)) {
        const d = [0, 1, 2, 3].find((k) => stepFrom(p, st.player, k) === c);
        if (d !== undefined) { pick(-1); session.dispatch({ type: "step", dir: d }); return; }
        pick(session.interaction.picked === c ? -1 : c);
        return;
      }
      const picked = session.interaction.picked;
      if (picked >= 0 && st.boxes.includes(picked)) {
        const route = boxRoute(p, st.boxes, st.player, picked, c);
        pick(-1);
        if (route?.length) session.batch(() => { for (const m of route) session.dispatch({ type: "push", box: m.box, dir: m.dir }); });
        return;
      }
      pick(-1);
      session.dispatch({ type: "walk", to: c });
    };
    svg.addEventListener("pointerdown", onDown);

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    placeAll();
    render();

    const stepDir = (d: number) => () => { pick(-1); session.dispatch({ type: "step", dir: d }); };
    const commands = bindCommands(BINDINGS, { "sokoban.up": stepDir(0), "sokoban.right": stepDir(1), "sokoban.down": stepDir(2), "sokoban.left": stepDir(3) });
    const rectOf = (c: number) => {
      const r = svg.getBoundingClientRect();
      const k = r.width / (p.w * SIZE + 1);
      return new DOMRect(r.left + (cellX(c) + 0.5) * k, r.top + (cellY(c) + 0.5) * k, SIZE * k, SIZE * k);
    };
    return {
      aspect: (p.w * SIZE + 1) / (p.h * SIZE + 1),
      cells: { cols: p.w, rows: p.h },
      commands,
      preview: (st) => {
        preview = st as SokoState | null;
        render();
      },
      locate: (focus) => {
        const f = focus as SokoFocus | undefined;
        return [...new Set([...(f?.boxes ?? []), ...(f?.cells ?? [])])].map(rectOf);
      },
      locateChange: (a, b) => {
        const x = a as SokoState, y = b as SokoState;
        const cells = new Set([x.player, y.player, ...x.boxes.filter((c) => !y.boxes.includes(c)), ...y.boxes.filter((c) => !x.boxes.includes(c))]);
        return [...cells].map(rectOf);
      },
      destroy() {
        anim?.cancel();
        offs.forEach((o) => o());
        svg.remove();
      },
    };
  },
};

export const countWidget: WidgetDef<SokoPuzzle, SokoState, SokoAction, SokoInteraction> = {
  id: "sokoban.count",
  name: "moves and pushes",
  description: "steps walked and boxes pushed so far",
  puzzles: [sokoban],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("sokoban", CSS);
    const box = h("div", { class: "sokoban-count", "aria-live": "polite" });
    el.append(box);
    const render = () => {
      const { moves, pushes } = session.state;
      box.textContent = `${moves} ${moves === 1 ? "move" : "moves"} · ${pushes} ${pushes === 1 ? "push" : "pushes"}`;
    };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
