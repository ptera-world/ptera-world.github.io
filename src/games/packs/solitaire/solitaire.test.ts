import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { applyStep, findPracticePosition, findStep, firstStep } from "../../core/techniques";
import { cardCode, msDeal, parseCards, suitOf } from "../../lib/cards/deck";
import { ctxOf, idxOf, startPos, type SolitairePuzzle, type SolitaireState } from "./deal";
import { solve } from "./engine";
import { fcsFormat, klondikeFormat, msFormat, spiderFormat, tableFormat } from "./formats";
import { actionsOf, scoreLine, solitaire, variantOf } from "./logic";
import { bankPlugin, gain, timeAdjust } from "./score";
import { bankKey } from "./logic";
import { techniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(solitaire, params, seed, sig()) as Promise<SolitairePuzzle>;
const preset = (label: string) => {
  const pr = solitaire.presets!.find((x) => x.label === label);
  if (!pr) throw new Error(`no preset ${label}`);
  return pr.params;
};

function playOut(p: SolitairePuzzle): SolitaireState {
  let s = solitaire.init(p);
  for (const m of p.solution!) for (const a of actionsOf(m)) {
    const next = solitaire.reduce(p, s, a);
    expect(next).not.toBe(s);
    s = next;
  }
  return s;
}

// --- the merge: every setup the separate games had is a preset ---

/** The presets of the old klondike, spider and freecell games, as those games' settings. */
const OLD = {
  klondike: [
    { draw: 1, passes: 0, scoring: "standard", timed: false, label: "Klondike" },
    { draw: 3, passes: 0, scoring: "standard", timed: false, label: "Klondike (draw 3)" },
    { draw: 3, passes: 3, scoring: "standard", timed: false, label: "Klondike (draw 3), three passes" },
    { draw: 1, passes: 0, scoring: "standard", timed: true, label: "Klondike, timed" },
    { draw: 1, passes: 1, scoring: "vegas", timed: false, label: "Vegas Klondike" },
    { draw: 3, passes: 3, scoring: "vegas", timed: false, label: "Vegas Klondike (draw 3)" },
    { draw: 3, passes: 3, scoring: "vegas-keep", timed: false, label: "Vegas Klondike (draw 3), cumulative" },
  ],
  spider: [
    { decks: 2, suits: 1, columns: 10, deals: 5, label: "Spider (1 suit)" },
    { decks: 2, suits: 2, columns: 10, deals: 5, label: "Spider (2 suits)" },
    { decks: 2, suits: 4, columns: 10, deals: 5, label: "Spider" },
    { decks: 1, suits: 1, columns: 7, deals: 4, label: "Spider, one deck, one suit" },
    { decks: 1, suits: 2, columns: 7, deals: 4, label: "Spider, one deck, two suits" },
    { decks: 1, suits: 4, columns: 7, deals: 4, label: "Spider, one deck" },
    { decks: 3, suits: 2, columns: 13, deals: 6, label: "Big Spider (2 suits)" },
    { decks: 4, suits: 2, columns: 16, deals: 7, label: "Spider, four decks, two suits" },
  ],
  freecell: [
    { cells: 4, label: "FreeCell" },
    { cells: 3, label: "FreeCell, three free cells" },
    { cells: 2, label: "FreeCell (2 Reserves)" },
  ],
};

const suitsOf = (p: SolitairePuzzle) => new Set(p.faces.map(suitOf)).size;

test("every old klondike setup is a preset: seven columns of a triangle, 24 in the stock, its draw, passes and scoring", async () => {
  for (const o of OLD.klondike) {
    const p = await gen({ ...preset(o.label), winnable: false }, "old");
    expect([p.rules.draw, p.rules.passes, p.scoring as string, p.timed]).toEqual([o.draw, o.passes, o.scoring, o.timed]);
    expect(p.cols.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(p.down).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(p.stock.length).toBe(24);
    expect(p.rules).toMatchObject({ build: "alternate", runs: "built", empty: "kings", home: "cards", takeBack: true, stock: "waste" });
  }
});

test("every old spider setup is a preset: its decks, suits, columns and stock deals", async () => {
  for (const o of OLD.spider) {
    const p = await gen({ ...preset(o.label), winnable: false }, "old");
    expect([p.faces.length / 52, suitsOf(p), p.cols.length, p.stock.length / p.cols.length]).toEqual([o.decks, o.suits, o.columns, o.deals]);
    const lens = p.cols.map((c) => c.length);
    expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1);
    expect(p.down).toEqual(lens.map((n) => n - 1));
    expect(p.rules).toMatchObject({ build: "any", runs: "suit", empty: "any", home: "runs", stock: "row", fillFirst: true });
    expect(p.scoring).toBe("spider");
  }
});

test("every old freecell setup is a preset: eight open columns and its free cells", async () => {
  for (const o of OLD.freecell) {
    const p = await gen({ ...preset(o.label), winnable: false }, "old");
    expect(p.cells).toEqual(Array(o.cells).fill(-1));
    expect(p.cols.map((c) => c.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
    expect(p.down.every((d) => d === 0)).toBe(true);
    expect(p.stock).toEqual([]);
    expect(p.rules).toMatchObject({ build: "alternate", runs: "space", empty: "any", home: "cards", takeBack: false });
  }
});

test("every preset deals its own game: whole decks, every card once, and the header names it", async () => {
  const labels = new Set<string>();
  for (const pr of solitaire.presets!) {
    expect(labels.has(pr.label)).toBe(false);
    labels.add(pr.label);
    const p = await gen({ ...pr.params, winnable: false }, "shape");
    const ids = [...p.cols.flat(), ...p.cells.filter((x) => x >= 0), ...p.stock].sort((a, b) => a - b);
    expect(ids).toEqual(p.faces.map((_, i) => i));
    expect(p.faces.length % 52).toBe(0);
    expect(variantOf(p)).toBe(pr.label);
    const s = solitaire.init(p);
    expect(s.piles.length).toBe(idxOf(p).total);
    expect(solitaire.describe!(p)).toContain(pr.label);
  }
});

/** Setups the old games always (or, for one-suit spider, nearly always) dealt winnable, and the new ones the solver handles. */
const MUST_SOLVE = [
  ...OLD.klondike.map((o) => o.label), ...OLD.freecell.map((o) => o.label), "Spider (1 suit)", "Spider, one deck, one suit", "Spider, one deck, two suits",
  "Saratoga (Thoughtful)", "Whitehead", "Thumb and Pouch", "Double Klondike", "Gargantua", "Eastcliff", "Westcliff", "Easthaven",
  "Yukon", "Russian Solitaire", "Alaska", "Double Yukon", "Double Russian Solitaire", "Triple Yukon", "Quadruple Yukon", "Big Spider (1 suit)",
  "Scorpion", "Scorpion II", "Wasp", "Relaxed FreeCell", "ForeCell", "Seven by Four", "Seven by Five", "Bath", "Double FreeCell (Traditional)",
  "Triple FreeCell", "Baker's Game", "King Only Baker's Game", "Eight Off", "Seahaven Towers", "Relaxed Seahaven Towers",
];

test("every preset deals with the solver, and every win it finds plays out to a solved table", async () => {
  for (const pr of solitaire.presets!) {
    const p = await gen(pr.params, "w");
    if (MUST_SOLVE.includes(pr.label)) expect(p.solution, pr.label).toBeDefined();
    if (p.solution) expect(solitaire.isSolved(p, playOut(p)), pr.label).toBe(true);
    else expect(solitaire.describe!(p)).toContain(p.rules.home === "runs" ? "not known winnable" : pr.label);
  }
}, 600_000);

test("generation is deterministic", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  expect(await gen({}, "a")).not.toEqual(await gen({}, "b"));
}, 60_000);

test("the table format writes and reads back every preset", async () => {
  for (const pr of solitaire.presets!) {
    const p = await gen({ ...pr.params, winnable: false }, "fmt");
    const text = tableFormat.serialize!(p);
    expect(tableFormat.detect!(text)).toBe(true);
    const q = tableFormat.parse(text);
    expect(tableFormat.serialize!(q)).toBe(text);
    expect(variantOf(q)).toBe(pr.label);
  }
  expect(() => tableFormat.parse("rules: build sideways\nAS")).toThrow("not a rule");
});

// --- klondike ---

const ordered = (head: string) => klondikeFormat.parse(`${head}\nAC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS KS`);
// piles of a Klondike deal: 0 stock, 1 waste, 2–5 foundations, 6–12 columns
const COLS = 6, FOUND = 2;

test("klondike: the deal, drawing three, and limited passes", () => {
  const p = ordered("draw 3, passes 2");
  const s = solitaire.init(p);
  expect(s.piles[6]!.c).toEqual(parseCards("AC"));
  expect(s.piles[12]!.c).toEqual(parseCards("7C KC 5D 9D QD AH 2H"));
  expect(s.piles[12]!.d).toBe(6);
  expect(s.piles[0]!.c.length).toBe(24);
  let t = solitaire.reduce(p, s, { type: "draw" });
  expect(t.piles[1]!.c).toEqual(parseCards("3H 4H 5H"));
  for (let i = 0; i < 7; i++) t = solitaire.reduce(p, t, { type: "draw" });
  expect(t.piles[0]!.c.length).toBe(0);
  t = solitaire.reduce(p, t, { type: "draw" });
  expect(t.recycles).toBe(1);
  for (let i = 0; i < 8; i++) t = solitaire.reduce(p, t, { type: "draw" });
  expect(solitaire.reduce(p, t, { type: "draw" })).toBe(t);
});

test("klondike: moves follow the rules", () => {
  const p = ordered("draw 3, passes 2");
  const s = solitaire.init(p);
  const home = solitaire.reduce(p, s, { type: "move", from: 6, to: 2, n: 1 });
  expect(home.piles[2]!.c).toEqual(parseCards("AC"));
  expect(solitaire.reduce(p, s, { type: "move", from: 6, to: 5, n: 1 })).toBe(s);
  // only a king goes into an empty column
  expect(solitaire.reduce(p, home, { type: "move", from: 7, to: 6, n: 1 })).toBe(home);
  // a face-down card can't move
  expect(solitaire.reduce(p, s, { type: "move", from: 7, to: 2, n: 2 })).toBe(s);
});

test("klondike deal text round-trips, and refuses deals that aren't klondike", async () => {
  const p = await gen({ ...preset("Klondike (draw 3), three passes") }, "fmt");
  const { solution: _, ...bare } = p;
  const text = klondikeFormat.serialize!(p);
  expect(klondikeFormat.detect!(text)).toBe(true);
  expect(klondikeFormat.parse(text)).toEqual(bare);
  expect(() => klondikeFormat.parse("AS AS")).toThrow("52");
  expect(() => klondikeFormat.serialize!(msFormat.parse("1"))).toThrow("Klondike");
});

test("standard scoring: points for what is played, never below zero", () => {
  const p = ordered("draw 1, passes 0, scoring standard");
  const c = ctxOf(p);
  let s = solitaire.init(p);
  expect(s.score).toBe(0);
  s = solitaire.reduce(p, s, { type: "move", from: COLS, to: FOUND, n: 1 });
  expect(s.score).toBe(10);
  s = solitaire.reduce(p, s, { type: "draw" });
  expect(s.score).toBe(10);
  const before = { stock: [], waste: [1], cells: [], found: [[], [], [], []], cols: [[5], [6]], down: [0, 0], recycles: 0 };
  expect(gain(c, "standard", before, { ...before, waste: [], cols: [[5], [6, 1]] }, { from: 1, to: COLS + 1, n: 1 })).toBe(5);
  expect(gain(c, "standard", before, { ...before, stock: [1], waste: [], recycles: 1 }, null)).toBe(-100);
  expect(gain(c, "standard", { ...before, found: [[0], [], [], []] }, before, { from: FOUND, to: COLS, n: 1 })).toBe(-15);
  expect(gain(c, "standard", { ...before, down: [1, 0], cols: [[5, 6], [7]] }, { ...before, down: [0, 0], cols: [[5], [7, 6]] }, { from: COLS, to: COLS + 1, n: 1 })).toBe(5);
  const three = ctxOf(ordered("draw 3, passes 0, scoring standard"));
  expect(gain(three, "standard", before, { ...before, stock: [1], waste: [], recycles: 2 }, null)).toBe(0);
  expect(gain(three, "standard", before, { ...before, stock: [1], waste: [], recycles: 3 }, null)).toBe(-20);
});

test("vegas scoring starts down the stake and pays five a card home", () => {
  const p = ordered("draw 3, passes 3, scoring vegas");
  let s = solitaire.init(p);
  expect(s.score).toBe(-52);
  s = solitaire.reduce(p, s, { type: "move", from: COLS, to: FOUND, n: 1 });
  expect(s.score).toBe(-47);
  expect(scoreLine(p, s, 0)).toBe("-$47 · 1 move");
});

test("no scoring shows only moves; timed scoring takes points for time and adds a quick-win bonus", () => {
  const none = ordered("draw 1, passes 0, scoring none");
  expect(solitaire.init(none).score).toBe(0);
  expect(scoreLine(none, solitaire.init(none), 0)).toBe("0 moves");
  expect(timeAdjust(25_000, false)).toBe(-4);
  expect(timeAdjust(200_000, true)).toBe(-40 + 3500);
  expect(timeAdjust(30_000, true)).toBe(-6);
  const timed = ordered("draw 1, passes 0, scoring standard, timed");
  expect(timed.timed).toBe(true);
  const s = solitaire.reduce(timed, solitaire.init(timed), { type: "move", from: COLS, to: FOUND, n: 1 });
  expect(scoreLine(timed, s, 25_000)).toBe("score 6 · 1 move");
  expect(scoreLine(timed, s, 600_000)).toBe("score 0 · 1 move");
});

test("the running vegas total counts each deal once, however often it is resumed, and keeps the total kept before", () => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const p = ordered("draw 1, passes 0, scoring vegas-keep");
  const open = (q: SolitairePuzzle, owner: string) => {
    const session = new Session(solitaire, q, { kind: "imported" });
    bankPlugin<SolitairePuzzle>(solitaire, bankKey).setup!({ session, settings: {}, owner });
    return session;
  };
  const a = open(p, "a");
  open(p, "b");
  expect(scoreLine(p, a.state, 0)).toBe("this deal -$52 · total -$52 · 0 moves");
  a.dispatch({ type: "move", from: COLS, to: FOUND, n: 1 });
  expect(scoreLine(p, a.state, 0)).toBe("this deal -$47 · total -$47 · 1 move");
  const resumed = Session.restore(solitaire, a.snapshot());
  bankPlugin<SolitairePuzzle>(solitaire, bankKey).setup!({ session: resumed, settings: {}, owner: "r" });
  const swapped = klondikeFormat.parse(klondikeFormat.serialize!(p).replace("AC 2C", "2C AC"));
  const b = open(swapped, "u");
  expect(scoreLine(swapped, b.state, 0)).toBe("this deal -$52 · total -$99 · 0 moves");
  // a total kept by the earlier separate klondike game, under the same name and deal key
  expect(bankKey(p)).toBe(`1:${Array.from({ length: 52 }, (_, i) => i).join(",")}`);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

// --- spider ---

const twoSuits = () => spiderFormat.parse(`suits 2\n${Array.from({ length: 4 }, () => "KS QS JS TS 9S 8S 7S 6S 5S 4S 3S 2S AS KH QH JH TH 9H 8H 7H 6H 5H 4H 3H 2H AH").join(" ")}`);

/** A spider state with the given columns (card ids, all face up) and stock: piles 0 stock, 1–8 foundations, 9–18 columns. */
function table(cols: number[][], stock: number[] = []): SolitaireState {
  return {
    piles: [{ c: stock, d: stock.length }, ...Array.from({ length: 8 }, () => ({ c: [], d: 0 })), ...Array.from({ length: 10 }, (_, j) => ({ c: cols[j] ?? [], d: 0 }))],
    recycles: 0, moves: 0, score: 500,
  };
}

test("spider: six cards in the first four columns, five elsewhere, fifty in the stock", () => {
  const p = twoSuits();
  const s = solitaire.init(p);
  expect(s.piles.slice(9).map((pl) => pl.c.length)).toEqual([6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
  expect(s.piles.slice(9).every((pl) => pl.d === pl.c.length - 1)).toBe(true);
  const dealt = solitaire.reduce(p, s, { type: "draw" });
  expect(dealt.piles[0]!.c.length).toBe(40);
  expect(dealt.piles[9]!.c[6]).toBe(54);
});

test("spider: only one-suit runs move together, no deal onto an empty column, a finished run leaves", () => {
  const p = twoSuits();
  // ids 0–12 are K♠…A♠, 13–25 K♥…A♥
  const mixed = table([[0, 14]]);
  expect(solitaire.reduce(p, mixed, { type: "move", from: 9, to: 10, n: 2 })).toBe(mixed);
  expect(solitaire.reduce(p, mixed, { type: "move", from: 9, to: 10, n: 1 })).not.toBe(mixed);
  const gap = table([[0], [1], [2], [3], [4], [5], [6], [7], [8]], [30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);
  expect(solitaire.reduce(p, gap, { type: "draw" })).toBe(gap);
  const almost = table([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [12]]);
  const done = solitaire.reduce(p, almost, { type: "move", from: 10, to: 9, n: 1 });
  const home = done.piles.slice(1, 9).find((pl) => pl.c.length)!;
  expect(home.c.length).toBe(13);
  expect(home.c[12]).toBe(0);
  expect(done.piles[9]!.c.length).toBe(0);
  expect(done.score).toBe(500 - 1 + 100);
  expect(solitaire.isSolved(p, done)).toBe(false);
});

test("spider deal text round-trips and checks the cards", async () => {
  for (const label of OLD.spider.map((o) => o.label)) {
    const p = await gen({ ...preset(label), winnable: false }, "fmt");
    const text = spiderFormat.serialize!(p);
    expect(spiderFormat.detect!(text)).toBe(true);
    expect(spiderFormat.serialize!(spiderFormat.parse(text))).toBe(text);
    expect(variantOf(spiderFormat.parse(text))).toBe(label);
  }
  const text = spiderFormat.serialize!(await gen({ ...preset("Spider (2 suits)"), winnable: false }, "fmt"));
  expect(() => spiderFormat.parse(text.replace("KS", "KH"))).toThrow("of one");
});

// --- freecell ---

const rows = (n: number) => {
  const d = msDeal(n);
  return Array.from({ length: 7 }, (_, r) => d.slice(r * 8, r * 8 + 8).map(cardCode).join(" ")).join("\n");
};

test("microsoft deals match the published layouts", () => {
  expect(rows(1)).toBe("JD 2D 9H JC 5D 7H 7C 5H\nKD KC 9S 5S AD QC KH 3H\n2S KS 9D QD JS AS AH 3C\n4C 5C TS QH 4H AC 4D 7S\n3S TD 4S TH 8H 2C JH 7D\n6D 8S 8D QS 6C 3D 8C TC\n6S 9C 2H 6H");
  const p = msFormat.parse("#617");
  expect(p.cols[0]).toEqual(parseCards("7D TD TH KD 4C 4S JD"));
  expect(variantOf(p)).toBe("FreeCell");
});

test("the solver wins deal 1 and proves a two-cell deal hopeless", () => {
  const one = msFormat.parse("1");
  expect(solve(ctxOf(one), startPos(one)).path?.length).toBeGreaterThan(50);
  const two = fcsFormat.parse(`Freecells: - -\n${fcsFormat.serialize!(msFormat.parse("92")).split("\n").slice(1).join("\n")}`);
  expect(two.cells.length).toBe(2);
  expect(solve(ctxOf(two), startPos(two)).impossible).toBe(true);
});

test("freecell: alternating builds, cell and run limits", () => {
  const p = msFormat.parse("1");
  const s = solitaire.init(p);
  // piles: 0–3 cells, 4–7 foundations, 8–15 columns; column 1 top is 6S, column 4 top is 6H
  expect(solitaire.reduce(p, s, { type: "move", from: 8, to: 11, n: 1 })).toBe(s);
  expect(solitaire.reduce(p, s, { type: "move", from: 8, to: 0, n: 2 })).toBe(s);
  const parked = solitaire.reduce(p, s, { type: "move", from: 8, to: 0, n: 1 });
  expect(parked.piles[0]!.c).toEqual(parseCards("6S"));
  expect(solitaire.reduce(p, parked, { type: "move", from: 9, to: 0, n: 1 })).toBe(parked);
});

test("freecell board text round-trips and reads Freecell Solver layouts", async () => {
  const p = await gen({ ...preset("FreeCell, three free cells") }, "fmt");
  const text = fcsFormat.serialize!(p);
  expect(fcsFormat.detect!(text)).toBe(true);
  expect(fcsFormat.serialize!(fcsFormat.parse(text))).toBe(text);
  const q = fcsFormat.parse("4C 2C 9C 8C QS 4S 2H\n5H QH 3C AC 3H 4H QD\nQC 9S 6H 9H 3S KS 3D\n5D 2S JC 5C JH 6D AS\n2D KD TH TC TD 8D\n7H JS KH TS KC 7C\nAH 5S 6S AD 8H JD\n7S 6C 7D 4D 8S 9D");
  expect(q.cols.length).toBe(8);
  expect(q.cells).toEqual([-1, -1, -1, -1]);
  const r = fcsFormat.parse("Foundations: H-2 C-A S-0 D-0\nFreecells: KS -\nAD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD\n2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC\n3H 4H 5H 6H 7H 8H 9H TH JH QH KH\nAS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS");
  expect(r.found.map((f) => f.length)).toEqual([1, 0, 2, 0]);
  expect(r.cells.length).toBe(2);
  expect(() => fcsFormat.parse("AS AS\nKD\nQD\nJD")).toThrow("twice");
});

test("a deal number gives Microsoft's cards whatever the seed, with the cells asked for", async () => {
  const a = await gen({ ...preset("FreeCell"), deal: 617 }, "one");
  const b = await gen({ ...preset("FreeCell"), deal: 617, cells: 3 }, "two");
  expect(a.cols).toEqual(msFormat.parse("617").cols);
  expect(b.cols).toEqual(a.cols);
  expect(a.deal).toBe(617);
  expect(b.cells.length).toBe(3);
  expect(a.solution?.length).toBeGreaterThan(0);
}, 60_000);

// --- hints ---

test("technique steps are legal across kinds of game; practice positions exist", async () => {
  for (const label of ["Klondike", "Klondike (draw 3)", "FreeCell", "Baker's Game", "Yukon", "Eight Off", "Spider (1 suit)"]) {
    const p = await gen(preset(label), "t");
    let s = solitaire.init(p);
    for (let i = 0; i < 400 && !solitaire.isSolved(p, s); i++) {
      const hit = firstStep(solitaire, techniques, p, s);
      if (!hit) break;
      const next = applyStep(solitaire, p, s, hit.step);
      expect(next).not.toBe(s);
      s = next;
    }
  }
  for (const t of techniques) {
    const pos = await findPracticePosition(solitaire, techniques, t, "x", sig());
    const step = pos && findStep(solitaire, t, pos.puzzle, pos.state);
    expect(step?.actions.length).toBeGreaterThan(0);
  }
}, 120_000);

test("hints keep a winning line after wandering off the stored one", async () => {
  for (const label of ["Klondike", "FreeCell", "Spider (1 suit)"]) {
    const p = await gen(preset(label), "h");
    const session = new Session(solitaire, p, { kind: "imported" });
    const I = idxOf(p);
    if (I.stock >= 0) session.dispatch({ type: "draw" });
    else Array.from({ length: p.cols.length }, (_, j) => I.cols + j).find((from) => session.dispatch({ type: "move", from, to: I.cells, n: 1 }));
    expect(session.depth).toBe(1);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(solitaire, techniques, p, session.state);
      if (!hit) break;
      session.batch(() => { for (const a of hit.step.actions) session.dispatch(a as never); });
    }
  }
}, 60_000);
