import { animate, ease, lerp, type Animation } from "../../core/anim";
import { bindCommands, type BindingSchema } from "../../core/commands";
import { h, s, style } from "../../core/dom";
import type { View, WidgetDef } from "../../core/types";
import { best, slide, tileValue, type Action2048, type Focus2048, type Puzzle2048, type State2048 } from "./logic";

const SIZE = 10;
const PAD = 0.8;
const SLIDE_MS = 110;
const POP_MS = 140;

const CSS = `
.t2048-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.t2048-board .back { fill: color-mix(in srgb, var(--text) 30%, var(--bg)); }
.t2048-board .well { fill: color-mix(in srgb, var(--text) 10%, var(--bg)); }
.t2048-board .tile rect { stroke: none; }
.t2048-board .tile text { font-family: var(--font); font-weight: 700; text-anchor: middle; dominant-baseline: central; }
.t2048-board .faded { opacity: 0.25; }
.t2048-board .ghost rect { fill: none; stroke: var(--text); stroke-width: 0.5; stroke-dasharray: 1.4 0.9; }
.t2048-board .ghost text { fill: var(--text); opacity: 0.8; font-family: var(--font); font-weight: 700; text-anchor: middle; dominant-baseline: central; }
.t2048-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.t2048-board .arrow { fill: none; stroke: var(--hint); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; opacity: 0.8; pointer-events: none; }
.t2048-score { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

/** Tile colors by value; a theme can override any with --t2048-2 … --t2048-2048 (and --t2048-big beyond). */
const COLORS: Record<number, [string, string]> = {
  1: ["#eee4da", "#776e65"], 2: ["#ede0c8", "#776e65"], 3: ["#f2b179", "#f9f6f2"], 4: ["#f59563", "#f9f6f2"],
  5: ["#f67c5f", "#f9f6f2"], 6: ["#f65e3b", "#f9f6f2"], 7: ["#edcf72", "#f9f6f2"], 8: ["#edcc61", "#f9f6f2"],
  9: ["#edc850", "#f9f6f2"], 10: ["#edc53f", "#f9f6f2"], 11: ["#edc22e", "#f9f6f2"],
};
const fill = (v: number) => (v <= 11 ? `var(--t2048-${tileValue(v)}, ${COLORS[v]![0]})` : "var(--t2048-big, #3c3a32)");
const ink = (v: number) => (v <= 11 ? COLORS[v]![1] : "#f9f6f2");
const fontFor = (v: number) => [4.6, 4.6, 4.6, 4.2, 3.5, 2.9, 2.5][String(tileValue(v)).length] ?? 2.2;

const BINDINGS: BindingSchema = {
  "2048.up": { label: "slide up", category: "2048", keys: ["ArrowUp", "w"] },
  "2048.right": { label: "slide right", category: "2048", keys: ["ArrowRight", "d"] },
  "2048.down": { label: "slide down", category: "2048", keys: ["ArrowDown", "s"] },
  "2048.left": { label: "slide left", category: "2048", keys: ["ArrowLeft", "a"] },
};

const sampleTile = (v: number) => `<svg viewBox="-0.5 -0.5 11 11"><rect x="0.4" y="0.4" width="9.2" height="9.2" rx="1" fill="${fill(v)}"/><text x="5" y="5.2" font-size="${fontFor(v)}" font-weight="700" font-family="var(--font)" text-anchor="middle" dominant-baseline="central" fill="${ink(v)}">${tileValue(v)}</text></svg>`;

export const view2048: View<Puzzle2048, State2048, Action2048, null> = {
  id: "2048.svg",
  name: "board",
  puzzle: "2048",
  controls: [{ how: "swipe or drag across the board", what: "slide the tiles that way" }],
  legend: [
    { sample: sampleTile(1), meaning: "a tile; two equal tiles that meet merge into their sum" },
    { sample: sampleTile(11), meaning: "the 2048 tile (the goal on the standard board)" },
    { sample: `<svg viewBox="-0.5 -0.5 11 11"><path d="M2 5H8M5.5 2.5L8 5L5.5 7.5" fill="none" stroke="var(--hint)" stroke-width="1.4"/></svg>`, meaning: "hint: the way to slide" },
  ],
  mount(root, { session }) {
    style("t2048", CSS);
    const p = session.puzzle;
    const n = p.size;
    const span = n * SIZE;
    const svg = s("svg", { viewBox: `-1 -1 ${span + 2} ${span + 2}`, class: "t2048-board", role: "img", "aria-label": `2048, ${n} by ${n}` });
    svg.append(s("rect", { x: -1, y: -1, width: span + 2, height: span + 2, rx: 2, class: "back" }));
    for (let c = 0; c < n * n; c++) svg.append(s("rect", { x: (c % n) * SIZE + PAD, y: Math.floor(c / n) * SIZE + PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2, class: "well" }));
    const tiles = s("g"), ghost = s("g", { class: "ghost" }), over = s("g");
    svg.append(tiles, ghost, over);
    root.append(svg);

    const cx = (c: number) => (c % n) * SIZE, cy = (c: number) => Math.floor(c / n) * SIZE;
    const makeTile = (v: number) => {
      const g = s("g", { class: "tile" });
      g.append(s("rect", { x: PAD, y: PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2, fill: fill(v) }));
      g.append(s("text", { x: SIZE / 2, y: SIZE / 2 + 0.2, "font-size": fontFor(v), fill: ink(v) }, String(tileValue(v))));
      tiles.append(g);
      return g;
    };
    const place = (g: SVGGElement, x: number, y: number, scale = 1) => {
      const o = (SIZE / 2) * (1 - scale);
      g.setAttribute("transform", `translate(${x + o} ${y + o}) scale(${scale})`);
    };
    let els = new Map<number, SVGGElement>();
    const build = (grid: readonly number[]) => {
      tiles.replaceChildren();
      els = new Map();
      grid.forEach((v, c) => {
        if (!v) return;
        const g = makeTile(v);
        place(g, cx(c), cy(c));
        els.set(c, g);
      });
    };
    build(session.state.grid);
    let last = session.state;
    let anim: Animation | null = null;
    let preview: State2048 | null = null;

    /** Animate prev → next when next is one slide of prev plus its new tile; otherwise redraw. */
    const sync = () => {
      const prev = last, next = session.state;
      last = next;
      anim?.cancel();
      let dir = -1, born = -1;
      for (let d = 0; d < 4 && dir < 0; d++) {
        const r = slide(n, prev.grid, d);
        if (!r.changed) continue;
        const diff = next.grid.flatMap((v, c) => (v !== r.grid[c] ? [c] : []));
        if (diff.length === 1 && !r.grid[diff[0]!]) { dir = d; born = diff[0]!; }
      }
      if (dir < 0) { build(next.grid); return; }
      const r = slide(n, prev.grid, dir);
      const moving = r.moves.map((m) => ({ el: els.get(m.from)!, from: m.from, to: m.to })).filter((m) => m.el);
      anim = animate(SLIDE_MS, (k) => {
        const t = Math.max(0, k);
        for (const m of moving) place(m.el, lerp(cx(m.from), cx(m.to), t), lerp(cy(m.from), cy(m.to), t));
      }, ease.out);
      const settle = anim;
      void settle.then((done) => {
        if (!done) return;
        build(next.grid);
        const pops = [...new Set(r.moves.filter((m) => m.merged).map((m) => m.to))];
        anim = animate(POP_MS, (k) => {
          const t = Math.max(0, k);
          for (const c of pops) { const el = els.get(c); if (el) place(el, cx(c), cy(c), 1 + 0.15 * Math.sin(Math.PI * t)); }
          const el = els.get(born);
          if (el) place(el, cx(born), cy(born), lerp(0.3, 1, t));
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
          ghost.append(s("text", { x: cx(c) + SIZE / 2, y: cy(c) + SIZE / 2 + 0.2, "font-size": fontFor(v) }, String(tileValue(v))));
        });
      }
      over.replaceChildren();
      const f = session.activeHint?.focus as Focus2048 | undefined;
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
      const k = r.width / (span + 2);
      return new DOMRect(r.left + (cx(c) + 1) * k, r.top + (cy(c) + 1) * k, SIZE * k, SIZE * k);
    };
    return {
      aspect: 1,
      cells: { cols: n, rows: n },
      commands: bindCommands(BINDINGS, { "2048.up": go(0), "2048.right": go(1), "2048.down": go(2), "2048.left": go(3) }),
      preview: (st) => {
        preview = st as State2048 | null;
        render();
      },
      locate: (focus) => {
        const f = focus as Focus2048 | undefined;
        if (f?.cells?.length) return f.cells.map(rectOf);
        return f?.dir !== undefined ? [svg.getBoundingClientRect()] : [];
      },
      locateChange: (a, b) => {
        const x = (a as State2048).grid, y = (b as State2048).grid;
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

export const scoreWidget: WidgetDef<Puzzle2048, State2048, Action2048, null> = {
  id: "2048.score",
  name: "score",
  description: "points so far (every merge scores the new tile) and the biggest tile",
  puzzles: ["2048"],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("t2048", CSS);
    const box = h("div", { class: "t2048-score", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `score ${session.state.score} · best tile ${tileValue(best(session.state.grid))}`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
