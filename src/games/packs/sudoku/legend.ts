import { s } from "../../core/dom";
import { constraintTypes } from "./engine/registry";
import type { ConstraintSpec, RenderCtx } from "./engine/types";
import { featuresOf, type LatinPuzzle } from "./puzzle";

export interface LegendEntry {
  sample: string;
  meaning: string;
}

const S = 100;

/** One cell drawn with the board's own classes, so samples follow the theme. */
const cell = (inner: string, cls = ""): string =>
  `<svg class="sdk-board" viewBox="-4 -4 108 108"><rect x="0" y="0" width="100" height="100" class="cell ${cls}"/>`
  + `<rect x="0" y="0" width="100" height="100" class="thin"/>${inner}</svg>`;

const value = (d: number, cls = "") => `<text x="50" y="52" class="value ${cls}">${d}</text>`;

const CELL_STATES: { when?: (f: readonly string[]) => boolean; entry: LegendEntry }[] = [
  { when: (f) => f.includes("givens"), entry: { sample: cell(value(5)), meaning: "a given digit: part of the puzzle, can't be changed" } },
  { entry: { sample: cell(value(5, "entered")), meaning: "a digit you entered" } },
  { entry: { sample: cell(value(5, "conflict"), "conflict"), meaning: "a clash: this digit breaks a rule (repeats, or a clue doesn't add up)" } },
  { entry: { sample: cell(`<text x="20" y="20" class="corner-mark">1</text><text x="80" y="20" class="corner-mark">4</text>`), meaning: "corner marks: your notes on where a digit could go" } },
  { entry: { sample: cell(`<text x="50" y="51" class="center-mark">27</text>`), meaning: "center marks: your notes on what a cell could be" } },
  { entry: { sample: cell(`<text x="22" y="22" class="cand">1</text><text x="50" y="22" class="cand">2</text><text x="78" y="50" class="cand">6</text>`), meaning: "candidates in fixed spots: what auto candidates says a cell can still be" } },
  { entry: { sample: cell(`<path d="M3 3h94v94h-94Z" class="sel-outline"/>`, "sel"), meaning: "the selected cells (outlined); what you type goes here" } },
  { entry: { sample: cell("", "peer"), meaning: "faint shading: cells that share a row, column or box with the selection" } },
  { entry: { sample: cell(value(3), "same"), meaning: "blue tint: the highlighted digit (the selected cell's, or one you picked)" } },
  { entry: { sample: cell(`<text x="50" y="51" class="center-mark">2<tspan class="lit">3</tspan>7</text>`), meaning: "a bright mark: the highlighted digit inside your notes" } },
  { entry: { sample: cell(`<path d="M6 6h88v88h-88Z" class="open"/>`), meaning: "dashed outline: the highlighted digit can still go here (if turned on)" } },
  { entry: { sample: cell("", "hint"), meaning: "purple: the cells a hint is talking about (lighter purple: the area to look in)" } },
  { entry: { sample: cell(`<text x="50" y="52" class="hint-place">8</text>`), meaning: "a faint purple digit: what the hint places (press hint again to apply it)" } },
  { entry: { sample: cell(`<text x="50" y="50" class="hint-elim">4</text>`), meaning: "a red struck-out digit: a candidate the hint rules out" } },
  { entry: { sample: cell(`<rect x="0" y="0" width="50" height="100" style="fill: var(--sdk-color-5, rgba(240, 140, 220, 0.4))"/><rect x="50" y="0" width="50" height="100" style="fill: var(--sdk-color-4, rgba(170, 230, 120, 0.4))"/>`), meaning: "colors: your own coloring, to track ideas; they don't affect the answer" } },
];

/** A small board instance of each clue type, drawn by the type's own renderer, with what it means. */
const CLUES: Record<string, { spec: ConstraintSpec; meaning: string; view?: [x: number, y: number, w: number, h: number] }> = {
  killer: { spec: { type: "killer", cells: [0, 1, 4], sum: 12 }, view: [0, 0, 2, 2], meaning: "dashed cage: its digits add up to the small number, with no repeats" },
  keen: { spec: { type: "keen", cells: [0, 1, 4], op: "+", target: 6 }, view: [0, 0, 2, 2], meaning: "cage: its digits make the number using the sign (+ add, − subtract, × multiply, ÷ divide)" },
  thermo: { spec: { type: "thermo", cells: [6, 4, 2] }, meaning: "thermometer: digits get bigger going away from the round bulb" },
  arrow: { spec: { type: "arrow", circle: 0, cells: [4] }, view: [0, 0, 2, 2], meaning: "arrow: the digits along it add up to the digit in its circle" },
  kropki: { spec: { type: "kropki", a: 0, b: 1, color: "white" }, view: [0.5, 0, 1, 1], meaning: "white dot: the two digits are one apart (a black dot: one is double the other)" },
  xv: { spec: { type: "xv", a: 0, b: 1, sum: 10 }, view: [0.5, 0, 1, 1], meaning: "X: the two digits add up to 10 (V: they add up to 5)" },
  unequal: { spec: { type: "unequal", a: 0, b: 1 }, view: [0.5, 0, 1, 1], meaning: "the sign points at the smaller digit" },
  whispers: { spec: { type: "whispers", cells: [0, 4, 8] }, meaning: "green line: neighboring digits on it are far apart (at least 5 on a 9×9)" },
  renban: { spec: { type: "renban", cells: [6, 4, 2] }, meaning: "purple line: its digits are a run with no gaps, in any order" },
  littlekiller: { spec: { type: "littlekiller", r: -1, c: -1, dr: 1, dc: 1, sum: 15 }, view: [-1, -1, 2, 2], meaning: "number outside with an arrow: the digits along that diagonal add up to it" },
  towers: { spec: { type: "towers", side: "top", index: 0, count: 2 }, view: [-0.5, -1, 2, 2], meaning: "number outside: how many buildings you see looking in from there" },
  diagonal: { spec: { type: "diagonal" }, meaning: "diagonal line: no digit repeats along it" },
};

/** `view` crops to that window (in cells), so small clues stay legible at icon size. */
function clueSample(spec: ConstraintSpec, view?: readonly number[]): string | null {
  const t = constraintTypes.get(spec.type);
  if (!t?.render || typeof document === "undefined") return null;
  const n = 3;
  const mg = { top: 0, right: 0, bottom: 0, left: 0, ...t.margin?.(spec, n) };
  const pad = 6;
  const svg = s("svg", {
    class: "sdk-board",
    viewBox: view
      ? view.map((v, i) => v * S + (i < 2 ? -pad : 2 * pad)).join(" ")
      : [-mg.left * S - pad, -mg.top * S - pad, (n + mg.left + mg.right) * S + 2 * pad, (n + mg.top + mg.bottom) * S + 2 * pad].join(" "),
  });
  const layer = { under: s("g"), over: s("g"), outside: s("g") };
  let grid = "";
  for (let i = 1; i < n; i++) grid += `M${i * S} 0V${n * S}M0 ${i * S}H${n * S}`;
  svg.append(layer.under, s("path", { d: grid + `M0 0H${n * S}V${n * S}H0Z`, class: "thin" }), layer.over, layer.outside);
  const ctx: RenderCtx = {
    n, S, layer, svg: s,
    center: (c) => [(c % n) * S + S / 2, Math.floor(c / n) * S + S / 2],
    at: (r, c) => [c * S + S / 2, r * S + S / 2],
    reserveCorner: () => {},
  };
  try {
    t.render(spec, ctx);
  } catch {
    return null;
  }
  return svg.outerHTML;
}

/** What the board's marks mean, for this puzzle: cell states, then each clue type it uses. */
export function legendFor(p: LatinPuzzle): LegendEntry[] {
  const f = featuresOf(p);
  const out = CELL_STATES.filter((x) => !x.when || x.when(f)).map((x) => x.entry);
  if (f.includes("boxes")) out.splice(1, 0, { sample: cellBorders(), meaning: "thick lines: box (or region) borders; each box holds every digit once" });
  for (const type of new Set(p.constraints.map((c) => c.type))) {
    const clue = CLUES[type];
    const sample = clue && clueSample(clue.spec, clue.view);
    if (clue && sample) out.push({ sample, meaning: clue.meaning });
  }
  return out;
}

function cellBorders(): string {
  return `<svg class="sdk-board" viewBox="-4 -4 208 208"><path d="M100 0V200M0 100H200" class="thin"/><path d="M0 0H200V200H0Z M100 0V200" class="thick"/></svg>`;
}
