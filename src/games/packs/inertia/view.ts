import { bindCommands, type BindingSchema } from "../../core/commands";
import { h, s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View, WidgetDef } from "../../core/types";
import { inertia, DIR_NAMES, GEM, MINE, STOP, WALL, gemCount, roll, type InertiaAction, type InertiaFocus, type InertiaInteraction, type InertiaPuzzle, type InertiaState } from "./logic";

const SIZE = 10;
const MS_PER_CELL = 45;

const CSS = `
.inertia-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.inertia-board .floor { fill: var(--cell); stroke: var(--border); stroke-width: 0.2; }
.inertia-board .wall { fill: var(--text); }
.inertia-board .stop { fill: none; stroke: var(--text-dim); stroke-width: 0.8; }
.inertia-board .mine { fill: var(--danger); }
.inertia-board .mine-spike { stroke: var(--danger); stroke-width: 0.8; }
.inertia-board .gem { fill: var(--gem, #2bb3c0); stroke: color-mix(in srgb, var(--gem, #2bb3c0) 60%, var(--text)); stroke-width: 0.4; }
.inertia-board .ball { fill: var(--accent); stroke: color-mix(in srgb, var(--accent) 50%, var(--text)); stroke-width: 0.6; transition: transform var(--roll, 0ms) linear; }
.inertia-board .ball.dead { fill: var(--danger); }
.inertia-board .aim { fill: none; stroke: var(--accent); stroke-width: 0.8; stroke-dasharray: 1.2 1; pointer-events: none; }
.inertia-board .aim.deadly { stroke: var(--danger); }
.inertia-board .mark { fill: none; stroke: var(--hint); pointer-events: none; }
.inertia-board .mark.path { stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; }
.inertia-board .mark.gem { stroke-width: 0.8; }
.inertia-board .ghost-ball { fill: none; stroke: var(--accent); stroke-width: 0.6; stroke-dasharray: 1 0.7; pointer-events: none; }
.inertia-board .faded { opacity: 0.35; }
@media (prefers-reduced-motion: reduce) { .inertia-board .ball { transition: none; } }
.inertia-count { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

const settings = defineSchema({
  aim: { type: "bool", label: "show where a roll would go", default: true, description: "while pointing, draw the path the ball would take in that direction" },
});

const KEYS: string[][] = [["ArrowUp", "w", "8"], ["e", "9"], ["ArrowRight", "d", "6"], ["c", "3"], ["ArrowDown", "s", "2"], ["z", "1"], ["ArrowLeft", "a", "4"], ["q", "7"]];
const BINDINGS: BindingSchema = Object.fromEntries(DIR_NAMES.map((name, d) => [`inertia.${name}`, { label: `roll ${name}`, category: "inertia", keys: KEYS[d]! }]));

const swatch = (body: string) => `<svg viewBox="-0.5 -0.5 11 11"><rect width="10" height="10" fill="var(--cell)" stroke="var(--border)" stroke-width="0.2"/>${body}</svg>`;
const GEM_SVG = `<path d="M5 2.2L7.8 5L5 7.8L2.2 5Z" fill="var(--gem, #2bb3c0)" stroke="color-mix(in srgb, var(--gem, #2bb3c0) 60%, var(--text))" stroke-width="0.4"/>`;
const MINE_SVG = `<circle cx="5" cy="5" r="2.2" fill="var(--danger)"/><path d="M5 1.6V8.4M1.6 5H8.4M2.6 2.6L7.4 7.4M7.4 2.6L2.6 7.4" stroke="var(--danger)" stroke-width="0.8"/>`;
const STOP_SVG = `<circle cx="5" cy="5" r="3.4" fill="none" stroke="var(--text-dim)" stroke-width="0.8"/>`;
const BALL_SVG = (fill: string) => `<circle cx="5" cy="5" r="3" fill="${fill}" stroke="color-mix(in srgb, var(--accent) 50%, var(--text))" stroke-width="0.6"/>`;

export const inertiaView: View<InertiaPuzzle, InertiaState, InertiaAction, InertiaInteraction, typeof settings> = {
  id: "inertia.svg",
  name: "grid",
  puzzle: inertia,
  settings,
  controls: [
    { how: "click or tap anywhere", what: "roll the ball toward that point (straight or diagonal, whichever of the eight directions is closest)" },
  ],
  legend: [
    { sample: swatch(BALL_SVG("var(--accent)")), meaning: "the ball" },
    { sample: swatch(GEM_SVG), meaning: "a gem: roll over it to collect it (it doesn't stop the ball)" },
    { sample: swatch(STOP_SVG), meaning: "a stop square: the ball halts here" },
    { sample: swatch(`<rect width="10" height="10" fill="var(--text)"/>`), meaning: "a wall: the ball halts in front of it" },
    { sample: swatch(MINE_SVG), meaning: "a mine: rolling onto it ends the game" },
    { sample: swatch(`<path d="M1 5H9" stroke="var(--accent)" stroke-width="0.8" stroke-dasharray="1.2 1"/>`), meaning: "where a roll in the aimed direction would go (red if it ends on a mine)" },
    { sample: swatch(`<path d="M1 5H9" stroke="var(--hint)" stroke-width="1"/>`), meaning: "hint: the roll to make" },
  ],
  mount(root, { session, settings }) {
    style("inertia", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const svg = s("svg", { viewBox: `-0.5 -0.5 ${p.w * SIZE + 1} ${p.h * SIZE + 1}`, class: "inertia-board", role: "grid", "aria-label": `${p.w} by ${p.h} inertia` });
    const gems: (SVGGElement | null)[] = [];
    for (let c = 0; c < n; c++) {
      const x = (c % p.w) * SIZE, y = Math.floor(c / p.w) * SIZE;
      const k = p.grid[c]!;
      if (k === WALL) { svg.append(s("rect", { x, y, width: SIZE, height: SIZE, class: "wall" })); gems.push(null); continue; }
      svg.append(s("rect", { x, y, width: SIZE, height: SIZE, class: "floor" }));
      const g = s("g", { transform: `translate(${x} ${y})` });
      g.innerHTML = k === STOP ? STOP_SVG : k === MINE ? MINE_SVG : k === GEM ? GEM_SVG : "";
      svg.append(g);
      gems.push(k === GEM ? g : null);
    }
    const aim = s("path", { class: "aim", visibility: "hidden" });
    const overlay = s("g");
    const ball = s("circle", { cx: 0, cy: 0, r: 3, class: "ball" });
    const ghostBall = s("circle", { cx: 0, cy: 0, r: 3, class: "ghost-ball", visibility: "hidden" });
    svg.append(aim, overlay, ghostBall, ball);
    let previewing: InertiaState | null = null;
    root.append(svg);

    const centre = (c: number) => [(c % p.w) * SIZE + SIZE / 2, Math.floor(c / p.w) * SIZE + SIZE / 2] as const;
    let lastPos = session.state.pos;
    const render = () => {
      const st = session.state;
      gems.forEach((g, c) => {
        if (!g) return;
        const ghosted = !!previewing && !!previewing.gems[c] !== !!st.gems[c];
        g.setAttribute("visibility", st.gems[c] || ghosted ? "visible" : "hidden");
        g.classList.toggle("faded", ghosted);
      });
      const away = previewing && previewing.pos !== st.pos ? centre(previewing.pos) : null;
      ghostBall.setAttribute("visibility", away ? "visible" : "hidden");
      if (away) { ghostBall.setAttribute("cx", String(away[0])); ghostBall.setAttribute("cy", String(away[1])); }
      const [bx, by] = centre(st.pos);
      const steps = Math.max(Math.abs((st.pos % p.w) - (lastPos % p.w)), Math.abs(Math.floor(st.pos / p.w) - Math.floor(lastPos / p.w)));
      ball.style.setProperty("--roll", `${steps * MS_PER_CELL}ms`);
      ball.style.transform = `translate(${bx}px, ${by}px)`;
      ball.classList.toggle("dead", st.dead);
      lastPos = st.pos;
      overlay.replaceChildren();
      const f = session.activeHint?.focus as InertiaFocus | undefined;
      if (f?.path?.length) {
        const pts = [st.pos, ...f.path].map((c) => centre(c).join(" "));
        overlay.append(s("path", { d: `M${pts.join("L")}`, class: "mark path" }));
      }
      for (const c of f?.gems ?? []) {
        const [cx, cy] = centre(c);
        overlay.append(s("circle", { cx, cy, r: 4.2, class: "mark gem" }));
      }
      drawAim();
    };

    const drawAim = () => {
      const d = session.interaction.aim;
      if (!settings.aim || d < 0 || session.state.dead || session.locked) { aim.setAttribute("visibility", "hidden"); return; }
      const r = roll(p, session.state.pos, d);
      if (!r.path.length) { aim.setAttribute("visibility", "hidden"); return; }
      const pts = [session.state.pos, ...r.path].map((c) => centre(c).join(" "));
      aim.setAttribute("d", `M${pts.join("L")}`);
      aim.classList.toggle("deadly", r.dead);
      aim.setAttribute("visibility", "visible");
    };

    /** Nearest of the eight directions from the ball to the pointer, or -1 on the ball itself. */
    const dirAt = (e: PointerEvent): number => {
      const r = svg.getBoundingClientRect();
      const ux = ((e.clientX - r.left) / r.width) * (p.w * SIZE + 1) - 0.5, uy = ((e.clientY - r.top) / r.height) * (p.h * SIZE + 1) - 0.5;
      const [bx, by] = centre(session.state.pos);
      const dx = ux - bx, dy = uy - by;
      if (Math.hypot(dx, dy) < SIZE / 2) return -1;
      const angle = Math.atan2(dx, -dy);
      return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
    };
    const setAim = (d: number) => session.setInteraction((i) => (i.aim === d ? i : { ...i, aim: d }));
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const d = dirAt(e);
      if (d >= 0) session.dispatch({ type: "move", dir: d });
      if (e.pointerType !== "mouse") setAim(-1);
    };
    const onMove = (e: PointerEvent) => { if (e.pointerType === "mouse") setAim(dirAt(e)); };
    const onLeave = () => setAim(-1);
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerleave", onLeave);

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(drawAim, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    const cellRect = (c: number) => {
      const r = svg.getBoundingClientRect();
      const k = r.width / (p.w * SIZE + 1);
      return new DOMRect(r.left + ((c % p.w) * SIZE + 0.5) * k, r.top + (Math.floor(c / p.w) * SIZE + 0.5) * k, SIZE * k, SIZE * k);
    };
    return {
      aspect: (p.w * SIZE + 1) / (p.h * SIZE + 1),
      cells: { cols: p.w, rows: p.h },
      commands: bindCommands(BINDINGS, Object.fromEntries(DIR_NAMES.map((name, d) => [`inertia.${name}`, () => session.dispatch({ type: "move", dir: d })]))),
      preview: (state) => {
        previewing = state as InertiaState | null;
        render();
      },
      locate: (focus) => {
        const f = focus as InertiaFocus | undefined;
        return [...new Set([...(f?.path ?? []), ...(f?.gems ?? [])])].map(cellRect);
      },
      locateChange: (a, b) => {
        const x = a as InertiaState, y = b as InertiaState;
        const cells = new Set([x.pos, y.pos]);
        x.gems.forEach((g, c) => { if (g !== y.gems[c]) cells.add(c); });
        return [...cells].map(cellRect);
      },
      destroy() {
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};

export const gemsWidget: WidgetDef<InertiaPuzzle, InertiaState, InertiaAction, InertiaInteraction> = {
  id: "inertia.gems",
  name: "gems left",
  description: "gems still to collect",
  puzzles: [inertia],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("inertia", CSS);
    const box = h("div", { class: "inertia-count", "aria-live": "polite" });
    el.append(box);
    const render = () => {
      const n = gemCount(session.state.gems);
      box.textContent = `${n} ${n === 1 ? "gem" : "gems"} left`;
    };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
