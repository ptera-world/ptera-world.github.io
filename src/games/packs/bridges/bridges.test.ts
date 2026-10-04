import { describe, expect, test } from "bun:test";
import { generate as coreGenerate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { resolve } from "../../core/schema";
import { Session } from "../../core/session";
import { gridFormat, pzprFormat, sgtFormat } from "./formats";
import { layout, params } from "./generate";
import { emptyState, graph, isValidSolution, normalize, type BridgesPuzzle, type BridgesState } from "./graph";
import { bridges, reduce, type BridgesAction } from "./logic";
import { autoFill } from "./plugins";
import { initialDomain, logicSolve, propagate, search } from "./solver";

const sig = () => new AbortController().signal;
const gen = async (p: Record<string, unknown>, seed: string) => (await coreGenerate(bridges, p, seed, sig())) as BridgesPuzzle;

function solutionOf(p: BridgesPuzzle, links: { a: [number, number]; b: [number, number]; n: number }[]): number[] {
  const g = graph(p);
  const idx = (x: number, y: number) => p.islands.findIndex((is) => is.x === x && is.y === y);
  const b = g.edges.map(() => 0);
  for (const l of links) {
    const i = idx(...l.a), j = idx(...l.b);
    const e = g.edges.find((ed) => (ed.a === i && ed.b === j) || (ed.a === j && ed.b === i))!;
    b[e.id]! += l.n;
  }
  return b;
}

describe("generator", () => {
  test("deterministic per (params, seed)", async () => {
    const a = await gen({ width: 8, height: 6 }, "abc");
    const b = await gen({ width: 8, height: 6 }, "abc");
    const c = await gen({ width: 8, height: 6 }, "abd");
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  const cases: [string, Record<string, unknown>][] = [
    ["7x7 easy", { width: 7, height: 7, difficulty: "easy" }],
    ["7x7 medium", { width: 7, height: 7, difficulty: "medium" }],
    ["10x10 hard", { width: 10, height: 10, difficulty: "hard" }],
    ["8x8 tree medium", { width: 8, height: 8, difficulty: "medium", loops: false }],
    ["8x8 max4 adjacent", { width: 8, height: 8, maxb: 4, adjacent: true, difficulty: "medium" }],
    ["6x9 max1", { width: 6, height: 9, maxb: 1 }],
  ];
  for (const [name, p] of cases) {
    test(`${name}: unique, logic-solvable, requested tier`, async () => {
      const want = { easy: 1, medium: 2, hard: 3 }[(p.difficulty as string) ?? "easy"] ?? 1;
      for (let k = 0; k < 4; k++) {
        const puzzle = await gen(p, `${name}-${k}`);
        const r = logicSolve(puzzle);
        expect(r.tier).toBe(want as 1 | 2 | 3);
        const s = search(puzzle, undefined, 2);
        expect(s.aborted).toBe(false);
        expect(s.count).toBe(1);
        expect(s.first).toEqual(Array.from(r.domain.lo));
      }
    });
  }
});

describe("solver", () => {
  test("never excludes a real solution (soundness on random layouts)", () => {
    const v = resolve(params, { width: 7, height: 7 });
    for (const loops of [true, false]) {
      for (let k = 0; k < 150; k++) {
        const { islands, links } = layout({ ...v, loops, maxb: 1 + (k % 4), adjacent: k % 3 === 0 }, createRng(`sound${k}`));
        if (islands.length < 2) continue;
        const p = normalize({ w: 7, h: 7, maxb: 1 + (k % 4), loops, islands });
        const truth = solutionOf(p, links);
        expect(isValidSolution(p, truth)).toBe(true);
        const g = graph(p);
        const d = initialDomain(g);
        expect(propagate(g, d, 3)).toBeNull();
        truth.forEach((t, e) => {
          expect(d.lo[e]!).toBeLessThanOrEqual(t);
          expect(d.hi[e]!).toBeGreaterThanOrEqual(t);
        });
      }
    }
  });

  test("detects non-unique and unsolvable puzzles", () => {
    const twoWays = gridFormat.parse("3.3\n...\n3.3");
    expect(search(twoWays).count).toBe(2);
    expect(bridges.rate!(twoWays)!.label).toBe("multiple solutions");
    const none = gridFormat.parse("1.3");
    expect(search(none).count).toBe(0);
    expect(bridges.solve!(none)).toBeNull();
  });

  test("no-loops rule changes the answer", () => {
    // a 2x2 ring of 2s needs a loop
    const ring = gridFormat.parse("2.2\n...\n2.2");
    const tree = { ...ring, loops: false };
    expect(search(tree).count).toBe(0);
  });
});

describe("hints", () => {
  test("following hints from scratch solves generated puzzles", async () => {
    for (const [p, seed] of [[{ difficulty: "easy" }, "h1"], [{ difficulty: "medium", width: 9, height: 9 }, "h2"], [{ difficulty: "hard", width: 10, height: 10 }, "h3"], [{ difficulty: "medium", loops: false }, "h4"]] as const) {
      const puzzle = await gen(p, seed);
      let s: BridgesState = emptyState(puzzle);
      for (let i = 0; i < 500 && !bridges.isSolved(puzzle, s); i++) {
        const h = bridges.hint!(puzzle, s);
        expect(h).not.toBeNull();
        expect(h!.actions?.[0]).toBeDefined();
        expect(h!.message.length).toBeGreaterThan(0);
        expect(h!.message).not.toContain("no clean deduction");
        const next = h!.actions!.reduce((st, a) => reduce(puzzle, st, a), s);
        expect(next).not.toBe(s);
        s = next;
      }
      expect(bridges.isSolved(puzzle, s)).toBe(true);
    }
  });

  test("points out a wrong bridge and fixes it", async () => {
    const puzzle = await gen({ difficulty: "easy" }, "oops");
    const sol = bridges.solve!(puzzle)!;
    const wrong = sol.b.findIndex((v) => v < puzzle.maxb);
    let s = emptyState(puzzle);
    s = reduce(puzzle, s, { type: "set", edge: wrong, n: sol.b[wrong]! + 1 });
    if (s.b[wrong] === sol.b[wrong]! + 1) {
      const h = bridges.hint!(puzzle, s)!;
      expect(h.focus).toEqual({ islands: expect.any(Array), edges: [wrong] });
      expect(h.actions!.reduce((st, a) => reduce(puzzle, st, a), s).b[wrong]).toBe(sol.b[wrong]!);
    }
  });
});

describe("rules", () => {
  const p = gridFormat.parse(".2.\n2.2\n.2.");
  const g = graph(p);
  const h = g.edges.find((e) => e.horizontal)!.id;
  const v = g.edges.find((e) => !e.horizontal)!.id;

  test("crossing bridges are refused", () => {
    expect(g.cross[h]).toContain(v);
    let s = reduce(p, emptyState(p), { type: "set", edge: h, n: 1 });
    expect(reduce(p, s, { type: "set", edge: v, n: 1 })).toBe(s);
    expect(reduce(p, s, { type: "cycle", edge: v, delta: 1 })).toBe(s);
    s = reduce(p, s, { type: "cycle", edge: h, delta: 1 });
    expect(s.b[h]).toBe(2);
    s = reduce(p, s, { type: "cycle", edge: h, delta: 1 });
    expect(s.b[h]).toBe(0);
  });

  test("marks only on empty edges, cleared by adding", () => {
    let s = reduce(p, emptyState(p), { type: "mark", edge: h });
    expect(s.no[h]).toBe(1);
    s = reduce(p, s, { type: "set", edge: h, n: 1 });
    expect(s.no[h]).toBe(0);
    expect(reduce(p, s, { type: "mark", edge: h })).toBe(s);
  });

  test("many applies in order", () => {
    const a: BridgesAction = { type: "many", actions: [{ type: "set", edge: h, n: 2 }, { type: "cycle", edge: h, delta: -1 }] };
    expect(reduce(p, emptyState(p), a).b[h]).toBe(1);
  });
});

describe("formats", () => {
  test("sgt id parse/serialize", () => {
    const p = sgtFormat.parse("3x3i30e10m2d0:1a2c1a2");
    expect(p.islands).toEqual([{ x: 0, y: 0, n: 1 }, { x: 2, y: 0, n: 2 }, { x: 0, y: 2, n: 1 }, { x: 2, y: 2, n: 2 }]);
    expect(p.maxb).toBe(2);
    expect(p.loops).toBe(true);
    expect(sgtFormat.serialize!(p)).toBe("3x3m2:1a2c1a2");
    const q = sgtFormat.parse("4x2m4L:Ab1d");
    expect(q).toMatchObject({ w: 4, h: 2, maxb: 4, loops: false });
    expect(q.islands[0]!.n).toBe(10);
    expect(() => sgtFormat.parse("7x7#12345")).toThrow(/random-seed/);
    expect(() => sgtFormat.parse("3x3:1a2")).toThrow(/shorter/);
  });

  test("puzz.link parse matches the pzprjs reference board", () => {
    const p = pzprFormat.parse("https://puzz.link/p?hashi/5/5/4g2i3h23k3g1g3g4g3");
    const q = gridFormat.parse("4.2..\n.3..2\n3....\n.3.1.\n3.4.3");
    expect(p).toEqual(q);
    expect(pzprFormat.serialize!(p)).toBe("https://puzz.link/p?hashi/5/5/4g2i3h23k3g1g3g4g3");
    expect(pzprFormat.detect!("http://pzv.jp/p.html?hashikake/5/5/4g2i3h23k3g1g3g4g3")).toBe(true);
  });

  test("grid token mode and header", () => {
    const p = gridFormat.parse("max=3 loops=no\n4 . 12\n. . .\n1 . 2");
    expect(p).toMatchObject({ w: 3, h: 3, maxb: 3, loops: false });
    expect(p.islands[1]!.n).toBe(12);
    expect(gridFormat.serialize!(p)).toBe("max=3 loops=no\n4.C\n...\n1.2");
  });

  test("round-trips generated puzzles through every format", async () => {
    for (const [i, extra] of [{}, { maxb: 4, loops: false }, { width: 30, height: 30, density: 10 }].entries()) {
      const puzzle = await gen(extra, `rt${i}`);
      for (const f of [sgtFormat, gridFormat]) {
        const text = f.serialize!(puzzle);
        expect(f.detect!(text)).toBe(true);
        expect(f.parse(text)).toEqual(puzzle);
      }
      if (puzzle.maxb === 2 && puzzle.loops) expect(pzprFormat.parse(pzprFormat.serialize!(puzzle))).toEqual(puzzle);
    }
  });
});

describe("session + assists", () => {
  test("auto-fill places forced bridges in the same undo step", async () => {
    const puzzle = await gen({ difficulty: "easy" }, "auto");
    const s = emptyState(puzzle);
    const filled = autoFill(puzzle, s, 1, false);
    const sol = bridges.solve!(puzzle)!;
    filled.b.forEach((v, e) => expect(v).toBeLessThanOrEqual(sol.b[e]!));

    const session = new Session(bridges, puzzle, { kind: "imported" });
    session.hooks.apply.tap((next, { puzzle: pz, prev }) => (Object.is(next, prev) ? next : autoFill(pz, next, 3, false)), { owner: "t" });
    const e = sol.b.findIndex((v) => v > 0);
    session.dispatch({ type: "set", edge: e, n: sol.b[e]! });
    expect(session.solved).toBe(true);
    session.undo();
    expect(session.state).toEqual(emptyState(puzzle));
  });
});
