import { expect, test } from "bun:test";
import { generate as coreGenerate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { PluginHost } from "../../core/plugins";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import type { Step } from "../../core/types";
import { TechniqueHost, applyStep, findPracticePosition, findStep, firstStep } from "../../core/techniques";
import { register } from "./index";
import { techniques } from "./techniques";
import { loopSides, lockConflicts } from "./assists";
import { compactFormat, gridFormat, sgtFormat } from "./formats";
import { D, DIRS, L, R, U, coord, isTree, neighbour, opp, rotate, type NetPuzzle } from "./grid";
import { net, type NetAction, type NetHintFocus, type NetState } from "./logic";
import { searchSolutions, solveLogic, type Tier } from "./solver";

const solved = (p: NetPuzzle) => (net.solve!(p, net.init(p)) as { board: NetState }).board;

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

function hosted(p: NetPuzzle) {
  const registry = new Registry();
  register(registry);
  const session = new Session(net, p, { kind: "imported" });
  const host = new TechniqueHost(registry, session);
  const plugins = new PluginHost(registry, session);
  return { registry, session, host, plugins };
}

test("techniques alone solve generated puzzles, each step matching the solution", async () => {
  const hardestFor: Record<string, number> = { easy: 2, normal: 4, hard: 5 };
  for (const params of [
    { width: 6, height: 6, difficulty: "easy" },
    { width: 7, height: 7, difficulty: "normal" },
    { width: 6, height: 5, wrap: true, difficulty: "hard" },
    { width: 8, height: 8, barriers: 40, difficulty: "normal" },
  ]) {
    for (const seed of ["a", "b"]) {
      const p = await gen(params, seed);
      const sol = solved(p).tiles;
      let s = net.init(p);
      let hardest = 0;
      for (let k = 0; k < 500 && !net.isSolved(p, s); k++) {
        const hit = firstStep(net, techniques, p, s);
        expect(hit).not.toBeNull();
        const act = hit!.step.actions[0] as Extract<NetAction, { type: "set" }>;
        expect(act.mask).toBe(sol[act.cell]!);
        hardest = Math.max(hardest, hit!.technique.level);
        s = applyStep(net, p, s, hit!.step);
      }
      expect(net.isSolved(p, s)).toBe(true);
      expect(hardest).toBeLessThanOrEqual(hardestFor[params.difficulty]!);
    }
  }
});

test("a technique only reports tiles the easier ones can't pin down", async () => {
  const p = await gen({ width: 7, height: 7, difficulty: "hard" }, "label");
  const cellOf = (st: { actions: NetAction[] }) => (st.actions[0] as Extract<NetAction, { type: "set" }>).cell;
  let s = net.init(p);
  const seen = new Set<string>();
  for (let k = 0; k < 500 && !net.isSolved(p, s); k++) {
    for (const t of techniques) {
      if (t.level === 1) continue;
      const step = findStep(net, t, p, s) as Step<NetAction> | null;
      if (!step) continue;
      seen.add(t.id);
      const easier = techniques.filter((e) => e.level < t.level);
      let e = s;
      for (let guard = 0; guard < 500; guard++) {
        const hit = firstStep(net, easier, p, e);
        if (!hit) break;
        e = applyStep(net, p, e, hit.step);
      }
      expect(e.locked[cellOf(step)]).toBe(0);
    }
    s = applyStep(net, p, s, firstStep(net, techniques, p, s)!.step);
  }
  expect(seen.size).toBeGreaterThan(0);
});

test("hints: a wrong lock is pointed out first; technique steps then give actions", async () => {
  for (const params of [{ width: 6, height: 6, difficulty: "normal" }, { width: 6, height: 5, wrap: true, difficulty: "hard" }]) {
    const p = await gen(params, "hints");
    const { session } = hosted(p);
    const sol = solved(p).tiles;
    const bad = session.state.tiles.findIndex((m, i) => m !== sol[i]);
    session.dispatch({ type: "lock", cells: [bad], on: true });
    const first = session.hint();
    expect(first?.actions?.[0]).toEqual({ type: "lock", cells: [bad], on: false });
    session.dispatch(first!.actions![0]!);
    for (let k = 0; k < 400 && !session.solved; k++) {
      const hit = firstStep(net, techniques, p, session.state);
      if (!hit) break;
      expect(hit.step.actions.length).toBeGreaterThan(0);
      expect(hit.step.message.length).toBeGreaterThan(0);
      session.batch(() => { for (const a of hit.step.actions) session.dispatch(a as NetAction); });
    }
  }
});

test("technique hints nudge first, then explain with a ghost of the answer", async () => {
  const p = await gen({ width: 5, height: 5, difficulty: "easy" }, "nudge");
  const { session } = hosted(p);
  const h = session.hint()!;
  expect(h.level).toBe(1);
  expect((h.focus as NetHintFocus).cell).toBe(-1);
  const full = h.more!;
  const f = full.focus as NetHintFocus;
  expect(f.cell).toBeGreaterThanOrEqual(0);
  expect(f.mask).toBe(solved(p).tiles[f.cell]);
  expect(full.message).toMatch(/lock it/);
});

test("every hint shows what it talks about: named cells are highlighted, \"like this\" has a ghost", async () => {
  const name = /\b([A-Z]+)(\d+)\b/g;
  const cellOf = (p: NetPuzzle, m: RegExpMatchArray) => {
    let col = 0;
    for (const ch of m[1]!) col = col * 26 + ch.charCodeAt(0) - 64;
    return (Number(m[2]) - 1) * p.w + col - 1;
  };
  for (const params of [
    { width: 3, height: 3, difficulty: "easy" },
    { width: 7, height: 5, wrap: true, difficulty: "hard" },
    { width: 12, height: 9, barriers: 40, difficulty: "normal" },
    { width: 28, height: 3, difficulty: "normal" },
  ]) {
    const p = await gen(params, "explain");
    const { session } = hosted(p);
    let likeThis = 0;
    for (let k = 0; k < 900 && !session.solved; k++) {
      const hit = firstStep(net, techniques, p, session.state);
      if (!hit) break;
      const nudge = session.hint()!;
      for (const h of [nudge, nudge.more ?? nudge]) {
        const f = h.focus as NetHintFocus;
        for (const m of h.message.matchAll(name)) {
          const c = cellOf(p, m);
          expect(f.cell === c || f.cells.includes(c)).toBe(true);
        }
        if (/like this/.test(h.message)) {
          likeThis++;
          expect(f.cell).toBeGreaterThanOrEqual(0);
          expect(f.mask).toBeDefined();
          expect(session.state.tiles[f.cell]).not.toBe(f.mask);
        }
      }
      session.batch(() => { for (const a of hit.step.actions) session.dispatch(a as NetAction); });
    }
    expect(likeThis).toBeGreaterThan(0);
  }
});

test("cells are named by column letter and row number", () => {
  const p = sgtFormat.parse("2x2:9c22");
  expect(coord(p, 0)).toBe("A1");
  expect(coord(p, 3)).toBe("B2");
  expect(coord({ w: 30, h: 2, wrap: false }, 30 + 27)).toBe("AB2");
});

test("unlocking is a retraction; locking and turning aren't", () => {
  expect(net.isRetraction!({ type: "lock", cells: [0], on: false })).toBe(true);
  expect(net.isRetraction!({ type: "lock", cells: [0], on: true })).toBe(false);
  expect(net.isRetraction!({ type: "rotate", cell: 0, turns: 1 })).toBe(false);
});

test("features and wrap-only widget", async () => {
  const wrap = await gen({ width: 5, height: 5, wrap: true }, "f");
  const flat = await gen({ width: 5, height: 5, barriers: 50 }, "f");
  expect(net.features!(wrap)).toEqual(["wrap"]);
  expect(net.features!(flat)).toEqual(["walls"]);
  const registry = new Registry();
  register(registry);
  expect(registry.widgetsFor(net, wrap).map((w) => w.id)).toContain("net.scroll");
  expect(registry.widgetsFor(net, flat).map((w) => w.id)).not.toContain("net.scroll");
});

test("every technique has a practice position", async () => {
  for (const t of techniques) {
    const pos = await findPracticePosition(net, techniques, t, "practice", new AbortController().signal);
    expect(pos).not.toBeNull();
    expect(findStep(net, t, pos!.puzzle, pos!.state)!.actions.length).toBe(1);
  }
}, 60_000);

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
