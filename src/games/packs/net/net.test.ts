import { expect, test } from "bun:test";
import { generate as coreGenerate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { loopSides, lockConflicts } from "./assists";
import { compactFormat, gridFormat, sgtFormat } from "./formats";
import { D, DIRS, L, R, U, isTree, neighbour, opp, rotate, type NetPuzzle } from "./grid";
import { net, type NetAction, type NetState } from "./logic";
import { searchSolutions, solveLogic, type Tier } from "./solver";

const gen = (params: Record<string, unknown>, seed: string) =>
  coreGenerate(net, params, seed, new AbortController().signal) as Promise<NetPuzzle>;

/** Random spanning tree, unscrambled. */
function randomTreePuzzle(seed: string, w: number, h: number, wrap: boolean): NetPuzzle {
  const rng = createRng(seed);
  const g = { w, h, wrap };
  const n = w * h;
  const tiles = Array.from({ length: n }, () => 0);
  const seen = new Uint8Array(n);
  const frontier: number[] = [];
  const add = (i: number) => {
    seen[i] = 1;
    for (let k = 0; k < 4; k++) if (neighbour(g, i, DIRS[k]!) >= 0) frontier.push(i * 4 + k);
  };
  add(0);
  while (frontier.length) {
    const e = frontier.splice(rng.int(frontier.length), 1)[0]!;
    const i = e >> 2, d = DIRS[e & 3]!, j = neighbour(g, i, d);
    if (seen[j]) continue;
    tiles[i]! |= d;
    tiles[j]! |= opp(d);
    add(j);
  }
  return { ...g, tiles, barriers: tiles.map(() => 0), source: 0 };
}

test("generation is deterministic per (params, seed)", async () => {
  const params = { width: 8, height: 6, wrap: true, difficulty: "hard" };
  const a = await gen(params, "same");
  const b = await gen(params, "same");
  expect(a).toEqual(b);
  expect(await gen(params, "other")).not.toEqual(a);
});

test("generated puzzles are unique, logic-solvable at their tier, and start unsolved", async () => {
  const cases = [
    { width: 5, height: 5, wrap: false, difficulty: "easy" },
    { width: 7, height: 7, wrap: false, difficulty: "normal" },
    { width: 6, height: 6, wrap: true, difficulty: "normal" },
    { width: 7, height: 6, wrap: true, difficulty: "hard" },
    { width: 8, height: 8, wrap: false, barriers: 40, difficulty: "normal" },
    { width: 3, height: 3, wrap: true, difficulty: "normal" },
    { width: 2, height: 6, wrap: false, difficulty: "normal" },
  ];
  const tierOf: Record<string, Tier> = { easy: 1, normal: 2, hard: 3 };
  for (const params of cases) {
    for (const seed of ["a", "b", "c"]) {
      const p = await gen(params, seed);
      expect(isTree(p, p.tiles)).toBe(false);
      expect(solveLogic(p, { tier: tierOf[params.difficulty]! }).status).toBe("solved");
      expect(searchSolutions(p, 2).count).toBe(1);
      p.barriers.forEach((b, i) => {
        for (const d of DIRS) if (b & d) expect(p.barriers[neighbour(p, i, d)]! & opp(d)).toBeTruthy();
      });
    }
  }
});

test("solver never rules out the true orientation and only claims solved when unique", () => {
  const rng = createRng("fuzz");
  for (let t = 0; t < 250; t++) {
    const p = randomTreePuzzle(`t${t}`, rng.range(2, 5), rng.range(2, 5), rng.bool());
    const truth = p.tiles;
    const scrambled = { ...p, tiles: truth.map((m) => rotate(m, rng.int(4))) };
    for (const tier of [1, 2, 3] as const) {
      const r = solveLogic(scrambled, { tier });
      expect(r.status).not.toBe("contradiction");
      r.masks.forEach((m, i) => {
        if (m >= 0) expect(m).toBe(truth[i]!);
      });
      if (r.status === "solved") expect(searchSolutions(scrambled, 2).count).toBe(1);
    }
  }
});

test("formats round-trip", async () => {
  const p = await gen({ width: 6, height: 5, wrap: true, barriers: 50 }, "fmt");
  for (const f of [compactFormat, sgtFormat, gridFormat]) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  const moved = { ...p, source: 3 };
  expect(compactFormat.parse(compactFormat.serialize!(moved))).toEqual(moved);
  expect(gridFormat.parse(gridFormat.serialize!(moved))).toEqual(moved);
});

test("sgt game ids parse tiles and v/h walls", () => {
  const p = sgtFormat.parse("2x2:9c2v2");
  expect(p.tiles).toEqual([9, 12, 2, 2]);
  expect(p.wrap).toBe(false);
  expect(p.barriers).toEqual([0, 0, R, L]);
  expect(p.source).toBe(3);
  expect(sgtFormat.serialize!(p)).toBe("2x2:9c2v2");
  expect(sgtFormat.parse("2x2wb0.3a:9c22").wrap).toBe(true);
  expect(() => sgtFormat.parse("2x2:9c2")).toThrow();
  expect(() => sgtFormat.parse("2x2:ffff")).toThrow();
});

test("grid format reads box drawing and walls", () => {
  const p = gridFormat.parse("net 2x2 source=1,1\n┌┐\n╵╵\nbarrier 1,2 right\n");
  expect(p.tiles).toEqual([9, 12, 2, 2]);
  expect(p.source).toBe(0);
  expect(p.barriers).toEqual([0, 0, R, L]);
});

test("reducer: locks block turning, invalid sets are ignored, no-ops keep identity", () => {
  const p = sgtFormat.parse("2x2:9c22");
  let s: NetState = net.init(p);
  const r = (a: NetAction) => (s = net.reduce(p, s, a));
  const before = s;
  r({ type: "lock", cells: [0] });
  expect(s.locked[0]).toBe(1);
  const locked = s;
  r({ type: "rotate", cell: 0, turns: 1 });
  expect(s).toBe(locked);
  r({ type: "set", cell: 1, mask: 15 });
  expect(s).toBe(locked);
  r({ type: "rotate", cell: 1, turns: 4 });
  expect(s).toBe(locked);
  r({ type: "lock", cells: [0], on: false });
  r({ type: "rotate", cell: 0, turns: -1 });
  expect(s.tiles[0]).toBe(rotate(9, 3));
  expect(before.tiles[0]).toBe(9);
});

test("following hints from scratch solves the puzzle", async () => {
  for (const params of [{ width: 6, height: 6, difficulty: "normal" }, { width: 6, height: 5, wrap: true, difficulty: "hard" }]) {
    const p = await gen(params, "hints");
    const session = new Session(net, p, { kind: "imported" });
    session.dispatch({ type: "lock", cells: [0] });
    const firstWrong = session.hint();
    if (session.state.tiles[0] !== net.solve!(p)!.tiles[0]) {
      expect(firstWrong?.actions?.[0]).toEqual({ type: "lock", cells: [0], on: false });
    }
    for (let k = 0; k < 400 && !session.solved; k++) {
      const h = session.hint();
      expect(h?.actions?.[0]).toBeDefined();
      expect(h!.message.length).toBeGreaterThan(0);
      expect(session.dispatch(h!.actions![0]!)).toBe(true);
    }
    expect(session.solved).toBe(true);
  }
});

test("loop and conflict annotations", () => {
  const p: NetPuzzle = { w: 2, h: 2, wrap: false, tiles: [9, 12, 3, 6], barriers: [0, 0, 0, 0], source: 0 };
  expect([...loopSides(p, p.tiles)]).toEqual([9, 12, 3, 6]);
  expect([...loopSides(p, [9, 12, 2, 2])]).toEqual([0, 0, 0, 0]);
  const c = lockConflicts(p, { tiles: [1, 4, 2, 2], locked: [1, 0, 1, 1] });
  expect(c[0]).toBe(D);
  expect(c[2]).toBe(U);
  expect(c[3]).toBe(0);
  expect(lockConflicts(p, { tiles: [4, 4, 2, 2], locked: [1, 0, 0, 0] })[0]).toBe(L);
});

test("thin wrapping boards fail fast with a reason", async () => {
  await expect(gen({ width: 2, height: 9, wrap: true }, "x")).rejects.toThrow(/at least 3/);
});
