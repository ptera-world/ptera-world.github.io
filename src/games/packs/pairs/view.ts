import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { colourOf, failed, pairs, shapeOf, type PairsAction, type PairsFocus, type PairsInteraction, type PairsPuzzle, type PairsState } from "./logic";

const CW = 10;
const CH = 12;
const GAP = 1.4;
const colourVar = (kind: number) => `var(--pairs-${colourOf(kind) + 1}, var(--palette-${colourOf(kind) + 1}))`;

const CSS = `
.pairs-board { display: block; width: 100%; height: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.pairs-board .back { fill: color-mix(in srgb, var(--accent) 30%, var(--surface-2)); stroke: var(--border); stroke-width: 0.3; cursor: pointer; }
.pairs-board .back-mark { fill: none; stroke: color-mix(in srgb, var(--accent) 60%, var(--surface-2)); stroke-width: 0.4; pointer-events: none; }
.pairs-board .front { fill: var(--cell); stroke: var(--border); stroke-width: 0.3; cursor: pointer; }
.pairs-board .front.miss { stroke: var(--text-dim); stroke-width: 0.6; stroke-dasharray: 1.2 0.8; }
.pairs-board .gone { opacity: 0.35; }
.pairs-board .shape { stroke: color-mix(in srgb, var(--text) 40%, transparent); stroke-width: 0.3; pointer-events: none; }
.pairs-board .shape-ring { fill: none; stroke-width: 1.5; }
.pairs-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.8; pointer-events: none; }
.pairs-board .mark.nudge { stroke-width: 0.5; stroke-dasharray: 1.2 0.8; }
.pairs-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .pairs-board .cursor { display: none; }
`;

const BINDINGS = {
  "pairs.left": { label: "cursor left", category: "pairs", keys: ["ArrowLeft", "a"] },
  "pairs.right": { label: "cursor right", category: "pairs", keys: ["ArrowRight", "d"] },
  "pairs.up": { label: "cursor up", category: "pairs", keys: ["ArrowUp", "w"] },
  "pairs.down": { label: "cursor down", category: "pairs", keys: ["ArrowDown", "s"] },
  "pairs.flip": { label: "flip card", category: "pairs", keys: ["space", "Enter"], description: "flip the card under the keyboard cursor" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const settings = defineSchema({
  numbers: { type: "bool", label: "number the kinds", default: false, description: "a number on every face, for telling kinds apart without relying on color" },
});

/** The shape of a kind drawn in a box centred on (0, 0), about 6 wide. */
function shape(kind: number, numbers: boolean): SVGElement {
  const fill = colourVar(kind);
  const poly = (pts: [number, number][]) => s("polygon", { points: pts.map((q) => q.join(",")).join(" "), fill, class: "shape" });
  const g = s("g");
  switch (shapeOf(kind)) {
    case 0: g.append(s("circle", { r: 3, fill, class: "shape" })); break;
    case 1: g.append(s("rect", { x: -2.7, y: -2.7, width: 5.4, height: 5.4, rx: 0.5, fill, class: "shape" })); break;
    case 2: g.append(poly([[0, -3.3], [3.3, 2.7], [-3.3, 2.7]])); break;
    case 3: g.append(poly([[0, -3.5], [3, 0], [0, 3.5], [-3, 0]])); break;
    case 4: g.append(poly([[-1.1, -3.2], [1.1, -3.2], [1.1, -1.1], [3.2, -1.1], [3.2, 1.1], [1.1, 1.1], [1.1, 3.2], [-1.1, 3.2], [-1.1, 1.1], [-3.2, 1.1], [-3.2, -1.1], [-1.1, -1.1]])); break;
    case 5: g.append(poly(Array.from({ length: 10 }, (_, i): [number, number] => {
      const r = i % 2 ? 1.5 : 3.5, a = (i * Math.PI) / 5 - Math.PI / 2;
      return [Math.round(r * Math.cos(a) * 100) / 100, Math.round(r * Math.sin(a) * 100) / 100];
    }))); break;
    case 6: g.append(poly(Array.from({ length: 6 }, (_, i): [number, number] => [Math.round(3.2 * Math.cos((i * Math.PI) / 3) * 100) / 100, Math.round(3.2 * Math.sin((i * Math.PI) / 3) * 100) / 100]))); break;
    default: g.append(s("circle", { r: 2.4, stroke: fill, class: "shape shape-ring" })); break;
  }
  if (numbers) g.append(s("text", { x: 0, y: 5.2, "text-anchor": "middle", "font-size": 2.4, fill: "var(--text-dim)", style: "pointer-events: none" }, String(kind + 1)));
  return g;
}

const sample = (kind: number) => `<svg viewBox="-5 -6 10 12">${shape(kind, false).outerHTML}</svg>`;

export const pairsView: View<PairsPuzzle, PairsState, PairsAction, PairsInteraction, typeof settings> = {
  id: "pairs.svg",
  name: "cards",
  puzzle: pairs,
  settings,
  controls: [{ how: "click or tap a face-down card", what: "flip it" }],
  legend: () => [
    { sample: `<svg viewBox="-0.5 -0.5 11 13"><rect x="0" y="0" width="10" height="12" rx="1" fill="color-mix(in srgb, var(--accent) 30%, var(--surface-2))" stroke="var(--border)" stroke-width="0.3"/></svg>`, meaning: "a card face down" },
    { sample: sample(0) + sample(9), meaning: "kinds differ by shape and color" },
    { sample: `<svg viewBox="-0.5 -0.5 11 13"><rect x="0" y="0" width="10" height="12" rx="1" fill="var(--cell)" stroke="var(--text-dim)" stroke-width="0.6" stroke-dasharray="1.2 0.8"/></svg>`, meaning: "a miss: stays showing until your next flip" },
    { sample: `<svg viewBox="-0.5 -0.5 11 13" style="opacity: 0.35"><rect x="0" y="0" width="10" height="12" rx="1" fill="var(--cell)" stroke="var(--border)" stroke-width="0.3"/></svg>`, meaning: "a match, out of play" },
    { sample: `<svg viewBox="-0.5 -0.5 11 13"><rect x="0" y="0" width="10" height="12" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.8"/></svg>`, meaning: "hint: cards you have seen" },
  ],
  mount(root, { session, settings }) {
    style("pairs", CSS);
    const p = session.puzzle;
    const W = p.w * (CW + GAP) + GAP, H = p.h * (CH + GAP) + GAP;
    const x = (c: number) => GAP + (c % p.w) * (CW + GAP);
    const y = (c: number) => GAP + Math.floor(c / p.w) * (CH + GAP);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "pairs-board", role: "grid", "aria-label": `${p.w} by ${p.h} pairs` });
    const cardLayer = s("g"), overlay = s("g");
    const cursor = s("rect", { width: CW + 0.8, height: CH + 0.8, rx: 1.2, class: "cursor" });
    svg.append(cardLayer, overlay, cursor);
    root.append(svg);

    const render = () => {
      const st = session.state;
      const bad = failed(p, st);
      cardLayer.replaceChildren();
      p.faces.forEach((kind, c) => {
        if (kind < 0) return;
        const up = st.up.includes(c) || st.done[c] === 1;
        const g = s("g", { class: st.done[c] ? "gone" : "", transform: `translate(${x(c)} ${y(c)})` });
        if (up) {
          g.append(s("rect", { width: CW, height: CH, rx: 1, class: `front${bad && st.up.includes(c) ? " miss" : ""}`, "data-cell": c }));
          const sh = shape(kind, settings.numbers);
          sh.setAttribute("transform", `translate(${CW / 2} ${CH / 2 - 0.6})`);
          g.append(sh);
        } else {
          g.append(s("rect", { width: CW, height: CH, rx: 1, class: "back", "data-cell": c }), s("rect", { x: 1.2, y: 1.2, width: CW - 2.4, height: CH - 2.4, rx: 0.6, class: "back-mark" }));
        }
        cardLayer.append(g);
      });
      overlay.replaceChildren();
      const hint = session.activeHint;
      const f = hint?.focus as PairsFocus | undefined;
      for (const c of f?.cells ?? []) overlay.append(s("rect", { x: x(c) - 0.4, y: y(c) - 0.4, width: CW + 0.8, height: CH + 0.8, rx: 1.4, class: hint?.level === 1 ? "mark nudge" : "mark" }));
      const cur = session.interaction.cursor;
      cursor.setAttribute("x", String(x(cur) - 0.4));
      cursor.setAttribute("y", String(y(cur) - 0.4));
    };

    const flip = (cell: number) => {
      session.setInteraction((i) => ({ ...i, cursor: cell }));
      session.dispatch({ type: "flip", cell });
    };
    const onDown = (e: PointerEvent) => {
      const v = (e.target as Element).getAttribute("data-cell");
      if (v === null || e.button !== 0) return;
      e.preventDefault();
      flip(Number(v));
    };
    svg.addEventListener("pointerdown", onDown);

    const move = (dx: number, dy: number) => () => session.setInteraction((i) => {
      const cx = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
      const cy = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
      return { ...i, cursor: cy * p.w + cx };
    });

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();

    const rects = (cells: Iterable<number>) => [...new Set(cells)].map((c) => {
      const r = svg.getBoundingClientRect();
      const k = r.width / W;
      return new DOMRect(r.left + x(c) * k, r.top + y(c) * k, CW * k, CH * k);
    });
    return {
      aspect: W / H,
      cells: { cols: p.w * 2, rows: p.h * 2 },
      commands: bindCommands(BINDINGS, {
        "pairs.left": move(-1, 0),
        "pairs.right": move(1, 0),
        "pairs.up": move(0, -1),
        "pairs.down": move(0, 1),
        "pairs.flip": () => flip(session.interaction.cursor),
      }, { "pairs.flip": { menu: "board" } }),
      target: () => session.interaction.cursor,
      locate: (focus) => rects((focus as PairsFocus | undefined)?.cells ?? []),
      locateChange: (a, b) => {
        const before = a as PairsState, after = b as PairsState;
        return rects(p.faces.flatMap((_, c) => (before.up.includes(c) !== after.up.includes(c) || before.done[c] !== after.done[c] ? [c] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};
