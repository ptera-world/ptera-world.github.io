import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { assists } from "./assists";
import { CROSS, LINE, UNKNOWN, check } from "./board";
import { cluesOf, gridOf, loopy, type LoopyPuzzle } from "./def";
import { decodePzpr, encodePzpr, formats, gridFormat, nativeFormat, pzprFileFormat, pzprFormat, sgtFormat } from "./formats";
import { getGrid, listTilings } from "./grid";
import { analyse, searchSolutions } from "./solver";

const sig = () => new AbortController().signal;
const gen = async (params: Record<string, unknown>, seed: string) => (await generate(loopy, params, seed, sig())) as LoopyPuzzle;

test("every tiling builds a consistent planar grid", () => {
  for (const t of listTilings()) {
    const g = getGrid(t.id, Math.max(t.minW, 4), Math.max(t.minH, 4));
    // a connected planar patch: V - E + F = 1
    expect(g.nv - g.ne + g.nf).toBe(1);
    for (let f = 0; f < g.nf; f++) {
      expect(g.fe[f]!.length).toBe(g.fv[f]!.length);
      for (const e of g.fe[f]!) expect([g.ef[2 * e], g.ef[2 * e + 1]]).toContain(f);
      expect(g.ring[f]!.length).toBeGreaterThanOrEqual(g.fe[f]!.length);
    }
    for (let v = 0; v < g.nv; v++) {
      expect(g.vf[v]!.length).toBe(g.ve[v]!.length);
      // each face around a dot shows up in exactly one sector
      const fs = g.vf[v]!.filter((f) => f >= 0);
      expect(new Set(fs).size).toBe(fs.length);
    }
  }
});

test("generation is deterministic per seed and params", async () => {
  const a = await gen({ width: 6, height: 6, difficulty: "normal" }, "det");
  const b = await gen({ width: 6, height: 6, difficulty: "normal" }, "det");
  const c = await gen({ width: 6, height: 6, difficulty: "normal" }, "det2");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const [tiling, w, h] of [["square", 7, 7], ["honeycomb", 5, 5], ["triangular", 6, 6], ["cairo", 4, 4], ["octagonal", 4, 4]] as const) {
  for (const difficulty of ["easy", "normal", "tricky"]) {
    test(`${tiling} ${difficulty}: unique, logic-solvable at the asked tier`, async () => {
      const p = await gen({ tiling, width: w, height: h, difficulty }, `t-${tiling}-${difficulty}`);
      const g = gridOf(p);
      const a = analyse(g, cluesOf(p));
      expect(a.count).toBe(1);
      expect(a.tier).toBeGreaterThanOrEqual(0);
      expect(a.tier).toBeLessThanOrEqual(["easy", "normal", "tricky"].indexOf(difficulty));
      expect(check(g, p.clues, Array.from(a.solution!)).solved).toBe(true);
      // a brute-force search agrees there's exactly one answer
      const s = searchSolutions(g, cluesOf(p), 2);
      expect(s.exhausted).toBe(true);
      expect(s.solutions.length).toBe(1);
    });
  }
}

test("hard puzzles need the hard tier and stay unique", async () => {
  const p = await gen({ width: 7, height: 7, difficulty: "hard" }, "hard-1");
  const a = analyse(gridOf(p), cluesOf(p));
  expect(a.count).toBe(1);
  expect(a.tier).toBe(3);
}, 60000);

test("symmetric clues mirror under a half turn", async () => {
  const p = await gen({ width: 7, height: 6, symmetric: true }, "sym");
  const n = p.clues.length;
  for (let f = 0; f < n; f++) expect(p.clues[f]! >= 0).toBe(p.clues[n - 1 - f]! >= 0);
});

test("sgt game ids from sgt's own sources import, solve uniquely and round-trip", () => {
  const ids = [
    "5x5t1:2c2a1a2a201a1a1a1112a1a2b1211f0b21a2a2a0a",
    "5x6t1:a022a212h1a1d1a12c2b11a012b1a20d1a0a12e",
    "5x5t1:0_21120b11a1a01a1a00c1a0b211021c1h1a2a1a0a",
    "5x6t1:0_a1212c22c2a02a2f22a0c12a110d0e1c0c0a101121a1",
  ];
  for (const id of ids) {
    expect(sgtFormat.detect!(id)).toBe(true);
    const p = sgtFormat.parse(id);
    expect(analyse(gridOf(p), cluesOf(p)).count).toBe(1);
    expect(sgtFormat.serialize!(p)).toBe(id);
  }
  expect(sgtFormat.parse("3:a2g").tiling).toBe("square");
  expect(sgtFormat.parse("4x4t0de:3o").clues.length).toBe(16);
  expect(() => sgtFormat.parse("7x7t12:abc")).toThrow();
  expect(() => sgtFormat.parse("7x7t0#1234")).toThrow(/seed/);
});

test("formats round-trip a generated puzzle", async () => {
  const p = await gen({ width: 7, height: 5 }, "fmt");
  for (const f of [nativeFormat, sgtFormat, pzprFormat, gridFormat]) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  const h = await gen({ tiling: "honeycomb", width: 4, height: 4 }, "fmt");
  expect(nativeFormat.parse(nativeFormat.serialize!(h))).toEqual(h);
  expect(sgtFormat.parse(sgtFormat.serialize!(h))).toEqual(h);
  // only formats claiming a text should parse it
  const sgt = sgtFormat.serialize!(p);
  expect(formats.filter((f) => f.detect?.(sgt)).map((f) => f.id)).toEqual(["sgt"]);
});

test("puzz.link encoding matches pzprjs's packing", () => {
  expect(encodePzpr([0, -1, -1])).toBe("a");
  expect(encodePzpr([1, -1, 2])).toBe("6c");
  expect(encodePzpr([-1, -1, -1, 3])).toBe("id");
  expect(decodePzpr("6c", 3)).toEqual([1, -1, 2]);
  expect(decodePzpr("z", 25)).toEqual(Array.from({ length: 25 }, () => -1));
  const p = pzprFormat.parse("https://puzz.link/p?slither/3/2/6ch");
  expect(p).toMatchObject({ w: 3, h: 2, clues: [1, -1, 2, -1, -1, -1] });
});

test("pzprv3 files import", () => {
  const p = pzprFileFormat.parse("pzprv3\nslither\n2\n3\n3 . - \n. 2 0 \n0 0 0 \n");
  expect(p).toEqual({ tiling: "square", w: 3, h: 2, clues: [3, -1, -1, -1, 2, 0] });
});

test("bad imports explain themselves", () => {
  expect(() => nativeFormat.parse("square:3x3:aa")).toThrow(/9 cells/);
  expect(() => gridFormat.parse("12\n123")).toThrow(/same number/);
  expect(() => nativeFormat.parse("square:2x2:5c")).toThrow(/can't fit/);
});

test("hints alone solve a fresh puzzle, and point out mistakes first", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "tricky" }, "hint");
  let s = loopy.init(p);
  for (let i = 0; i < 500 && !loopy.isSolved(p, s); i++) {
    const h = loopy.hint!(p, s)!;
    expect(h.message.length).toBeGreaterThan(0);
    expect(h.message).not.toMatch(/no step of logic/);
    s = loopy.reduce(p, s, h.action!);
  }
  expect(loopy.isSolved(p, s)).toBe(true);

  const sol = loopy.solve!(p)!;
  const wrong = sol.edges.indexOf(CROSS);
  const bad = loopy.reduce(p, loopy.init(p), { type: "set", edges: [wrong], value: LINE });
  const h = loopy.hint!(p, bad)!;
  expect(h.action).toEqual({ type: "set", edges: [wrong], value: UNKNOWN });
});

test("reduce returns the same state for a no-op", async () => {
  const p = await gen({ width: 4, height: 4 }, "noop");
  const s = loopy.init(p);
  expect(loopy.reduce(p, s, { type: "set", edges: [0], value: UNKNOWN })).toBe(s);
  expect(loopy.reduce(p, s, { type: "set", edges: [-1, 9999], value: LINE })).toBe(s);
  expect(loopy.isSolved(p, s)).toBe(false);
});

test("an ambiguous puzzle is reported as such", () => {
  const p = nativeFormat.parse("square:3x3:i");
  const a = analyse(gridOf(p), cluesOf(p));
  expect(a.count).toBe(2);
  expect(loopy.rate!(p)!.label).toMatch(/more than one/);
});

test("auto-cross assist crosses a finished clue in the same undo step", () => {
  const p = nativeFormat.parse("square:2x2:1c");
  const session = new Session(loopy, p, { kind: "imported" });
  const plugin = assists.find((a) => a.id === "loopy.auto-cross-clues")!;
  plugin.setup!({ session, settings: {}, owner: "t" });
  const g = gridOf(p);
  session.dispatch({ type: "set", edges: [g.fe[0]![0]!], value: LINE });
  expect(g.fe[0]!.slice(1).every((e) => session.state.edges[e] === CROSS)).toBe(true);
  session.undo();
  expect(session.state.edges.every((m) => m === UNKNOWN)).toBe(true);
});

test("inside/outside assist shades from the user's marks", () => {
  const p = nativeFormat.parse("square:2x1:b");
  const session = new Session(loopy, p, { kind: "imported" });
  const plugin = assists.find((a) => a.id === "loopy.inside-outside")!;
  plugin.setup!({ session, settings: { outside: true }, owner: "t" });
  const g = gridOf(p);
  // left cell's left edge is a line (border edge): left cell is inside
  const left = g.fe[0]!.find((e) => g.ef[2 * e + 1] === -1 && g.ef[2 * e] === 0 && g.vx[g.ev[2 * e]!] === 0 && g.vx[g.ev[2 * e + 1]!] === 0)!;
  session.dispatch({ type: "set", edges: [left], value: LINE });
  expect((session.derived()["loopy.sides"] as number[])[0]).toBe(1);
});
