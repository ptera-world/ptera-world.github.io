import { expect, test } from "bun:test";
import type { AnyPuzzleDef, Step, Technique } from "../../core/types";
import { applyStep, findPracticePosition, stepsAt } from "../../core/techniques";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { circle, cross, crossings, sgtFormat, untangle, type Pt, type UntanglePuzzle } from "./logic";
import { untangleTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(untangle, params, seed, sig()) as Promise<UntanglePuzzle>;

test("segments cross like the original: crossing, touching and overlapping count", () => {
  expect(cross([0, 0], [1, 1], [0, 1], [1, 0])).toBe(true);
  expect(cross([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false);
  expect(cross([0, 0], [1, 0], [0.5, 0], [0.5, 1])).toBe(true);
  expect(cross([0, 0], [1, 0], [0.5, 0], [2, 0])).toBe(true);
  expect(cross([0, 0], [1, 0], [2, 0], [3, 0])).toBe(false);
});

test("generated graphs have a known untangled layout, start tangled, and are deterministic", async () => {
  for (let i = 0; i < 10; i++) {
    const p = await gen({ points: 6 + i * 3 }, `g${i}`);
    expect(p.layout).not.toBeNull();
    expect(crossings(p, p.layout!).length).toBe(0);
    expect(crossings(p, circle(p.n)).length).toBeGreaterThan(0);
    expect(p.edges.every(([a, b]) => a < b)).toBe(true);
  }
  expect(await gen({ points: 12 }, "x")).toEqual(await gen({ points: 12 }, "x"));
});

test("the hint on a tangled board names two lines that cross, with no actions", async () => {
  for (let i = 0; i < 6; i++) {
    const p = await gen({ points: 8 + i * 3 }, `h${i}`);
    const s = new Session(untangle, p, { kind: "imported" });
    const h = s.hint();
    expect(h?.actions?.length ?? 0).toBe(0);
    const pts = (h!.focus as { points: number[] }).points;
    expect(pts.length).toBe(4);
    const [a, b, c, d] = pts as [number, number, number, number];
    expect(p.edges.some(([x, y]) => x === a && y === b)).toBe(true);
    expect(p.edges.some(([x, y]) => x === c && y === d)).toBe(true);
    expect(cross(s.state.pts[a]!, s.state.pts[b]!, s.state.pts[c]!, s.state.pts[d]!)).toBe(true);
  }
});

test("game ids round-trip and parse like the original", async () => {
  const p = await gen({ points: 10 }, "fmt");
  const text = sgtFormat.serialize!(p);
  expect(sgtFormat.detect!(text)).toBe(true);
  expect(sgtFormat.parse(text)).toEqual({ ...p, layout: null });
  expect(sgtFormat.parse("4:0-1,1-2,2-3,3-0,0-2").edges).toEqual([[0, 1], [0, 2], [0, 3], [1, 2], [2, 3]]);
  expect(() => sgtFormat.parse("3:0-5")).toThrow();
});

test("moves stay on the board and solve() untangles", async () => {
  const p = await gen({ points: 10 }, "solve");
  let st = untangle.init(p);
  st = untangle.reduce(p, st, { type: "move", moves: [[0, 2, -1]] });
  expect(st.pts[0]).toEqual([1, 0]);
  const ans = untangle.solve!(p, untangle.init(p))!;
  expect("board" in ans && untangle.isSolved(p, ans.board)).toBe(true);
  expect(untangle.isSolved(p, untangle.init(p))).toBe(false);
});

test("a point dropped onto a line touches it, and one just beside it does not", () => {
  const a: Pt = [0.25, 0.25], b: Pt = [0.75, 0.75];
  expect(cross(a, b, [0.5, 0.5], [0.25, 0.75])).toBe(true);
  expect(cross(a, b, [0.5, 0.5 + 1 / 65536], [0.25, 0.75])).toBe(false);
  expect(cross(a, b, [0.375, 0.5], [0.625, 0.25])).toBe(true);
});

/** Leaf values that differ from `a` in `b`, keyed by JSON path. */
function leafDiff(a: unknown, b: unknown, path = "", out = new Map<string, string>()): Map<string, string> {
  if (Object.is(a, b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) leafDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`, out);
    return out;
  }
  const v = JSON.stringify(b);
  if (JSON.stringify(a) !== v) out.set(path, v ?? "undefined");
  return out;
}

/** findAt is instancesAt's first step, every instance at a target changes the board, and cellAt changes part of what one of them does. */
function checkAimed(def: AnyPuzzleDef, list: readonly Technique[], p: unknown, s: unknown, targets: readonly unknown[]): void {
  for (const t of list) {
    if (!t.findAt && !t.cellAt) continue;
    for (const target of targets) {
      const all: Step[] = [];
      if (t.instancesAt) t.instancesAt(p, s, target, (st) => { all.push(st); });
      else all.push(...stepsAt(def, t, p, s, target));
      if (t.findAt) expect(t.findAt(p, s, target)).toEqual(all[0] ?? null);
      const diffs = all.map((st) => leafDiff(s, applyStep(def, p, s, st)));
      for (const d of diffs) expect(d.size).toBeGreaterThan(0);
      const cell = t.cellAt?.(p, s, target);
      if (!cell) continue;
      const d = leafDiff(s, applyStep(def, p, s, cell));
      expect(d.size > 0 && diffs.some((x) => [...d].every(([k, v]) => x.get(k) === v))).toBe(true);
    }
  }
}

test("aimed finds: findAt is instancesAt's first, each instance changes the board, cellAt is part of one", async () => {
  for (const t of untangleTechniques) {
    if (t.practice === false) continue;
    const pos = await findPracticePosition(untangle, untangleTechniques, t, "aim", new AbortController().signal);
    if (!pos) continue;
    const p = pos.puzzle as any, s = pos.state as any;
    checkAimed(untangle, untangleTechniques, p, s, Array.from({ length: p.n }, (_, i) => ({ point: i })));
  }
}, 300000);
