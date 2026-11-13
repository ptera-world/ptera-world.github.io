import { animate, ease, lerp, type Animation } from "../../core/anim";
import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, s, style } from "../../core/dom";
import type { View, WidgetDef } from "../../core/types";
import { BLOCK, best, gameMerge, mergeOf, move, scoreOf, type ActionMerge, type FocusMerge, type MergeRule, type PuzzleMerge, type StateMerge } from "./logic";

const SIZE = 10;
const PAD = 0.8;
/** Height above the board for the tile that comes next, when the rules show it. */
const HEAD = 12;
const SLIDE_MS = 110;
const POP_MS = 140;

const CSS = `
.tsm-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.tsm-board .back { fill: color-mix(in srgb, var(--text) 30%, var(--bg)); }
.tsm-board .well { fill: color-mix(in srgb, var(--text) 10%, var(--bg)); }
.tsm-board .block { fill: color-mix(in srgb, var(--text) 55%, var(--bg)); }
.tsm-board .tile rect { stroke: none; }
.tsm-board .tile text { font-family: var(--font); font-weight: 700; text-anchor: middle; dominant-baseline: central; }
.tsm-board .faded { opacity: 0.25; }
.tsm-board .ghost rect { fill: none; stroke: var(--text); stroke-width: 0.5; stroke-dasharray: 1.4 0.9; }
.tsm-board .ghost text { fill: var(--text); opacity: 0.8; font-family: var(--font); font-weight: 700; text-anchor: middle; dominant-baseline: central; }
.tsm-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.tsm-board .entry { fill: none; stroke: var(--hint); stroke-width: 0.6; stroke-dasharray: 1.2 0.8; pointer-events: none; }
.tsm-board .arrow { fill: none; stroke: var(--hint); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; opacity: 0.8; pointer-events: none; }
.tsm-board .coming { fill: var(--text-dim); font: 600 2.6px var(--font); text-anchor: middle; dominant-baseline: central; }
.tsm-score { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

/** 2048 colors by rank. */
const COLORS: Record<number, [string, string]> = {
  1: ["#eee4da", "#776e65"], 2: ["#ede0c8", "#776e65"], 3: ["#f2b179", "#f9f6f2"], 4: ["#f59563", "#f9f6f2"],
  5: ["#f67c5f", "#f9f6f2"], 6: ["#f65e3b", "#f9f6f2"], 7: ["#edcf72", "#f9f6f2"], 8: ["#edcc61", "#f9f6f2"],
  9: ["#edc850", "#f9f6f2"], 10: ["#edc53f", "#f9f6f2"], 11: ["#edc22e", "#f9f6f2"],
};

const starterRule = (m: MergeRule): boolean => m.rank(m.bases[0]!) === 0;

/**
 * Tile colors. Starter-pair rules (threes, fives) use threes' colors, which a theme can override
 * with --t3-1 and --t3-2 (the two starting tiles), --t3-3 (the tiles from the first rung up) and
 * --t3-bonus; the others use 2048's by rank, overridable with --t2048-2 … --t2048-2048 (named by
 * the 2048 tile of that rank) and --t2048-big beyond.
 */
function paint(m: MergeRule, v: number, bonus = false): [string, string] {
  if (starterRule(m)) {
    if (bonus) return ["var(--t3-bonus, #8bd17c)", "#2b4a25"];
    if (v === m.bases[0]) return ["var(--t3-1, #66ccff)", "#0b3b52"];
    if (v === m.bases[1]) return ["var(--t3-2, #ff6680)", "#5a0f21"];
    return ["var(--t3-3, #fffdf5)", "#6f655a"];
  }
  const r = m.rank(v);
  return r >= 1 && r <= 11 ? [`var(--t2048-${2 ** r}, ${COLORS[r]![0]})`, COLORS[r]![1]] : ["var(--t2048-big, #3c3a32)", "#f9f6f2"];
}
const fontFor = (label: string) => [4.6, 4.6, 4.6, 4.2, 3.5, 2.9, 2.5][label.length] ?? 2.2;

const BINDINGS = {
  "sliding-merge.up": { label: "slide up", category: "2048 / threes", keys: ["ArrowUp", "w"] },
  "sliding-merge.right": { label: "slide right", category: "2048 / threes", keys: ["ArrowRight", "d"] },
  "sliding-merge.down": { label: "slide down", category: "2048 / threes", keys: ["ArrowDown", "s"] },
  "sliding-merge.left": { label: "slide left", category: "2048 / threes", keys: ["ArrowLeft", "a"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const sample = (fillInk: [string, string], label: string) => `<svg viewBox="-0.5 -0.5 11 11"><rect x="0.4" y="0.4" width="9.2" height="9.2" rx="1" fill="${fillInk[0]}"/><text x="5" y="5.2" font-size="${fontFor(label)}" font-weight="700" font-family="var(--font)" text-anchor="middle" dominant-baseline="central" fill="${fillInk[1]}">${label}</text></svg>`;
const ARROW = `<svg viewBox="-0.5 -0.5 11 11"><path d="M2 5H8M5.5 2.5L8 5L5.5 7.5" fill="none" stroke="var(--hint)" stroke-width="1.4"/></svg>`;
const BLOCK_SAMPLE = `<svg viewBox="-0.5 -0.5 11 11"><rect x="0.4" y="0.4" width="9.2" height="9.2" rx="1" fill="color-mix(in srgb, var(--text) 55%, var(--bg))"/></svg>`;

function legend(p: PuzzleMerge): { sample: string; meaning: string }[] {
  const m = mergeOf(p);
  const tiles = starterRule(m)
    ? [
      { sample: sample(paint(m, m.bases[0]!), String(m.bases[0])), meaning: `a ${m.bases[0]}: it merges only with a ${m.bases[1]}` },
      { sample: sample(paint(m, m.bases[1]!), String(m.bases[1])), meaning: `a ${m.bases[1]}: it merges only with a ${m.bases[0]}` },
      { sample: sample(paint(m, m.value(1)), String(m.value(1))), meaning: `from ${m.value(1)} up: two equal tiles merge into their double` },
    ]
    : [{ sample: sample(paint(m, m.bases[0]!), String(m.bases[0])), meaning: p.rules.merge === "fibonacci" ? "a tile; neighbouring fibonacci numbers that meet merge into their sum" : "a tile; two equal tiles that meet merge into their sum" }];
  return [
    ...tiles,
    ...(p.start.includes(BLOCK) ? [{ sample: BLOCK_SAMPLE, meaning: "a block: it never moves and nothing merges with it" }] : []),
    ...(p.rules.preview ? [{ sample: sample(paint(m, m.value(2), p.rules.bonus), p.rules.bonus ? "+" : String(m.value(2))), meaning: `above the board: the tile that comes in next${p.rules.bonus ? ". a + is a bonus tile" : ""}` }] : []),
    { sample: ARROW, meaning: "hint: the way to slide" },
  ];
}

export const viewMerge: View<PuzzleMerge, StateMerge, ActionMerge, null> = {
  id: "sliding-merge.svg",
  name: "board",
  puzzle: gameMerge,
  controls: [{ how: "swipe or drag across the board", what: "slide the tiles that way" }],
  legend,
  mount(root, { session }) {
    style("tsm", CSS);
    const p = session.puzzle;
    const m = mergeOf(p);
    const n = p.size;
    const span = n * SIZE;
    const head = p.rules.preview ? HEAD : 0;
    const vb = { x: -1, y: -head - 1, w: span + 2, h: span + head + 2 };
    const svg = s("svg", { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, class: "tsm-board", role: "img", "aria-label": `${gameMerge.name}, ${n} by ${n}` });
    svg.append(s("rect", { x: vb.x, y: vb.y, width: vb.w, height: vb.h, rx: 2, class: "back" }));
    for (let c = 0; c < n * n; c++) {
      svg.append(s("rect", { x: (c % n) * SIZE + PAD, y: Math.floor(c / n) * SIZE + PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2, class: p.start[c] === BLOCK ? "block" : "well" }));
    }
    const coming = s("g"), tiles = s("g"), ghost = s("g", { class: "ghost" }), over = s("g");
    svg.append(coming, tiles, ghost, over);
    root.append(svg);

    const cx = (c: number) => (c % n) * SIZE, cy = (c: number) => Math.floor(c / n) * SIZE;
    const tileShape = (into: SVGGElement, v: number, label: string, bonus: boolean) => {
      const [bg, fg] = paint(m, v, bonus);
      into.append(s("rect", { x: PAD, y: PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2, fill: bg }));
      into.append(s("text", { x: SIZE / 2, y: SIZE / 2 + 0.2, "font-size": fontFor(label), fill: fg }, label));
    };
    const place = (g: SVGGElement, x: number, y: number, scale = 1) => {
      const o = (SIZE / 2) * (1 - scale);
      g.setAttribute("transform", `translate(${x + o} ${y + o}) scale(${scale})`);
    };
    const drawComing = (st: StateMerge) => {
      coming.replaceChildren();
      if (!p.rules.preview) return;
      const k = 0.7;
      const g = s("g", { class: "tile", transform: `translate(${span / 2 - (SIZE * k) / 2} ${-HEAD + 0.6}) scale(${k})` });
      tileShape(g, st.next, st.bonus ? "+" : String(st.next), st.bonus);
      coming.append(g, s("text", { x: span / 2 + SIZE * k * 0.5 + 2, y: -HEAD + 0.6 + (SIZE * k) / 2, class: "coming", "text-anchor": "start" }, "next"));
    };

    let els = new Map<number, SVGGElement>();
    /** The state the drawn tiles show. */
    let shown: StateMerge | null = null;
    const build = (st: StateMerge) => {
      tiles.replaceChildren();
      els = new Map();
      st.grid.forEach((v, c) => {
        if (v <= 0) return;
        const g = s("g", { class: "tile" });
        tileShape(g, v, String(v), false);
        tiles.append(g);
        place(g, cx(c), cy(c));
        els.set(c, g);
      });
      drawComing(st);
      shown = st;
    };
    build(session.state);
    let last = session.state;
    let anim: Animation | null = null;
    let preview: StateMerge | null = null;

    /**
     * Animate prev → next when next is one slide of prev plus the tile that was coming; otherwise
     * redraw. A slide still animating when the next state arrives is cut short: the tiles are
     * redrawn as prev first, so every slide of a fast chain starts from the board it was made on.
     */
    const sync = () => {
      const prev = last, next = session.state;
      last = next;
      const cut = anim !== null;
      anim?.cancel();
      anim = null;
      if (cut || shown !== prev) build(prev);
      let dir = -1, born = -1;
      for (let d = 0; d < 4 && dir < 0; d++) {
        const r = move(p, prev.grid, d);
        if (!r.changed) continue;
        const diff = next.grid.flatMap((v, c) => (v !== r.grid[c] ? [c] : []));
        if (diff.length === 1 && !r.grid[diff[0]!] && next.grid[diff[0]!] === prev.next) { dir = d; born = diff[0]!; }
      }
      if (dir < 0) { build(next); return; }
      const r = move(p, prev.grid, dir);
      const moving = r.moves.flatMap((mv) => { const el = els.get(mv.from); return el ? [{ el, from: mv.from, to: mv.to }] : []; });
      const step = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir]!;
      const slideIn = p.rules.entry === "edge";
      const sliding = animate(SLIDE_MS, (k) => {
        const t = Math.max(0, k);
        for (const mv of moving) place(mv.el, lerp(cx(mv.from), cx(mv.to), t), lerp(cy(mv.from), cy(mv.to), t));
      }, ease.out);
      anim = sliding;
      void sliding.then((done) => {
        if (!done) return;
        build(next);
        const pops = [...new Set(r.moves.filter((mv) => mv.merged).map((mv) => mv.to))];
        const pop = animate(POP_MS, (k) => {
          const t = Math.max(0, k);
          for (const c of pops) { const el = els.get(c); if (el) place(el, cx(c), cy(c), 1 + 0.15 * Math.sin(Math.PI * t)); }
          const el = els.get(born);
          if (!el) return;
          if (slideIn) place(el, cx(born) - step[0]! * SIZE * (1 - t), cy(born) - step[1]! * SIZE * (1 - t));
          else place(el, cx(born), cy(born), lerp(0.3, 1, t));
        }, ease.linear);
        anim = pop;
        void pop.then((ended) => { if (ended && anim === pop) anim = null; });
      });
    };

    const render = () => {
      if (session.state !== last) sync();
      ghost.replaceChildren();
      tiles.classList.toggle("faded", !!preview);
      if (preview) {
        preview.grid.forEach((v, c) => {
          if (v <= 0) return;
          ghost.append(s("rect", { x: cx(c) + PAD, y: cy(c) + PAD, width: SIZE - 2 * PAD, height: SIZE - 2 * PAD, rx: 1.2 }));
          ghost.append(s("text", { x: cx(c) + SIZE / 2, y: cy(c) + SIZE / 2 + 0.2, "font-size": fontFor(String(v)) }, String(v)));
        });
      }
      over.replaceChildren();
      const f = session.activeHint?.focus as FocusMerge | undefined;
      for (const c of f?.entries ?? []) over.append(s("rect", { x: cx(c) + 0.4, y: cy(c) + 0.4, width: SIZE - 0.8, height: SIZE - 0.8, rx: 1.4, class: "entry" }));
      for (const c of f?.cells ?? []) over.append(s("rect", { x: cx(c) + 0.4, y: cy(c) + 0.4, width: SIZE - 0.8, height: SIZE - 0.8, rx: 1.4, class: "mark" }));
      if (f?.dir !== undefined) {
        const mid = span / 2, l = span * 0.28, hd = span * 0.09;
        const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f.dir]!;
        const tx = mid + dx! * l, ty = mid + dy! * l;
        over.append(s("path", { d: `M${mid - dx! * l} ${mid - dy! * l}L${tx} ${ty}M${tx - dx! * hd - dy! * hd} ${ty - dy! * hd - dx! * hd}L${tx} ${ty}L${tx - dx! * hd + dy! * hd} ${ty - dy! * hd + dx! * hd}`, class: "arrow" }));
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
      cells: { cols: n, rows: n },
      commands: bindCommands(BINDINGS, { "sliding-merge.up": go(0), "sliding-merge.right": go(1), "sliding-merge.down": go(2), "sliding-merge.left": go(3) }),
      preview: (st) => {
        preview = st as StateMerge | null;
        render();
      },
      locate: (focus) => {
        const f = focus as FocusMerge | undefined;
        const cells = [...(f?.cells ?? []), ...(f?.entries ?? [])];
        if (cells.length) return cells.map(rectOf);
        return f?.dir !== undefined ? [svg.getBoundingClientRect()] : [];
      },
      locateChange: (a, b) => {
        const x = (a as StateMerge).grid, y = (b as StateMerge).grid;
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

export const scoreWidget: WidgetDef<PuzzleMerge, StateMerge, ActionMerge, null> = {
  id: "sliding-merge.score",
  name: "score",
  description: "points so far (by merges or by what the tiles are worth, as the rules say) and the biggest tile",
  puzzles: [gameMerge],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("tsm", CSS);
    const box = h("div", { class: "tsm-score", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `score ${scoreOf(session.puzzle, session.state)} · best tile ${best(session.state.grid)}`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
