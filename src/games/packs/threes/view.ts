import { animate, ease, lerp, type Animation } from "../../core/anim";
import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, s, style } from "../../core/dom";
import type { View, WidgetDef } from "../../core/types";
import { N, best, gameThrees, scoreOf, shift, type ActionThrees, type FocusThrees, type PuzzleThrees, type StateThrees } from "./logic";

const SIZE = 10;
const PAD = 0.8;
/** Height above the board for the tile that comes next. */
const HEAD = 12;
const SLIDE_MS = 110;
const POP_MS = 140;

const CSS = `
.t3-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.t3-board .back { fill: color-mix(in srgb, var(--text) 30%, var(--bg)); }
.t3-board .well { fill: color-mix(in srgb, var(--text) 10%, var(--bg)); }
.t3-board .tile text { font-family: var(--font); font-weight: 700; text-anchor: middle; dominant-baseline: central; }
.t3-board .faded { opacity: 0.25; }
.t3-board .ghost rect { fill: none; stroke: var(--text); stroke-width: 0.5; stroke-dasharray: 1.4 0.9; }
.t3-board .ghost text { fill: var(--text); opacity: 0.8; font-family: var(--font); font-weight: 700; text-anchor: middle; dominant-baseline: central; }
.t3-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.t3-board .entry { fill: none; stroke: var(--hint); stroke-width: 0.6; stroke-dasharray: 1.2 0.8; pointer-events: none; }
.t3-board .arrow { fill: none; stroke: var(--hint); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; opacity: 0.8; pointer-events: none; }
.t3-board .coming { fill: var(--text-dim); font: 600 2.6px var(--font); text-anchor: middle; dominant-baseline: central; }
.t3-score { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

/** Tile colors: a theme can override any with --t3-1, --t3-2, --t3-3 (the tiles from 3 up) and --t3-bonus. */
const fill = (v: number, bonus = false) => (bonus ? "var(--t3-bonus, #8bd17c)" : v === 1 ? "var(--t3-1, #66ccff)" : v === 2 ? "var(--t3-2, #ff6680)" : "var(--t3-3, #fffdf5)");
const ink = (v: number, bonus = false) => (bonus ? "#2b4a25" : v === 1 ? "#0b3b52" : v === 2 ? "#5a0f21" : "#6f655a");
const fontFor = (label: string) => [4.6, 4.6, 4.6, 4.2, 3.5, 2.9, 2.5][label.length] ?? 2.2;

const BINDINGS = {
  "threes.up": { label: "slide up", category: "threes", keys: ["ArrowUp", "w"] },
  "threes.right": { label: "slide right", category: "threes", keys: ["ArrowRight", "d"] },
  "threes.down": { label: "slide down", category: "threes", keys: ["ArrowDown", "s"] },
  "threes.left": { label: "slide left", category: "threes", keys: ["ArrowLeft", "a"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const sampleTile = (v: number, label = String(v), bonus = false) => `<svg viewBox="-0.5 -0.5 11 11"><rect x="0.4" y="0.4" width="9.2" height="9.2" rx="1" fill="${fill(v, bonus)}"/><text x="5" y="5.2" font-size="${fontFor(label)}" font-weight="700" font-family="var(--font)" text-anchor="middle" dominant-baseline="central" fill="${ink(v, bonus)}">${label}</text></svg>`;

export const viewThrees: View<PuzzleThrees, StateThrees, ActionThrees, null> = {
  id: "threes.svg",
  name: "board",
  puzzle: gameThrees,
  controls: [{ how: "swipe or drag across the board", what: "slide the tiles that way, one step" }],
  legend: [
    { sample: sampleTile(1), meaning: "a 1: it merges only with a 2" },
    { sample: sampleTile(2), meaning: "a 2: it merges only with a 1" },
    { sample: sampleTile(3), meaning: "from 3 up: two equal tiles merge into their double" },
    { sample: sampleTile(6, "+", true), meaning: "above the board: the tile that comes in next. a + is a bonus tile" },
    { sample: `<svg viewBox="-0.5 -0.5 11 11"><path d="M2 5H8M5.5 2.5L8 5L5.5 7.5" fill="none" stroke="var(--hint)" stroke-width="1.4"/></svg>`, meaning: "hint: the way to slide" },
  ],
  mount(root, { session }) {
    style("t3", CSS);
    const span = N * SIZE;
    const vb = { x: -1, y: -HEAD - 1, w: span + 2, h: span + HEAD + 2 };
    const svg = s("svg", { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, class: "t3-board", role: "img", "aria-label": "threes, 4 by 4" });
    svg.append(s("rect", { x: vb.x, y: vb.y, width: vb.w, height: vb.h, rx: 2, class: "back" }));
    for (let c = 0; c < N * N; c++) svg.append(s("rect", { x: (c % N) * SIZE + PAD, y: Math.floor(c / N) * SIZE + PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2, class: "well" }));
    const coming = s("g");
    const tiles = s("g"), ghost = s("g", { class: "ghost" }), over = s("g");
    svg.append(coming, tiles, ghost, over);
    root.append(svg);

    const cx = (c: number) => (c % N) * SIZE, cy = (c: number) => Math.floor(c / N) * SIZE;
    const makeTile = (v: number, label = String(v), bonus = false) => {
      const g = s("g", { class: "tile" });
      g.append(s("rect", { x: PAD, y: PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2, fill: fill(v, bonus) }));
      g.append(s("text", { x: SIZE / 2, y: SIZE / 2 + 0.2, "font-size": fontFor(label), fill: ink(v, bonus) }, label));
      tiles.append(g);
      return g;
    };
    const place = (g: SVGGElement, x: number, y: number, scale = 1) => {
      const o = (SIZE / 2) * (1 - scale);
      g.setAttribute("transform", `translate(${x + o} ${y + o}) scale(${scale})`);
    };
    const drawComing = (st: StateThrees) => {
      coming.replaceChildren();
      const k = 0.7;
      const g = s("g", { transform: `translate(${span / 2 - (SIZE * k) / 2} ${-HEAD + 0.6}) scale(${k})` });
      const label = st.bonus ? "+" : String(st.next);
      g.append(s("rect", { x: PAD, y: PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2, fill: fill(st.next, st.bonus) }));
      g.append(s("text", { x: SIZE / 2, y: SIZE / 2 + 0.2, "font-size": fontFor(label), fill: ink(st.next, st.bonus), "font-family": "var(--font)", "font-weight": 700, "text-anchor": "middle", "dominant-baseline": "central" }, label));
      coming.append(g, s("text", { x: span / 2 + SIZE * k * 0.5 + 2, y: -HEAD + 0.6 + (SIZE * k) / 2, class: "coming", "text-anchor": "start" }, "next"));
    };
    let els = new Map<number, SVGGElement>();
    const build = (st: StateThrees) => {
      tiles.replaceChildren();
      els = new Map();
      st.grid.forEach((v, c) => {
        if (!v) return;
        const g = makeTile(v);
        place(g, cx(c), cy(c));
        els.set(c, g);
      });
      drawComing(st);
    };
    build(session.state);
    let last = session.state;
    let anim: Animation | null = null;
    let preview: StateThrees | null = null;

    /** Animate prev → next when next is one slide of prev plus the tile that was coming; otherwise redraw. */
    const sync = () => {
      const prev = last, next = session.state;
      last = next;
      anim?.cancel();
      let dir = -1, born = -1;
      for (let d = 0; d < 4 && dir < 0; d++) {
        const r = shift(N, prev.grid, d);
        if (!r.changed) continue;
        const diff = next.grid.flatMap((v, c) => (v !== r.grid[c] ? [c] : []));
        if (diff.length === 1 && !r.grid[diff[0]!] && next.grid[diff[0]!] === prev.next) { dir = d; born = diff[0]!; }
      }
      if (dir < 0) { build(next); return; }
      const r = shift(N, prev.grid, dir);
      const moving = r.moves.map((m) => ({ el: els.get(m.from)!, from: m.from, to: m.to })).filter((m) => m.el);
      const step = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir]!;
      anim = animate(SLIDE_MS, (k) => {
        const t = Math.max(0, k);
        for (const m of moving) place(m.el, lerp(cx(m.from), cx(m.to), t), lerp(cy(m.from), cy(m.to), t));
      }, ease.out);
      void anim.then((done) => {
        if (!done) return;
        build(next);
        const pops = [...new Set(r.moves.filter((m) => m.merged).map((m) => m.to))];
        anim = animate(POP_MS, (k) => {
          const t = Math.max(0, k);
          for (const c of pops) { const el = els.get(c); if (el) place(el, cx(c), cy(c), 1 + 0.15 * Math.sin(Math.PI * t)); }
          const el = els.get(born);
          if (el) place(el, cx(born) - step[0]! * SIZE * (1 - t), cy(born) - step[1]! * SIZE * (1 - t));
        }, ease.linear);
      });
    };

    const render = () => {
      if (session.state !== last) sync();
      ghost.replaceChildren();
      tiles.classList.toggle("faded", !!preview);
      if (preview) {
        preview.grid.forEach((v, c) => {
          if (!v) return;
          ghost.append(s("rect", { x: cx(c) + PAD, y: cy(c) + PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2 }));
          ghost.append(s("text", { x: cx(c) + SIZE / 2, y: cy(c) + SIZE / 2 + 0.2, "font-size": fontFor(String(v)) }, String(v)));
        });
      }
      over.replaceChildren();
      const f = session.activeHint?.focus as FocusThrees | undefined;
      for (const c of f?.entries ?? []) over.append(s("rect", { x: cx(c) + 0.4, y: cy(c) + 0.4, width: SIZE - 0.8, height: SIZE - 0.8, rx: 1.4, class: "entry" }));
      for (const c of f?.cells ?? []) over.append(s("rect", { x: cx(c) + 0.4, y: cy(c) + 0.4, width: SIZE - 0.8, height: SIZE - 0.8, rx: 1.4, class: "mark" }));
      if (f?.dir !== undefined) {
        const m = span / 2, l = span * 0.28, hd = span * 0.09;
        const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f.dir]!;
        const tx = m + dx! * l, ty = m + dy! * l;
        over.append(s("path", { d: `M${m - dx! * l} ${m - dy! * l}L${tx} ${ty}M${tx - dx! * hd - dy! * hd} ${ty - dy! * hd - dx! * hd}L${tx} ${ty}L${tx - dx! * hd + dy! * hd} ${ty - dy! * hd + dx! * hd}`, class: "arrow" }));
      }
    };

    const go = (dir: number) => () => { session.dispatch({ type: "slide", dir }); };
    let swipe: { id: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (swipe || (e.pointerType !== "touch" && e.button !== 0)) return;
      e.preventDefault();
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
      svg.setPointerCapture?.(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      swipe = null;
      const r = svg.getBoundingClientRect();
      if (Math.max(Math.abs(dx), Math.abs(dy)) < r.width / 12 || session.locked) return;
      go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0))();
    };
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", () => { swipe = null; });

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    const rectOf = (c: number) => {
      const r = svg.getBoundingClientRect();
      const k = Math.min(r.width / vb.w, r.height / vb.h);
      const left = r.left + (r.width - vb.w * k) / 2, top = r.top + (r.height - vb.h * k) / 2;
      return new DOMRect(left + (cx(c) - vb.x) * k, top + (cy(c) - vb.y) * k, SIZE * k, SIZE * k);
    };
    return {
      aspect: vb.w / vb.h,
      cells: { cols: N, rows: N },
      commands: bindCommands(BINDINGS, { "threes.up": go(0), "threes.right": go(1), "threes.down": go(2), "threes.left": go(3) }),
      preview: (st) => {
        preview = st as StateThrees | null;
        render();
      },
      locate: (focus) => {
        const f = focus as FocusThrees | undefined;
        const cells = [...(f?.cells ?? []), ...(f?.entries ?? [])];
        if (cells.length) return cells.map(rectOf);
        return f?.dir !== undefined ? [svg.getBoundingClientRect()] : [];
      },
      locateChange: (a, b) => {
        const x = (a as StateThrees).grid, y = (b as StateThrees).grid;
        return x.flatMap((v, c) => (v !== y[c] ? [rectOf(c)] : []));
      },
      destroy() {
        anim?.cancel();
        offs.forEach((o) => o());
        svg.remove();
      },
    };
  },
};

export const scoreWidget: WidgetDef<PuzzleThrees, StateThrees, ActionThrees, null> = {
  id: "threes.score",
  name: "score",
  description: "what the tiles on the board are worth, and the biggest tile",
  puzzles: [gameThrees],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("t3", CSS);
    const box = h("div", { class: "t3-score", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `score ${scoreOf(session.state.grid)} · best tile ${best(session.state.grid)}`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
