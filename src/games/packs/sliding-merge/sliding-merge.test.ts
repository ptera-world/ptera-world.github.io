import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { resolve } from "../../core/schema";
import { applyStep, findPracticePosition, findStep, firstStep, isPartOfStep, stepsOf } from "../../core/techniques";
import type { Technique } from "../../core/types";
import {
  BLOCK, MERGES, best, bonusPool, deal, gameMerge, gridFormat, move, params, presets, reduce, rulesOf, scoreOf, tileWorth, type PuzzleMerge, type Rules, type StateMerge,
} from "./logic";
import {
  bigMerge, buildSnake, claimCorner, feedNext, fullEdge, growCorner, keepCorner, lineUp, longestSnake, makeRoom, onlyMove, reachGoal, smallPair, techniquesMerge, towardCorner, weighUp,
} from "./techniques";
import { bestSlide } from "./weigh";

const sig = () => new AbortController().signal;
const gen = (p: Record<string, unknown>, seed: string) => generate(gameMerge, p, seed, sig()) as Promise<PuzzleMerge>;
const preset = (label: string) => presets.find((x) => x.label === label)!.params;
const all = techniquesMerge.slice().sort((a, b) => a.level - b.level);
const forPuzzle = (p: PuzzleMerge) => {
  const has = new Set(gameMerge.features!(p));
  return all.filter((t) => (t.requires ?? []).every((f) => has.has(f)));
};
const autoPlay = (p: PuzzleMerge, limit = 20000): StateMerge => {
  const list = forPuzzle(p);
  let s = gameMerge.init(p);
  for (let i = 0; i < limit && !gameMerge.isSolved(p, s); i++) {
    const hit = firstStep(gameMerge, list, p, s);
    if (!hit) break;
    s = applyStep(gameMerge, p, s, hit.step);
  }
  return s;
};
const RULES_2048 = "rule doubles";
const RULES_THREES = "rule threes\nnext 1\ndeck 1 2 3";
const board = (rows: string, extra = RULES_2048) => gridFormat.parse(`${rows}\n${extra}\nseed 5`);
/** Every spot the next 1 can land on after the best slide (up) is next to a 2. */
const FEED = ". . 3 .\n. . . .\n. . . .\n. . . 2";
const dirsOf = (t: Technique, p: PuzzleMerge) => stepsOf(gameMerge, t, p, gameMerge.init(p)).map((s) => (s.actions[0] as unknown as { dir: number }).dir).sort();

// --- the merge: every setup the old games had is a preset here ---

/** The setups 2048 and threes offered as presets before they were one game, as rules. */
const OLD_SETUPS: { from: string; size: number; rules: Rules }[] = [
  ...([[4, 2048], [3, 128], [5, 4096], [6, 8192]] as const).map(([size, goal]) => ({
    from: `2048 ${size}×${size} · ${goal}`, size,
    rules: { merge: "doubles", slide: "far", entry: "anywhere", source: "random", big: 10, bonus: false, preview: false, score: "merges", goal } as Rules,
  })),
  ...[0, 192, 768].map((goal) => ({
    from: `threes goal ${goal}`, size: 4,
    rules: { merge: "threes", slide: "step", entry: "edge", source: "stack", big: 10, bonus: true, preview: true, score: "worth", goal } as Rules,
  })),
];

test("every setup the old 2048 and threes games offered is a preset", () => {
  for (const old of OLD_SETUPS) {
    const hit = presets.find((x) => {
      const v = resolve(params, x.params);
      const r = rulesOf(v);
      const same = (Object.keys(old.rules) as (keyof Rules)[]).every((k) => k === "big" && old.rules.source !== "random" ? true : r[k] === old.rules[k]);
      return v.size === old.size && same;
    });
    expect({ from: old.from, found: !!hit }).toEqual({ from: old.from, found: true });
  }
});

test("old 2048 starts with two tiles, old threes with nine from its stack", async () => {
  expect((await gen(preset("2048"), "a")).start.filter((v) => v > 0).length).toBe(2);
  const t = await gen(preset("threes"), "a");
  expect(t.start.filter((v) => v > 0).length).toBe(9);
  expect(t.start.filter((v) => v > 0).every((v) => [1, 2, 3].includes(v))).toBe(true);
  expect(t.deck.length).toBe(2);
});

test("every preset generates, plays on auto with every technique to its end, and replays exactly", async () => {
  for (const pr of presets) {
    const p = await gen(pr.params, `preset-${pr.label}`);
    expect(await gen(pr.params, `preset-${pr.label}`)).toEqual(p);
    const s = autoPlay(p, 400);
    expect({ label: pr.label, moved: s.moves > 10 }).toEqual({ label: pr.label, moved: true });
    expect(autoPlay(p, 400)).toEqual(s);
    expect(gridFormat.parse(gridFormat.serialize!(p))).toEqual(p);
  }
}, 120000);

test("published presets use published names", () => {
  expect(presets.map((x) => x.label)).toEqual([
    "2048", "2048 · 3×3 · 128", "2048 · 5×5 · 4096", "2048 · 6×6 · 8192",
    "threes", "threes · make a 192", "threes · make a 768", "fives", "1024!", "2584 (fibonacci 2048)",
  ]);
});

// --- rules ---

test("merge rules: equal tiles, 1 + 2, 2 + 3, neighbouring fibonacci numbers", () => {
  const { doubles, threes, fives, fibonacci } = MERGES;
  expect([doubles.merge(2, 2), doubles.merge(2, 4), doubles.merge(4, 4)]).toEqual([4, 0, 8]);
  expect([1, 1, 2, 2, 3, 3, 6].map((a, i) => threes.merge(a, [2, 1, 1, 2, 3, 6, 6][i]!))).toEqual([3, 0, 3, 0, 6, 0, 12]);
  expect([fives.merge(2, 3), fives.merge(2, 2), fives.merge(3, 3), fives.merge(5, 5), fives.merge(5, 10)]).toEqual([5, 0, 0, 10, 0]);
  expect([fibonacci.merge(1, 1), fibonacci.merge(1, 2), fibonacci.merge(2, 3), fibonacci.merge(3, 5), fibonacci.merge(2, 2), fibonacci.merge(1, 3), fibonacci.merge(5, 3)]).toEqual([2, 3, 5, 8, 0, 0, 8]);
});

const left = (cells: string, extra: string) => {
  const p = board(`${cells}\n. . . .\n. . . .\n. . . .`, extra);
  return move(p, p.start, 3).grid.slice(0, 4);
};

test("far slides merge each tile once, front first; one-step slides move a cell", () => {
  expect(left("2 2 2 2", RULES_2048)).toEqual([4, 4, 0, 0]);
  expect(left("2 2 4 .", RULES_2048)).toEqual([4, 4, 0, 0]);
  expect(left("4 . 4 8", RULES_2048)).toEqual([8, 8, 0, 0]);
  expect(left("1 2 . .", RULES_THREES)).toEqual([3, 0, 0, 0]);
  expect(left(". 1 2 .", RULES_THREES)).toEqual([1, 2, 0, 0]);
  expect(left("3 3 6 12", RULES_THREES)).toEqual([6, 6, 12, 0]);
  expect(left("1 1 . .", RULES_THREES)).toEqual([1, 1, 0, 0]);
  expect(left("6 3 . 3", RULES_THREES)).toEqual([6, 3, 3, 0]);
  expect(left("2 2 . 4", `${RULES_2048}\nslide step`)).toEqual([4, 0, 4, 0]);
  expect(left("1 1 2 3", "rule fibonacci")).toEqual([2, 5, 0, 0]);
  const p = board("2 2\n4 8");
  expect(move(p, p.start, 0).grid).toEqual([2, 2, 4, 8]);
});

test("blocks never move, stop tiles and split lines", () => {
  expect(left("2 # 2 .", RULES_2048)).toEqual([2, BLOCK, 2, 0]);
  expect(left(". # . 2", RULES_2048)).toEqual([0, BLOCK, 2, 0]);
  expect(left("2 # 4 4", `${RULES_2048}\nslide step`)).toEqual([2, BLOCK, 8, 0]);
});

test("an edge-entering tile always has a line that moved and an empty back cell to land on", () => {
  for (let seed = 0; seed < 200; seed++) {
    const rows = Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ((y * 4 + x) * 7 + seed * 13) % 5 === 0 ? [1, 2, 3, 6][(x + seed) % 4]! : (seed + x + y) % 11 === 0 ? "#" : ".").join(" ")).join("\n");
    for (const slide of ["step", "far"]) {
      const p = board(rows, `${RULES_THREES}\nslide ${slide}`);
      for (let d = 0; d < 4; d++) {
        const r = move(p, p.start, d);
        expect(r.entries.every((c) => r.grid[c] === 0)).toBe(true);
        expect(r.changed).toBe(r.entries.length > 0);
      }
    }
  }
});

test("a slide brings in the tile that was coming, and the next one is drawn", () => {
  const p = board("1 2 . .\n. . . .\n. . . .\n. . . .", "rule threes\nnext 2\ndeck 1 1 3");
  const s = reduce(p, gameMerge.init(p), { type: "slide", dir: 3 });
  expect(s.grid.slice(0, 4)).toEqual([3, 0, 0, 2]);
  expect(s.grid.filter((v) => v > 0).length).toBe(2);
  expect(s.deck.length).toBe(2);
  expect(s.moves).toBe(1);
  const stuck = board("1 1 1 1\n1 1 1 1\n1 1 1 1\n1 1 1 1", RULES_THREES);
  const idle = gameMerge.init(stuck);
  expect(reduce(stuck, idle, { type: "slide", dir: 0 })).toBe(idle);
  expect(gameMerge.isLost!(stuck, idle)).toBe(true);
  const full = board("2 4 2\n4 2 4\n2 4 2");
  expect(gameMerge.isLost!(full, gameMerge.init(full))).toBe(true);
});

test("2048 spawns land anywhere: a 2, a 4 about one time in ten", () => {
  const rules = rulesOf(resolve(params, preset("2048")));
  let fours = 0;
  for (let i = 0; i < 4000; i++) {
    const d = deal(rules, [], i, 2);
    expect([2, 4]).toContain(d.card);
    if (d.card === 4) fours++;
  }
  expect(fours).toBeGreaterThan(300);
  expect(fours).toBeLessThan(500);
});

test("stacks hold four of each, refill when empty, and bonus tiles come from 48", () => {
  const rules = rulesOf(resolve(params, preset("threes")));
  let deck: number[] = [];
  let seed = 1;
  const counts = new Map<number, number>();
  for (let i = 0; i < 12; i++) {
    const d = deal(rules, deck, seed, 3);
    expect(d.bonus).toBe(false);
    counts.set(d.card, (counts.get(d.card) ?? 0) + 1);
    deck = d.deck;
    seed = d.seed;
  }
  expect([...counts]).toEqual(expect.arrayContaining([[1, 4], [2, 4], [3, 4]]));
  expect(deck).toEqual([]);
  expect(bonusPool(MERGES.threes, 24)).toEqual([]);
  expect(bonusPool(MERGES.threes, 48)).toEqual([6]);
  expect(bonusPool(MERGES.threes, 192)).toEqual([6, 12, 24]);
  let bonus = 0;
  for (let i = 0; i < 4000; i++) {
    const d = deal(rules, [], i, 96);
    if (d.bonus) { bonus++; expect([6, 12]).toContain(d.card); }
  }
  expect(bonus).toBeGreaterThan(4000 / 21 / 2);
  expect(bonus).toBeLessThan((4000 / 21) * 2);
});

test("scores: merges score their new tile; threes tiles are worth 3 to the power of their rank", () => {
  expect([1, 2, 3, 6, 12, 384].map((v) => tileWorth(MERGES.threes, v))).toEqual([0, 0, 3, 9, 27, 6561]);
  const t = board("3 6 12 1\n2 . . .\n. . . .\n. . . .", RULES_THREES);
  expect(scoreOf(t, gameMerge.init(t))).toBe(39);
  const d = board("2 2 4 4\n. . . .\n. . . .\n. . . .");
  const after = reduce(d, gameMerge.init(d), { type: "slide", dir: 3 });
  expect(scoreOf(d, after)).toBe(12);
  expect(gameMerge.describeAction!(d, { type: "slide", dir: 3 }, gameMerge.init(d), after)).toBe("left +12");
});

test("the grid format round-trips every setting, and reads old 2048 and threes boards", async () => {
  for (const pr of presets) {
    const p = await gen(pr.params, `fmt-${pr.label}`);
    expect(gridFormat.parse(gridFormat.serialize!(p))).toEqual(p);
  }
  const old2048 = gridFormat.parse("2 .\n. 4\ngoal 64\nseed 3");
  expect([old2048.rules.merge, old2048.rules.goal]).toEqual(["doubles", 64]);
  const oldThrees = gridFormat.parse("3 . . .\n. . . .\n. . . .\n. . . 6\nnext +12\nseed 9");
  expect([oldThrees.rules.merge, oldThrees.rules.slide, oldThrees.bonus, oldThrees.next]).toEqual(["threes", "step", true, 12]);
  expect(gridFormat.parse("2 .\n. 4").seed).toBe(gridFormat.parse("2 .\n. 4").seed);
  expect(() => gridFormat.parse("3 .\n. 4\nrule doubles")).toThrow();
  expect(() => gridFormat.parse("2 . .\n. 4")).toThrow();
  expect(() => gridFormat.parse("2 .\n. 4\nslide sideways")).toThrow();
  expect(gridFormat.detect!("2 .\n# 4\nrule fives")).toBe(true);
});

test("1024! has its block off the edge; blocks count toward nothing", async () => {
  const p = await gen(preset("1024!"), "block");
  const c = p.start.indexOf(BLOCK);
  expect(p.start.filter((v) => v === BLOCK).length).toBe(1);
  expect([5, 6, 9, 10]).toContain(c);
  expect(p.start.filter((v) => v > 0).length).toBe(2);
});

// --- techniques ---

test("only move and making the goal tile", () => {
  const one = board("2 .\n4 .\ngoal 64");
  expect(findStep(gameMerge, onlyMove, one, gameMerge.init(one))?.actions as unknown).toEqual([{ type: "slide", dir: 1 }]);
  const goal = board("32 32 .\n. . .\n. . .\ngoal 64");
  expect([1, 3]).toContain((findStep(gameMerge, reachGoal, goal, gameMerge.init(goal))!.actions[0] as unknown as { dir: number }).dir);
});

test("strategies name the slide that weighs best, and only that one", () => {
  const cases: [Technique, PuzzleMerge][] = [
    [growCorner, board(". . . .\n. . . .\n. . . .\n16 16 . .")],
    [claimCorner, board(". . . .\n. . . .\n. . . .\n. 8 . 2")],
    [buildSnake, board("64 32 . .\n. . 16 .\n. . . .\n. . . .")],
    [makeRoom, board("64 32 . .\n. . 16 .\n. . . .\n4 4 . .")],
    [smallPair, board("1 2 . .\n. . . .\n. . . .\n. . . .", RULES_THREES)],
    [bigMerge, board("6 6 . .\n. . . .\n. . . .\n. . . .", RULES_THREES)],
    [feedNext, board(FEED, RULES_THREES)],
    [weighUp, board("64 32 . .\n. . 16 .\n. . . .\n4 4 . .")],
  ];
  for (const [t, p] of cases) {
    const got = dirsOf(t, p);
    expect({ id: t.id, got }).toEqual({ id: t.id, got: [bestSlide(p, gameMerge.init(p))] });
  }
  expect(longestSnake(4, board("64 32 16 8\n4 . . .\n. . . .\n. . . .").start)).toEqual([0, 1, 2, 3]);
});

test("strategies stay quiet where they don't apply", () => {
  expect(dirsOf(smallPair, board("2 2 . .\n. . . .\n. . . .\n. . . ."))).toEqual([]);
  expect(dirsOf(claimCorner, board("64 32 16 8\n4 . . .\n. . . .\n. . . ."))).toEqual([]);
  expect(dirsOf(lineUp, board("2 . . .\n. . . .\n. . . .\n. . . ."))).toEqual([]);
  expect(dirsOf(keepCorner, board(". . . .\n. . . .\n. . . .\n. 8 . 2"))).toEqual([]);
  expect(dirsOf(fullEdge, board(". . . .\n. . . .\n. . . .\n. 8 . 2"))).toEqual([]);
  expect(dirsOf(towardCorner, board("2 .\n. .")).length).toBeLessThanOrEqual(1);
});

test("the next tile is used only when the board shows it", () => {
  const p = board(FEED, RULES_THREES);
  expect(dirsOf(feedNext, p).length).toBe(1);
  expect(dirsOf(feedNext, { ...p, bonus: true })).toEqual([]);
  expect(dirsOf(feedNext, { ...p, rules: { ...p.rules, preview: false } })).toEqual([]);
  expect(dirsOf(feedNext, { ...p, seed: p.seed + 1 })).toEqual(dirsOf(feedNext, p));
});

test("a hand move a strategy accounts for is part of one of its steps", () => {
  const p = board("6 3 1 2\n3 . . .\n. . . .\n. . . .", "rule threes\nnext 2\ndeck 1 2 3");
  const s = gameMerge.init(p);
  const steps = stepsOf(gameMerge, smallPair, p, s);
  expect(steps.length).toBe(1);
  const d = (steps[0]!.actions[0] as unknown as { dir: number }).dir;
  expect(isPartOfStep(gameMerge, p, s, gameMerge.reduce(p, s, { type: "slide", dir: d }), steps)).toBe(true);
  const other = [0, 1, 2, 3].find((e) => e !== d && move(p, s.grid, e).changed)!;
  expect(isPartOfStep(gameMerge, p, s, gameMerge.reduce(p, s, { type: "slide", dir: other }), steps)).toBe(false);
});

test("strategies read the board, not the seed", () => {
  const p = board("64 32 . .\n. . 16 .\n. . . .\n4 4 . .");
  const q = { ...p, seed: p.seed + 1 };
  for (const t of all) {
    const a = stepsOf(gameMerge, t, p, gameMerge.init(p)).map((s) => [s.message, s.actions]);
    expect(stepsOf(gameMerge, t, q, gameMerge.init(q)).map((s) => [s.message, s.actions])).toEqual(a);
  }
});

test("every technique has a board to watch and practice on", async () => {
  expect(new Set(all.map((t) => t.level)).size).toBe(all.length);
  for (const t of all) {
    expect(t.practice).not.toBe(false);
    const pos = await findPracticePosition(gameMerge, all, t, "watch", sig(), 24);
    expect({ id: t.id, found: pos !== null }).toEqual({ id: t.id, found: true });
    expect(findStep(gameMerge, t, pos!.puzzle, pos!.state)).not.toBeNull();
  }
}, 300000);

// --- auto play strength: a decent human reaches 2048 in 2048 and 384 to 768 in threes ---

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test("2048 on auto with every technique makes the 2048 tile at least as often as not", async () => {
  const tops: number[] = [];
  for (let i = 0; i < 16; i++) {
    const p = await gen(preset("2048"), `auto${i}`);
    const s = autoPlay(p);
    expect(gameMerge.isSolved(p, s) || !!gameMerge.isLost!(p, s)).toBe(true);
    tops.push(best(s.grid));
  }
  expect(tops.filter((v) => v >= 2048).length).toBeGreaterThanOrEqual(6);
  expect(median(tops)).toBeGreaterThanOrEqual(1024);
}, 240000);

test("threes on auto with every technique gets to a 384 or more in most games", async () => {
  const tops: number[] = [];
  for (let i = 0; i < 10; i++) {
    const p = await gen(preset("threes"), `auto${i}`);
    const s = autoPlay(p);
    expect(gameMerge.isLost!(p, s)).toBeTruthy();
    tops.push(best(s.grid));
  }
  expect(median(tops)).toBeGreaterThanOrEqual(384);
}, 240000);
