import type { Step } from "../../core/types";
import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { mines, numbers, type MinesPuzzle } from "./logic";
import { Registry } from "../../core/registry";
import { TechniqueHost, applyStep, firstStep, isPartOfStep, rateByTechniques } from "../../core/techniques";
import { autoChord, checkFlags } from "./plugins";
import { minesHint, minesTechniques, satisfied } from "./techniques";
import { obfuscateBitmap, sha1 } from "../../lib/sha1";
import {
  MINE, UNKNOWN, countCompletions, deduceAt, deduceCount, deduceGlobal, deducePairs, neighbourTable,
  solveLayout, startKnowledge, type Deduction,
} from "./solver";

const sig = () => new AbortController().signal;
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

test("sha1 test vectors", () => {
  expect(hex(sha1(new TextEncoder().encode("abc")))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  expect(hex(sha1(new Uint8Array(0)))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  const long = new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq");
  expect(hex(sha1(long))).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
});

test("bitmap obfuscation round-trips and keeps pad bits clear", () => {
  for (const bits of [1, 7, 8, 9, 81, 480, 1001]) {
    const r = createRng(`b${bits}`);
    const orig = new Uint8Array((bits + 7) >> 3).map(() => r.int(256));
    if (bits % 8) orig[bits >> 3] = orig[bits >> 3]! & (0xff00 >> (bits % 8));
    const b = orig.slice();
    obfuscateBitmap(b, bits, false);
    if (bits > 16) expect(hex(b)).not.toBe(hex(orig));
    obfuscateBitmap(b, bits, true);
    expect(hex(b)).toBe(hex(orig));
  }
});

test("generation is deterministic", async () => {
  const a = await generate(mines, { width: 16, height: 16, mines: 40 }, "seed", sig());
  const b = await generate(mines, { width: 16, height: 16, mines: 40 }, "seed", sig());
  const c = await generate(mines, { width: 16, height: 16, mines: 40 }, "other", sig());
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

test("no-guess boards are fully solvable by logic at their difficulty, with a clear start", async () => {
  const cases = [
    { width: 9, height: 9, mines: 10, difficulty: "easy" },
    { width: 16, height: 16, mines: 40, difficulty: "normal" },
    { width: 30, height: 16, mines: 99, difficulty: "hard" },
    { width: 12, height: 12, mines: 36, difficulty: "normal" },
  ];
  for (const params of cases) {
    for (const seed of ["a", "b", "c"]) {
      const p = (await generate(mines, params, seed, sig())) as MinesPuzzle;
      expect(p.mines.reduce((x, y) => x + y, 0)).toBe(params.mines);
      expect(p.start).not.toBeNull();
      expect(numbers(p)[p.start!]).toBe(0);
      const level = ({ easy: 1, normal: 2, hard: 3 } as const)[params.difficulty as "easy"];
      const res = solveLayout(p.w, p.h, p.mines, startKnowledge(p.w, p.h, p.mines, p.start), level);
      expect(res.complete).toBe(true);
    }
  }
});

test("every deduction holds in every consistent layout (brute force)", () => {
  const w = 5, h = 5, n = 25;
  const nb = neighbourTable(w, h);
  let checked = 0;
  for (let i = 0; i < 300; i++) {
    const r = createRng(`sound${i}`);
    const layout: number[] = Array.from({ length: n }, () => (r.bool(0.25) ? 1 : 0));
    const total = layout.reduce((a, b) => a + b, 0);
    const nums = numbers({ w, h, mines: layout, start: null });
    const K = new Int8Array(n).fill(UNKNOWN);
    for (let c = 0; c < n; c++) if (!layout[c] && r.bool(0.45)) K[c] = nums[c]!;
    const all: Deduction[] = [];
    for (let c = 0; c < n; c++) {
      const d = deduceAt(K, nb, c);
      if (d) all.push(d);
    }
    const g = deduceCount(K, total);
    if (g) all.push(g);
    all.push(...deducePairs(K, w, h, nb));
    const d3 = deduceGlobal(K, nb, total);
    if (d3) all.push(d3);
    for (const d of all) {
      for (const [cells, flipTo] of [[d.safe, MINE], [d.mines, 10]] as const) {
        for (const c of cells) {
          const K2 = Int8Array.from(K);
          K2[c] = flipTo;
          expect(countCompletions(K2, nb, total, 1)).toBe(0);
          checked++;
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(200);
});

/** A session with the pack's techniques attached the way the shell does it. */
function played(p: MinesPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of minesTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session({ ...mines, hint: minesHint }, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkFlags.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("following hints clears a generated board; wrong flags come first", async () => {
  for (const seed of ["h1", "h2"]) {
    const p = (await generate(mines, { width: 16, height: 16, mines: 40, difficulty: "hard" }, seed, sig())) as MinesPuzzle;
    const { s } = played(p);
    const wrongFlag = p.mines.findIndex((m, c) => !m && !s.state.open[c]);
    s.dispatch({ type: "flag", cells: [wrongFlag], on: true });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "flag", cells: [wrongFlag], on: false });
    for (let i = 0; i < 2000 && !s.solved; i++) {
      const hnt = s.hint();
      expect(hnt?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of hnt!.actions!) s.dispatch(a); });
      expect(s.state.dead).toBe(-1);
    }
    expect(s.solved).toBe(true);
  }
});

test("techniques alone solve no-guess boards at every difficulty, and never touch a mine", async () => {
  for (const difficulty of ["easy", "normal", "hard"]) {
    const p = (await generate(mines, { width: 12, height: 12, mines: 26, difficulty }, "t-" + difficulty, sig())) as MinesPuzzle;
    const r = rateByTechniques(mines, minesTechniques, p);
    if (difficulty !== "hard") expect(r).not.toBeNull();
    let s = mines.init(p);
    for (let i = 0; i < 3000 && !mines.isSolved(p, s); i++) {
      const hit = firstStep(mines, minesTechniques, p, s);
      const step = hit ? hit.step : minesHint(p, s)!.more! as Step;
      s = applyStep(mines, p, s, step);
      expect(s.dead).toBe(-1);
      expect(s.flags.every((f, c) => !f || p.mines[c])).toBe(true);
    }
  }
});

test("auto techniques cascade inside the move that triggered them, as one undo step", () => {
  const p = mines.formats[1]!.parse(".*..\n....\n....\n...S");
  const { s } = played(p, ["mines.forced", "mines.satisfied"]);
  s.dispatch({ type: "open", cells: [0] });
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.open[0]).toBe(0);
});

test("unflagging is a retraction: auto-flag doesn't put it straight back", () => {
  const p = mines.formats[1]!.parse(".*..\n....\n....\n...S");
  const { s } = played(p, ["mines.forced"]);
  s.dispatch({ type: "open", cells: [0] });
  expect(s.state.flags[1]).toBe(1);
  s.dispatch({ type: "flag", cells: [1], on: false });
  expect(s.state.flags[1]).toBe(0);
});

test("practice: carrying out part of a step counts, anything else doesn't", () => {
  const p = mines.formats[1]!.parse("*...\n....\n....\n...S");
  const s = mines.init(p);
  const hit = firstStep(mines, minesTechniques, p, s)!;
  expect(hit.technique.id).toBe("mines.forced");
  const flag = mines.reduce(p, s, { type: "flag", cells: [0], on: true });
  expect(isPartOfStep(mines, p, s, flag, [hit.step])).toBe(true);
  const other = mines.reduce(p, s, { type: "flag", cells: [2], on: true });
  expect(isPartOfStep(mines, p, s, other, [hit.step])).toBe(false);
});

test("reducer: flag, chord, death and undo", () => {
  const p = mines.formats[1]!.parse("*..\n...\n..S");
  const s = new Session(mines, p, { kind: "imported" });
  expect(s.state.open.filter(Boolean).length).toBe(8);
  expect(mines.isSolved(p, s.state)).toBe(true);

  const q = mines.formats[1]!.parse("*.*.\n....\n....\n...S");
  const t = new Session(mines, q, { kind: "imported" });
  expect(t.state.open[1]).toBe(0);
  t.dispatch({ type: "flag", cells: [0] });
  t.dispatch({ type: "chord", cell: 4 });
  expect(t.state.open[1]).toBe(1);
  t.dispatch({ type: "open", cells: [2] });
  expect(t.state.dead).toBe(2);
  expect(t.dispatch({ type: "open", cells: [3] })).toBe(false);
  t.undo();
  expect(t.state.dead).toBe(-1);
});

test("formats round-trip; sgt ids decode masked and unmasked", async () => {
  const p = (await generate(mines, { width: 30, height: 16, mines: 99 }, "fmt", sig())) as MinesPuzzle;
  for (const f of mines.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  const unmasked = mines.formats[0]!.parse("4x2:0,0,u0c");
  expect(unmasked.mines).toEqual([0, 0, 0, 0, 1, 1, 0, 0]);
  expect(unmasked.start).toBe(0);
  expect(() => mines.formats[0]!.parse("9x9:r10,u,abcd")).toThrow();
  // ids produced by sgt's own obfuscate_bitmap (compiled from its C source) for mines at (i*7+3)%5==0
  const refs = [
    "30x16:4,5,ma07a7d78891ff2b662aaa0a2341605ee35fcc26a0d2f245d18826e940930fa8821728840c96fbbfbbc8e7cbdc428f757f50e3d46d5cdfc0123f2e062",
    "9x9:4,5,m9c771c00dc8540692aae0",
  ];
  for (const id of refs) {
    const q = mines.formats[0]!.parse(id);
    expect(q.mines).toEqual(q.mines.map((_, i) => ((i * 7 + 3) % 5 === 0 ? 1 : 0)));
    expect(q.start).toBe(5 * q.w + 4);
    expect(mines.formats[0]!.serialize!(q).replace(/n\d+/, "")).toBe(id);
  }
});

test("auto-chord opens around a number in the same step as the flag that finishes it", () => {
  // 1 mine in the corner; the 1s around it chord once it is flagged
  const p: MinesPuzzle = { w: 4, h: 4, mines: [1, ...Array(15).fill(0)], start: null };
  const s = new Session(mines, p, { kind: "imported" });
  autoChord.setup!({ session: s, settings: {}, owner: "auto" });
  s.dispatch({ type: "open", cells: [1] });
  expect(s.state.open.reduce((a, b) => a + b, 0)).toBe(1);
  s.dispatch({ type: "flag", cells: [0], on: true });
  expect(s.state.open[2]).toBe(1);
  expect(s.state.open[5]).toBe(1);
  s.undo();
  expect(s.state.open.reduce((a, b) => a + b, 0)).toBe(1);
  expect(s.state.flags[0]).toBe(0);
});

test("satisfied number aims at the pointed number or a cell it decides", () => {
  const p: MinesPuzzle = { w: 4, h: 4, mines: [1, ...Array(15).fill(0)], start: null };
  const st = { ...mines.init(p), open: Object.assign(Array(16).fill(0), { 1: 1, 4: 1 }), flags: Object.assign(Array(16).fill(0), { 0: 1 }) };
  const at = (t: unknown) => satisfied.findAt!(p, st, t)?.focus as { sources: number[] } | undefined;
  expect(at(4)?.sources).toEqual([4]);
  expect(at(1)?.sources).toEqual([1]);
  expect(at(15)).toBeUndefined();
});
