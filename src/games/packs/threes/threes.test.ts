import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { findPracticePosition, findStep, firstStep, applyStep, isPartOfStep, stepsOf } from "../../core/techniques";
import { N, bonusPool, deal, gameThrees, gridFormat, mergeable, reduce, scoreOf, shift, tileScore, type PuzzleThrees } from "./logic";
import { cornerIt, feedNext, ladder, lineUp, makeThree, mergeTwins, onlyMove, techniquesThrees } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(gameThrees, params, seed, sig()) as Promise<PuzzleThrees>;
const row = (cells: string) => cells.split(" ").map((v) => (v === "." ? 0 : Number(v)));
const board = (rows: string, extra = "next 1\ndeck 1 2 3") => gridFormat.parse(`${rows}\n${extra}\nseed 5`);

test("generation is deterministic: nine tiles, a stack, and the next tile", async () => {
  const a = await gen({}, "abc");
  expect(await gen({}, "abc")).toEqual(a);
  expect(await gen({}, "abd")).not.toEqual(a);
  expect(a.start.filter(Boolean).length).toBe(9);
  expect(a.start.filter(Boolean).every((v) => v === 1 || v === 2 || v === 3)).toBe(true);
  const seen = [...a.start.filter(Boolean), a.next, ...a.deck];
  expect(seen.length).toBe(9 + 1 + a.deck.length);
  expect(a.deck.length).toBe(2);
});

test("1 and 2 merge, then equal tiles from 3 up", () => {
  expect([mergeable(1, 2), mergeable(2, 1), mergeable(1, 1), mergeable(2, 2), mergeable(3, 3), mergeable(3, 6), mergeable(6, 6), mergeable(0, 0)]).toEqual([true, true, false, false, true, false, true, false]);
});

test("tiles move one step; a tile moving into a vacated cell does not merge", () => {
  const left = (cells: string) => shift(4, [...row(cells), ...Array(12).fill(0)], 3).grid.slice(0, 4);
  expect(left("1 2 . .")).toEqual([3, 0, 0, 0]);
  expect(left(". 1 2 .")).toEqual([1, 2, 0, 0]);
  expect(left("3 3 6 12")).toEqual([6, 6, 12, 0]);
  expect(left("1 1 . .")).toEqual([1, 1, 0, 0]);
  expect(left("2 . 1 .")).toEqual([2, 1, 0, 0]);
  expect(left("6 3 . 3")).toEqual([6, 3, 3, 0]);
});

test("the new tile has a line that moved and an empty back cell to land on", () => {
  for (let seed = 0; seed < 200; seed++) {
    const grid = Array.from({ length: 16 }, (_, i) => ((i * 7 + seed * 13) % 5 === 0 ? [1, 2, 3, 6][(i + seed) % 4]! : 0));
    for (let d = 0; d < 4; d++) {
      const r = shift(N, grid, d);
      expect(r.entries.every((c) => r.grid[c] === 0)).toBe(true);
      expect(r.entries.length).toBe(r.moved.length);
    }
  }
});

test("a slide brings in the tile that was shown, on a moved line's back edge, and the next one is drawn", async () => {
  const p = board("1 2 . .\n. . . .\n. . . .\n. . . .", "next 2\ndeck 1 1 3");
  const s = reduce(p, gameThrees.init(p), { type: "slide", dir: 3 });
  expect(s.grid.slice(0, 4)).toEqual([3, 0, 0, 2]);
  expect(s.grid.filter(Boolean).length).toBe(2);
  expect(s.deck.length).toBe(2);
  expect(s.moves).toBe(1);
  expect(reduce(p, gameThrees.init(p), { type: "slide", dir: 1 })).not.toBe(gameThrees.init(p));
  const stuck = board("1 1 1 1\n1 1 1 1\n1 1 1 1\n1 1 1 1");
  const idle = gameThrees.init(stuck);
  expect(reduce(stuck, idle, { type: "slide", dir: 0 })).toBe(idle);
  expect(gameThrees.isLost!(stuck, gameThrees.init(stuck))).toBe(true);
});

test("the same moves always bring the same tiles", async () => {
  const p = await gen({}, "replay");
  const play = () => {
    let s = gameThrees.init(p);
    for (let i = 0; i < 60; i++) s = gameThrees.reduce(p, s, { type: "slide", dir: i % 4 });
    return s;
  };
  expect(play()).toEqual(play());
});

test("stacks hold four of each, refill when empty, and bonus tiles come from 48", () => {
  let deck: number[] = [];
  let seed = 1;
  const counts = new Map<number, number>();
  for (let i = 0; i < 12; i++) {
    const d = deal(deck, seed, 3);
    expect(d.bonus).toBe(false);
    counts.set(d.card, (counts.get(d.card) ?? 0) + 1);
    deck = d.deck;
    seed = d.seed;
  }
  expect([...counts]).toEqual(expect.arrayContaining([[1, 4], [2, 4], [3, 4]]));
  expect(deck).toEqual([]);
  expect(bonusPool(47)).toEqual([]);
  expect(bonusPool(48)).toEqual([6]);
  expect(bonusPool(192)).toEqual([6, 12, 24]);
  let bonus = 0;
  for (let i = 0; i < 4000; i++) {
    const d = deal([], i, 96);
    if (d.bonus) { bonus++; expect([6, 12]).toContain(d.card); }
  }
  expect(bonus).toBeGreaterThan(4000 / 21 / 2);
  expect(bonus).toBeLessThan((4000 / 21) * 2);
});

test("a tile is worth 3 to the power of its doublings from 3; the score is the board's worth", () => {
  expect([1, 2, 3, 6, 12, 384].map(tileScore)).toEqual([0, 0, 3, 9, 27, 6561]);
  expect(scoreOf([3, 6, 12, 1, 2, 0])).toBe(39);
});

test("the grid format round-trips, with its next tile, deck, goal and seed", async () => {
  const p = await gen({ goal: "384" }, "fmt");
  expect(gridFormat.parse(gridFormat.serialize!(p))).toEqual(p);
  const b = gridFormat.parse("3 . . .\n. . . .\n. . . .\n. . . 6\nnext +12\nseed 9");
  expect(b.bonus).toBe(true);
  expect(b.next).toBe(12);
  expect(gridFormat.parse(gridFormat.serialize!(b))).toEqual(b);
  expect(() => gridFormat.parse("4 . . .\n. . . .\n. . . .\n. . . .")).toThrow();
  expect(() => gridFormat.parse("3 . .\n. . .\n. . .")).toThrow();
});

const dirsOf = (t: Parameters<typeof stepsOf>[1], p: PuzzleThrees) => stepsOf(gameThrees, t, p, gameThrees.init(p)).map((s) => (s.actions[0] as unknown as { dir: number }).dir).sort();

test("strategies fire on the boards they describe", () => {
  const cases: [typeof makeThree, PuzzleThrees, number[]][] = [
    [onlyMove, board("1 . . .\n2 . . .\n3 . . .\n6 . . ."), []],
    [makeThree, board("1 2 . .\n. . . .\n. . . .\n. . . ."), [3]],
    [mergeTwins, board("6 6 . .\n. . . .\n. . . .\n. . . ."), [3]],
    [feedNext, board(". . . .\n. . . .\n. . . .\n. . 2 .", "next 1\ndeck 1 2 3"), [0]],
    [ladder, board("48 24 . .\n. . 12 .\n. . . .\n. . . ."), [0]],
    [lineUp, board("1 . 2 .\n. . . .\n. . . .\n. . . ."), [3]],
    [cornerIt, board(". . . .\n. . . .\n. . . .\n. 24 . 3"), [3]],
  ];
  for (const [t, p, want] of cases.slice(1)) {
    const got = dirsOf(t, p);
    expect({ id: t.id, got: want.filter((d) => got.includes(d)) }).toEqual({ id: t.id, got: want });
  }
  expect(dirsOf(onlyMove, board("1 . . .\n2 . . .\n3 . . .\n6 . . ."))).toEqual([]);
  const forced = board("1 2 3 6\n2 1 6 12\n3 6 1 2\n6 12 2 3");
  expect(dirsOf(onlyMove, forced).length).toBeLessThanOrEqual(1);
});

test("the next tile is used only when the board shows it", () => {
  const p = board(". . . .\n. . . .\n. . . .\n. . 2 .", "next 1\ndeck 1 2 3");
  expect(dirsOf(feedNext, p).length).toBeGreaterThan(0);
  const hidden = { ...p, bonus: true };
  expect(dirsOf(feedNext, hidden)).toEqual([]);
  expect(dirsOf(feedNext, { ...p, next: 3 })).toEqual([]);
  const seeded = { ...p, seed: p.seed + 1 };
  expect(dirsOf(feedNext, seeded)).toEqual(dirsOf(feedNext, p));
});

test("a hand move a strategy accounts for is part of one of its steps", () => {
  const p = board("1 2 . .\n. . . .\n. . . 3\n. . . .");
  const s = gameThrees.init(p);
  const left = gameThrees.reduce(p, s, { type: "slide", dir: 3 });
  expect(isPartOfStep(gameThrees, p, s, left, stepsOf(gameThrees, makeThree, p, s))).toBe(true);
  const down = gameThrees.reduce(p, s, { type: "slide", dir: 2 });
  expect(isPartOfStep(gameThrees, p, s, down, stepsOf(gameThrees, makeThree, p, s))).toBe(false);
});

test("techniques play on, and every one has a board to watch and practice on", async () => {
  const all = techniquesThrees.slice().sort((a, b) => a.level - b.level);
  expect(new Set(all.map((t) => t.level)).size).toBe(all.length);
  const p = await gen({}, "play");
  let s = gameThrees.init(p);
  for (let i = 0; i < 300; i++) {
    const hit = firstStep(gameThrees, all, p, s);
    if (!hit) break;
    s = applyStep(gameThrees, p, s, hit.step);
  }
  expect(s.moves).toBeGreaterThan(5);
  for (const t of all.filter((x) => x !== onlyMove)) {
    expect(t.practice).not.toBe(false);
    const pos = await findPracticePosition(gameThrees, all, t, "watch", sig(), 24);
    expect(pos).not.toBeNull();
    expect(findStep(gameThrees, t, pos!.puzzle, pos!.state)).not.toBeNull();
  }
});
