import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { applyStep, findStep, firstStep } from "../../core/techniques";
import { allCodes, candidates, ELSEWHERE, EXACT, guess, mark, markPegs, MISS, sgtFormat, type GuessPuzzle, type GuessState } from "./logic";
import { checkRow } from "./plugins";
import { guessTechniques, knownPeg, lastCode } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(guess, params, seed, sig()) as Promise<GuessPuzzle>;

test("generation is deterministic per (params, seed) and follows the rules", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  for (let i = 0; i < 20; i++) {
    const p = await gen({ colours: 6, pegs: 4, duplicates: false }, `n${i}`);
    expect(new Set(p.code).size).toBe(4);
    expect(p.code.every((c) => c >= 1 && c <= 6)).toBe(true);
  }
});

test("marks count right place, then right color elsewhere", () => {
  expect(mark([1, 2, 3, 4], [1, 2, 3, 4], 6)).toEqual({ black: 4, white: 0 });
  expect(mark([1, 1, 2, 2], [2, 2, 1, 1], 6)).toEqual({ black: 0, white: 4 });
  expect(mark([1, 1, 1, 1], [1, 2, 3, 4], 6)).toEqual({ black: 1, white: 0 });
  expect(mark([0, 2, 0, 0], [2, 2, 1, 1], 6)).toEqual({ black: 1, white: 0 });
  expect(mark([3, 1, 0, 0], [1, 3, 1, 3], 6)).toEqual({ black: 0, white: 2 });
});

test("submitting marks the guess, keeps held pegs, and ends the game", () => {
  const p: GuessPuzzle = { colours: 4, pegs: 3, guesses: 2, blanks: false, duplicates: true, code: [1, 2, 3] };
  let s = guess.init(p);
  s = guess.reduce(p, s, { type: "row", code: [1, 3, 0] });
  expect(guess.reduce(p, s, { type: "submit" })).toBe(s);
  s = guess.reduce(p, s, { type: "peg", index: 2, colour: 4 });
  s = guess.reduce(p, s, { type: "hold", index: 0 });
  s = guess.reduce(p, s, { type: "submit" });
  expect(s.done[0]).toEqual({ code: [1, 3, 4], black: 1, white: 1 });
  expect(s.row).toEqual([1, 0, 0]);
  s = guess.reduce(p, s, { type: "row", code: [1, 1, 1] });
  s = guess.reduce(p, s, { type: "submit" });
  expect(guess.isLost!(p, s)).toBe(true);
  expect(guess.reduce(p, s, { type: "peg", index: 1, colour: 2 })).toBe(s);
});

test("candidates are exactly the codes consistent with every mark", async () => {
  const rng = createRng("c");
  for (let t = 0; t < 10; t++) {
    const p = await gen({ colours: 5, pegs: 4 }, `c${t}`);
    let s: GuessState = guess.init(p);
    for (let k = 0; k < 3; k++) {
      s = guess.reduce(p, s, { type: "row", code: Array.from({ length: 4 }, () => rng.range(1, 5)) });
      s = guess.reduce(p, s, { type: "submit" });
    }
    const cand = candidates(p, s);
    expect(cand.some((c) => c.join() === p.code.join())).toBe(true);
    for (const c of allCodes(p)) {
      const fits = s.done.every((g) => { const m = mark(g.code, c, p.colours); return m.black === g.black && m.white === g.white; });
      expect(cand.some((x) => x.join() === c.join())).toBe(fits);
    }
  }
});

test("technique steps keep a game going without ending it wrongly", async () => {
  for (let t = 0; t < 12; t++) {
    const p = await gen({}, `play${t}`);
    let s = guess.init(p);
    for (let i = 0; i < 40 && !guess.isSolved(p, s); i++) {
      const hit = firstStep(guess, guessTechniques, p, s);
      if (!hit) break;
      s = applyStep(guess, p, s, hit.step);
    }
    expect(s.done.length).toBeLessThanOrEqual(6);
  }
}, 60000);

test("a full guess that can't be the code is pointed out before any technique", async () => {
  const p: GuessPuzzle = { colours: 6, pegs: 4, guesses: 10, blanks: false, duplicates: true, code: [1, 2, 3, 4] };
  const s = new Session(guess, p, { kind: "imported" });
  checkRow.setup!({ session: s, settings: {}, owner: "check" });
  s.dispatch({ type: "row", code: [5, 5, 6, 6] });
  s.dispatch({ type: "submit" });
  s.dispatch({ type: "row", code: [5, 1, 2, 3] });
  expect(s.hint()?.message).toContain("can't be the code");
});

test("techniques reason only from the marks", async () => {
  let seenKnown = 0;
  for (let t = 0; t < 30; t++) {
    const p = await gen({ colours: 4, pegs: 3 }, `k${t}`);
    const rng = createRng(`k${t}`);
    let s = guess.init(p);
    for (let k = 0; k < 4 && !guess.isSolved(p, s); k++) {
      const cand = candidates(p, s);
      const step = findStep(guess, knownPeg, p, s);
      if (step) {
        seenKnown++;
        for (const a of step.actions as unknown as { index: number; colour: number }[]) expect(cand.every((c) => c[a.index] === a.colour)).toBe(true);
        for (const a of step.actions as unknown as { index: number }[]) expect(knownPeg.findAt!(p, s, { slot: a.index })).not.toBeNull();
      }
      const last = findStep(guess, lastCode, p, s);
      expect(last !== null).toBe(cand.length === 1 && s.done.length > 0);
      if (last) expect(last.actions[0] as unknown).toEqual({ type: "row", code: p.code });
      s = guess.reduce(p, s, { type: "row", code: Array.from({ length: 3 }, () => rng.range(1, 4)) });
      s = guess.reduce(p, s, { type: "submit" });
    }
  }
  expect(seenKnown).toBeGreaterThan(3);
});

test("game ids round-trip and use the original's hidden form", async () => {
  const p = await gen({ colours: 8, pegs: 5, guesses: 12, blanks: true, duplicates: false }, "fmt");
  const text = sgtFormat.serialize!(p);
  expect(text.startsWith("c8p5g12bM:")).toBe(true);
  expect(text).not.toContain(p.code.map((c) => c.toString(16).padStart(2, "0")).join(""));
  expect(sgtFormat.parse(text)).toEqual(p);
  expect(() => sgtFormat.parse("c6p4g10Bm:00")).toThrow();
});

test("per-peg marks agree with the counts and say which pegs they belong to", () => {
  expect(markPegs([1, 2, 3, 4], [1, 2, 3, 4], 6)).toEqual([EXACT, EXACT, EXACT, EXACT]);
  expect(markPegs([1, 1, 2, 2], [2, 2, 1, 1], 6)).toEqual([ELSEWHERE, ELSEWHERE, ELSEWHERE, ELSEWHERE]);
  expect(markPegs([1, 1, 1, 1], [1, 2, 3, 4], 6)).toEqual([EXACT, MISS, MISS, MISS]);
  expect(markPegs([3, 1, 0, 0], [1, 3, 1, 3], 6)).toEqual([ELSEWHERE, ELSEWHERE, MISS, MISS]);
  const rng = createRng("pp");
  for (let i = 0; i < 200; i++) {
    const g = Array.from({ length: 4 }, () => rng.range(0, 5)), c = Array.from({ length: 4 }, () => rng.range(1, 5));
    const m = mark(g, c, 5), pegs = markPegs(g, c, 5);
    expect(pegs.filter((v) => v === EXACT).length).toBe(m.black);
    expect(pegs.filter((v) => v === ELSEWHERE).length).toBe(m.white);
  }
});

test("per-peg games store the marks, narrow the candidates by them, and keep techniques sound", async () => {
  const preset = guess.presets!.find((q) => q.params.feedback === "pegs")!.params;
  let sawOne = 0;
  for (let t = 0; t < 12; t++) {
    const p = await gen(preset, `pp${t}`);
    expect(p.feedback).toBe("pegs");
    let s: GuessState = guess.init(p);
    const rng = createRng(`pp${t}`);
    for (let k = 0; k < 3 && !guess.isSolved(p, s); k++) {
      s = guess.reduce(p, s, { type: "row", code: [1, 2, 3, 4].map(() => rng.range(1, p.colours)) });
      s = guess.reduce(p, s, { type: "submit" });
      const last = s.done[s.done.length - 1];
      if (last) expect(last.pegs).toEqual(markPegs(last.code, p.code, p.colours));
    }
    const cand = candidates(p, s);
    expect(cand.some((c) => c.join() === p.code.join())).toBe(true);
    for (const c of allCodes(p)) {
      const fitsAll = s.done.every((g) => markPegs(g.code, c, p.colours).join() === g.pegs!.join());
      expect(cand.some((x) => x.join() === c.join())).toBe(fitsAll);
    }
    if (cand.length === 1) sawOne++;
  }
  expect(sawOne).toBeGreaterThan(0);
  const p = await gen({ ...preset, colours: 4 }, "ids");
  const text = sgtFormat.serialize!(p);
  expect(text).toContain("Mf:");
  expect(sgtFormat.parse(text)).toEqual(p);
});
