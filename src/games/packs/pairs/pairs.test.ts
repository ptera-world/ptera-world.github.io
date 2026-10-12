import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { applyStep, firstStep } from "../../core/techniques";
import { failed, layoutFormat, pairs, reduce, revealFlips, type PairsPuzzle, type PairsState } from "./logic";
import { knownSet, pairsTechniques, twin } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(pairs, params, seed, sig()) as Promise<PairsPuzzle>;
const flip = (p: PairsPuzzle, s: PairsState, ...cells: number[]) => cells.reduce((st, cell) => reduce(p, st, { type: "flip", cell }), s);

/** 0 0 1 / 1 2 2 */
const small: PairsPuzzle = { w: 3, h: 2, set: 2, faces: [0, 0, 1, 1, 2, 2] };

test("generation is deterministic, every kind appears set times, leftovers are empty", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  expect(await gen({}, "a")).not.toEqual(await gen({}, "b"));
  for (const [w, h, set] of [[4, 4, "2"], [5, 5, "2"], [6, 4, "3"], [5, 4, "3"], [7, 7, "2"], [7, 7, "3"]] as const) {
    const p = await gen({ width: w, height: h, set }, `g${w}${h}${set}`);
    const n = Number(set);
    expect(p.faces.length).toBe(w * h);
    expect(p.faces.filter((k) => k < 0).length).toBe((w * h) % n);
    const count = new Map<number, number>();
    for (const k of p.faces) if (k >= 0) count.set(k, (count.get(k) ?? 0) + 1);
    expect([...count.values()].every((c) => c === n)).toBe(true);
    expect(count.size).toBeLessThanOrEqual(24);
  }
});

test("a match leaves the table; a miss stays until the next flip hides it", () => {
  let s = pairs.init(small);
  s = flip(small, s, 0);
  expect(s.up).toEqual([0]);
  expect(flip(small, s, 0)).toBe(s);
  const hit = flip(small, s, 1);
  expect(hit.up).toEqual([]);
  expect(hit.done).toEqual([1, 1, 0, 0, 0, 0]);
  const miss = flip(small, hit, 2, 4);
  expect(failed(small, miss)).toBe(true);
  expect(miss.up).toEqual([2, 4]);
  const next = flip(small, miss, 5);
  expect(next.up).toEqual([5]);
  expect(next.seen).toEqual([1, 1, 1, 0, 1, 1]);
  expect(flip(small, hit, 0)).toBe(hit);
  expect(reduce(small, pairs.init(small), { type: "flip", cell: 6 })).toEqual(pairs.init(small));
});

test("triples stop as soon as a card differs", () => {
  const p: PairsPuzzle = { w: 3, h: 2, set: 3, faces: [0, 1, 0, 1, 0, 1] };
  let s = flip(p, pairs.init(p), 0, 1);
  expect(failed(p, s)).toBe(true);
  s = flip(p, s, 0, 2);
  expect(s.up).toEqual([0, 2]);
  s = flip(p, s, 4);
  expect(s.done).toEqual([1, 0, 1, 0, 1, 0]);
});

test("revealing plays out to a solved board from any position, without ending in both outcomes", async () => {
  for (const set of ["2", "3"]) {
    const p = await gen({ width: 5, height: 4, set }, `r${set}`);
    for (const start of [[], [0], [0, 1, 2]]) {
      const session = new Session(pairs, p, { kind: "imported" });
      for (const cell of start) session.dispatch({ type: "flip", cell });
      expect(session.reveal()).toBe(true);
      expect(session.outcome).toBe("revealed");
      expect(pairs.isSolved(p, session.state)).toBe(true);
    }
  }
  const p = await gen({}, "play");
  const s = new Session(pairs, p, { kind: "imported" });
  for (const a of revealFlips(p, s.state)) s.dispatch(a);
  expect(s.outcome).toBe("solved");
});

test("techniques name only cards the player has already seen", () => {
  const fresh = pairs.init(small);
  expect(firstStep(pairs, pairsTechniques, small, fresh)).toBeNull();
  // saw 0 (kind 0), 2 (kind 1), 3 (kind 1) in separate turns
  let s = flip(small, fresh, 2, 4);
  s = flip(small, s, 3);
  const hit = firstStep(pairs, pairsTechniques, small, s)!;
  expect(hit.technique.id).toBe("pairs.twin");
  expect((hit.step.actions as unknown as { cell: number }[]).map((a) => a.cell)).toEqual([2]);
  expect(JSON.stringify(hit.step)).not.toContain("circle");
  s = flip(small, s, 2);
  expect(s.done[2]).toBe(1);
  // mid-turn on a card whose twin is unseen: nothing to say
  let q = flip(small, pairs.init(small), 0);
  q = flip(small, q, 1);
  q = flip(small, q, 4);
  expect(firstStep(pairs, [twin], small, q)).toBeNull();
  // a whole kind seen over earlier turns
  let r = flip(small, pairs.init(small), 4, 0);
  r = flip(small, r, 5, 3);
  expect(firstStep(pairs, [knownSet], small, r)?.step.actions.map((a) => (a as unknown as { cell: number }).cell)).toEqual([4, 5]);
});

test("technique steps are legal and finish games on generated boards", async () => {
  for (const set of ["2", "3"]) {
    const p = await gen({ width: 6, height: 4, set }, `t${set}`);
    let s = pairs.init(p);
    for (let i = 0; i < 400 && !pairs.isSolved(p, s); i++) {
      const hit = firstStep(pairs, pairsTechniques, p, s);
      const open = (c: number) => p.faces[c]! >= 0 && !s.done[c] && !(s.up.includes(c) && !failed(p, s));
      const cell = hit ? null : p.faces.findIndex((_, c) => open(c) && !s.seen[c]) >= 0 ? p.faces.findIndex((_, c) => open(c) && !s.seen[c]) : p.faces.findIndex((_, c) => open(c));
      s = hit ? applyStep(pairs, p, s, hit.step) : flip(p, s, cell!);
    }
    expect(pairs.isSolved(p, s)).toBe(true);
  }
});

test("layouts round-trip and reject mistakes", async () => {
  const p = await gen({ width: 5, height: 5 }, "fmt");
  const text = layoutFormat.serialize!(p);
  expect(layoutFormat.detect!(text)).toBe(true);
  expect(layoutFormat.parse(text)).toEqual(p);
  expect(() => layoutFormat.parse("2x2, 2\n0 0\n1 2")).toThrow("kind 1");
  expect(() => layoutFormat.parse("2x2, 2\n0 0")).toThrow("rows");
});
