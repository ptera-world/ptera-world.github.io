import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { applyStep, findPracticePosition, findStep, firstStep } from "../../core/techniques";
import { cardCode, msDeal, parseCards } from "../../lib/cards/deck";
import { fcSolveFormat, freecell, msFormat, startPos, type FreecellPuzzle } from "./logic";
import { solve } from "./solver";
import { freecellTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(freecell, params, seed, sig()) as Promise<FreecellPuzzle>;

const rows = (n: number) => {
  const d = msDeal(n);
  return Array.from({ length: 7 }, (_, r) => d.slice(r * 8, r * 8 + 8).map(cardCode).join(" ")).join("\n");
};

test("microsoft deals match the published layouts", () => {
  expect(rows(1)).toBe("JD 2D 9H JC 5D 7H 7C 5H\nKD KC 9S 5S AD QC KH 3H\n2S KS 9D QD JS AS AH 3C\n4C 5C TS QH 4H AC 4D 7S\n3S TD 4S TH 8H 2C JH 7D\n6D 8S 8D QS 6C 3D 8C TC\n6S 9C 2H 6H");
  expect(rows(617)).toBe("7D AD 5C 3S 5S 8C 2D AH\nTD 7S QD AC 6D 8H AS KH\nTH QC 3H 9D 6S 8D 3D TC\nKD 5H 9S 3C 8S 7H 4D JS\n4C QS 9C 9H 7C 6H 2C 2S\n4S TS 2H 5D JC 6C JH QH\nJD KS KC 4H");
  const p = msFormat.parse("#617");
  expect(p.cols[0]).toEqual(parseCards("7D TD TH KD 4C 4S JD"));
});

test("generation is deterministic and its stored win plays out legally", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  expect(await gen({}, "a")).not.toEqual(await gen({}, "b"));
  for (const pr of freecell.presets!) {
    const p = await gen(pr.params, "w");
    let s = freecell.init(p);
    for (const m of p.solution!) {
      const next = freecell.reduce(p, s, { type: "move", ...m });
      expect(next).not.toBe(s);
      s = next;
    }
    expect(freecell.isSolved(p, s)).toBe(true);
  }
}, 60000);

test("the solver wins deal 1 and proves a two-cell deal hopeless", () => {
  const one = msFormat.parse("1");
  const r = solve(startPos(one));
  expect(r.path?.length).toBeGreaterThan(50);
  const two = { ...msFormat.parse("92"), cells: [-1, -1] };
  expect(solve(startPos(two)).impossible).toBe(true);
});

test("moves follow the rules: alternating builds, cell and run limits", () => {
  const p = msFormat.parse("1");
  const s = freecell.init(p);
  // column 1 top is 6S, column 4 top is 6H: same rank, no build
  expect(freecell.reduce(p, s, { type: "move", from: 8, to: 11, n: 1 })).toBe(s);
  // 2 cards that are not a run can't move together
  expect(freecell.reduce(p, s, { type: "move", from: 8, to: 0, n: 2 })).toBe(s);
  const parked = freecell.reduce(p, s, { type: "move", from: 8, to: 0, n: 1 });
  expect(parked.piles[0]!.c).toEqual(parseCards("6S"));
  expect(freecell.reduce(p, parked, { type: "move", from: 9, to: 0, n: 1 })).toBe(parked);
});

test("technique steps keep applying, also after wandering off the stored line", async () => {
  const p = await gen({}, "h");
  const session = new Session(freecell, p, { kind: "imported" });
  // a legal move off the stored line
  const off = Array.from({ length: 8 }, (_, j) => j + 8).find((from) => session.dispatch({ type: "move", from, to: 0, n: 1 }));
  expect(off).toBeDefined();
  for (let i = 0; i < 400; i++) {
    const hit = firstStep(freecell, freecellTechniques, p, session.state);
    if (!hit) break;
    session.batch(() => { for (const a of hit.step.actions) session.dispatch(a as never); });
  }
}, 30000);

test("technique steps are legal on every preset; practice positions exist", async () => {
  for (const pr of freecell.presets!) {
    const p = await gen(pr.params, "t");
    let s = freecell.init(p);
    for (let i = 0; i < 400 && !freecell.isSolved(p, s); i++) {
      const hit = firstStep(freecell, freecellTechniques, p, s);
      if (!hit) break;
      const next = applyStep(freecell, p, s, hit.step);
      expect(next).not.toBe(s);
      s = next;
    }
  }
  for (const t of freecellTechniques) {
    const pos = await findPracticePosition(freecell, freecellTechniques, t, "x", sig());
    const step = pos && findStep(freecell, t, pos.puzzle, pos.state);
    expect(step?.actions.length).toBe(1);
  }
}, 60000);

test("board text round-trips and reads Freecell Solver layouts", async () => {
  const p = await gen({ cells: 3 }, "fmt");
  const { solution: _, ...bare } = p;
  const text = fcSolveFormat.serialize!(p);
  expect(fcSolveFormat.detect!(text)).toBe(true);
  expect(fcSolveFormat.parse(text)).toEqual(bare);
  const q = fcSolveFormat.parse("4C 2C 9C 8C QS 4S 2H\n5H QH 3C AC 3H 4H QD\nQC 9S 6H 9H 3S KS 3D\n5D 2S JC 5C JH 6D AS\n2D KD TH TC TD 8D\n7H JS KH TS KC 7C\nAH 5S 6S AD 8H JD\n7S 6C 7D 4D 8S 9D");
  expect(q.cols.length).toBe(8);
  expect(q.cells).toEqual([-1, -1, -1, -1]);
  const r = fcSolveFormat.parse("Foundations: H-2 C-A S-0 D-0\nFreecells: KS -\n" + "AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD\n2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC\n3H 4H 5H 6H 7H 8H 9H TH JH QH KH\nAS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS");
  expect(r.found).toEqual([1, 0, 2, 0]);
  expect(r.cells.length).toBe(2);
  expect(() => fcSolveFormat.parse("AS AS\nKD\nQD\nJD")).toThrow("twice");
});

test("a deal number gives Microsoft's cards whatever the seed, with the cells asked for", async () => {
  const a = await gen({ deal: 617 }, "one");
  const b = await gen({ deal: 617, cells: 3 }, "two");
  expect(a.cols).toEqual(msFormat.parse("617").cols);
  expect(b.cols).toEqual(a.cols);
  expect(a.deal).toBe(617);
  expect(b.cells.length).toBe(3);
  expect(a.solution?.length).toBeGreaterThan(0);
}, 60000);
