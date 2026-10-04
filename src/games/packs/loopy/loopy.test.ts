import { expect, test } from "bun:test";
import type { GamesApi } from "../../api";
import { generate } from "../../core/generate";
import { PluginHost } from "../../core/plugins";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { namespace } from "../../core/storage";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import pack, { register } from ".";
import { assists } from "./assists";
import { CROSS, LINE, UNKNOWN, check } from "./board";
import { cluesOf, gridOf, loopy, tilingFeature, type LoopyAction, type LoopyPuzzle, type LoopyState } from "./def";
import { dotRef, edgeRef } from "./names";
import { techniques } from "./techniques";
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

/** A session with the pack attached the way the shell does it; `auto` techniques start switched on. */
function played(p: LoopyPuzzle, auto: string[] = []) {
  const registry = new Registry();
  register(registry);
  for (const t of techniques) if (auto.includes(t.id)) registry.technique({ ...t, defaults: { auto: true } });
  const s = new Session(loopy, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  const plugins = new PluginHost(registry, s);
  return { registry, s, host, plugins };
}

const LEVEL_CAP: Record<string, number> = { easy: 9, normal: 19, tricky: 29, hard: 39 };

for (const difficulty of ["easy", "normal", "tricky", "hard"]) {
  test(`techniques alone solve ${difficulty} puzzles, every step agreeing with the solution`, async () => {
    const p = await gen({ width: 7, height: 7, difficulty }, `tech-${difficulty}`);
    const sol = analyse(gridOf(p), cluesOf(p)).solution!;
    let s = loopy.init(p);
    let hardest = 0;
    for (let i = 0; i < 1000 && !loopy.isSolved(p, s); i++) {
      const hit = firstStep(loopy, techniques, p, s);
      expect(hit).not.toBeNull();
      for (const a of hit!.step.actions as LoopyAction[]) for (const e of a.edges) expect(a.value === LINE).toBe(sol[e] === LINE);
      expect(hit!.step.message.length).toBeGreaterThan(0);
      expect(hit!.step.nudge?.length).toBeGreaterThan(0);
      hardest = Math.max(hardest, hit!.technique.level);
      s = applyStep(loopy, p, s, hit!.step);
    }
    expect(loopy.isSolved(p, s)).toBe(true);
    expect(hardest).toBeLessThanOrEqual(LEVEL_CAP[difficulty]!);
    if (difficulty === "hard") expect(hardest).toBeGreaterThanOrEqual(30);
    expect(rateByTechniques(loopy, techniques, p)?.hardest.level).toBe(hardest);
  }, 60_000);
}

test("hints point out a wrong mark first, then solve the board", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "tricky" }, "hint");
  const { s } = played(p);
  const wrong = loopy.solve!(p)!.edges.indexOf(CROSS);
  s.dispatch({ type: "set", edges: [wrong], value: LINE });
  const fix = s.hint()!;
  expect(fix.actions?.[0]).toEqual({ type: "set", edges: [wrong], value: UNKNOWN });
  s.dispatch(fix.actions![0]!);
  for (let i = 0; i < 500 && !s.solved; i++) {
    const h = s.hint()!;
    expect(h.technique ?? "").not.toBe("");
    s.batch(() => { for (const a of h.actions!) s.dispatch(a); });
  }
  expect(s.solved).toBe(true);
});

test("auto techniques cascade together inside the move that triggered them", () => {
  // a 1 in the top middle cell; its bottom edge as a line crosses its other three, which leaves
  // dead ends along the top border
  const p = nativeFormat.parse("square:3x3:a1g");
  const { s } = played(p, ["loopy.clue-full", "loopy.dot-dead-end"]);
  const g = gridOf(p);
  const below = g.fe[1]!.find((e) => g.ef[2 * e] === 4 || g.ef[2 * e + 1] === 4)!;
  s.dispatch({ type: "set", edges: [below], value: LINE });
  // the same fixpoint the two techniques reach by hand
  let want = loopy.reduce(p, loopy.init(p), { type: "set", edges: [below], value: LINE });
  const auto = techniques.filter((t) => t.id === "loopy.clue-full" || t.id === "loopy.dot-dead-end");
  for (let hit = firstStep(loopy, auto, p, want); hit; hit = firstStep(loopy, auto, p, want)) want = applyStep(loopy, p, want, hit.step);
  expect(s.state).toEqual(want);
  expect(want.edges.filter((m) => m === CROSS).length).toBeGreaterThan(3);
  s.undo();
  expect(s.state.edges.every((m) => m === UNKNOWN)).toBe(true);
});

test("erasing is a retraction, so auto techniques don't redo it", () => {
  const p = nativeFormat.parse("square:2x2:1c");
  const { s } = played(p, ["loopy.clue-full"]);
  const g = gridOf(p);
  s.dispatch({ type: "set", edges: [g.fe[0]![0]!], value: LINE });
  const crossed = g.fe[0]![1]!;
  expect(s.state.edges[crossed]).toBe(CROSS);
  s.dispatch({ type: "set", edges: [crossed], value: UNKNOWN });
  expect(s.state.edges[crossed]).toBe(UNKNOWN);
  expect(loopy.isRetraction!({ type: "set", edges: [0], value: UNKNOWN })).toBe(true);
  expect(loopy.isRetraction!({ type: "set", edges: [0], value: CROSS })).toBe(false);
});

test("local techniques keep working next to a mistake elsewhere", () => {
  const p = nativeFormat.parse("square:4x4:1o");
  const g = gridOf(p);
  // a dot with three lines far from the 1
  const v = g.nv - 1 - (g.nv > 10 ? 6 : 0);
  let s: LoopyState = loopy.init(p);
  s = loopy.reduce(p, s, { type: "set", edges: g.ve[v]!.slice(0, 3), value: LINE });
  s = loopy.reduce(p, s, { type: "set", edges: [g.fe[0]![0]!], value: LINE });
  const t = techniques.find((x) => x.id === "loopy.clue-full")!;
  expect(t.find(p, s)?.actions[0]?.edges.length).toBe(3);
  expect(techniques.find((x) => x.id === "loopy.window-face")!.find(p, s)).toBeNull();
});

test("mistake checks only exist when the puzzle has one solution", async () => {
  const registry = new Registry();
  register(registry);
  const unique = await gen({ width: 4, height: 4 }, "features");
  const ambiguous = nativeFormat.parse("square:3x3:i");
  expect(loopy.features!(unique)).toContain("solution");
  expect(loopy.features!(ambiguous)).not.toContain("solution");
  expect(loopy.features!(unique)).toContain(tilingFeature("square"));
  const ids = (p: LoopyPuzzle) => registry.pluginsFor(loopy, p).map((x) => x.id);
  expect(ids(unique)).toContain("loopy.mistakes");
  expect(ids(ambiguous)).not.toContain("loopy.mistakes");
  expect(ids(ambiguous)).not.toContain("loopy.mistake-hints");
});

test("every technique has a practice position", async () => {
  for (const t of techniques) {
    const pos = await findPracticePosition(loopy, techniques, t, "practice", new AbortController().signal);
    expect(pos).not.toBeNull();
    expect(firstStep(loopy, techniques, pos!.puzzle, pos!.state)?.technique.id).toBe(t.id);
  }
}, 120_000);

test("switched-on auto-cross assists carry over to their techniques", () => {
  const mem = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  try {
    namespace("plugin").set("loopy.auto-cross-dots", { enabled: true, settings: { deadEnds: true } });
    namespace("plugin").set("loopy.auto-cross-clues", { enabled: false, settings: {} });
    pack({ registry: new Registry(), storage: namespace, look: { asset: (_: string, d: string) => d } } as unknown as GamesApi);
    const tech = namespace("technique");
    expect(tech.get("loopy.dot-full", {})).toEqual({ auto: true });
    expect(tech.get("loopy.dot-dead-end", {})).toEqual({ auto: true });
    expect(tech.get("loopy.clue-full", null)).toBeNull();
    expect(namespace("plugin").get("loopy.auto-cross-dots", null)).toBeNull();
  } finally {
    g.localStorage = had;
  }
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

test("hints name cells like the board labels on square grids, and say \"this\" elsewhere", () => {
  const p = nativeFormat.parse("square:2x2:1c");
  const g = gridOf(p);
  const top = g.fe[0]!.find((e) => g.vy[g.ev[2 * e]!] === 0 && g.vy[g.ev[2 * e + 1]!] === 0)!;
  expect(edgeRef(g, top)).toBe("the top edge of A1");
  expect(dotRef(g, g.fv[3]![0]!)).toBe("the top-left corner of B2");
  const s = loopy.reduce(p, loopy.init(p), { type: "set", edges: [top], value: LINE });
  const step = techniques.find((t) => t.id === "loopy.clue-full")!.find(p, s)!;
  expect(step.message).toContain("the 1 in A1");
  expect(step.nudge).toBe("look at the 1 in A1");
  const hex = nativeFormat.parse(nativeFormat.serialize!({ tiling: "honeycomb", w: 3, h: 3, clues: Array.from({ length: getGrid("honeycomb", 3, 3).nf }, (_, i) => (i === 0 ? 0 : -1)) }));
  const hs = techniques.find((t) => t.id === "loopy.clue-full")!.find(hex, loopy.init(hex))!;
  expect(hs.message).toContain("this 0");
});
