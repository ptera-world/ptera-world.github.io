import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { facet } from "../../lib/pokemon/facets";
import dataPack from "../pokemon-data/index";
import pack from "./index";
import { analyse, assignment, rarity, type GridPuzzle, type GridState } from "./logic";

const registry = new Registry();
dataPack({ ...api, registry });
pack({ ...api, registry });
const def = registry.getPuzzle("pokedoku")!;
const ds = registry.getDataset("pokemon")!;
const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, sig()) as Promise<GridPuzzle>;

test("generation is deterministic and every square has at least the asked-for answers, with a full distinct assignment", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  for (const [params, seed] of [[{}, "x"], [{ answers: 1, difficulty: "hard" }, "h"], [{ rows: 4, cols: 4, answers: 5 }, "big"], [{ kinds: ["type", "gen", "ability"], answers: 2 }, "ab"], [{ pool: "form:default gen:1", answers: 2 }, "g1"]] as const) {
    const p = await gen(params, seed);
    const a = analyse(ds, p);
    const k = (params as { answers?: number }).answers ?? 3;
    for (const ans of a.answers) expect(ans.length).toBeGreaterThanOrEqual(k);
    const board = assignment(a.answers)!;
    expect(new Set(board).size).toBe(board.length);
    board.forEach((id, c) => expect(a.answers[c]).toContain(id));
    // no criterion twice, and no square whose answers are all of one of its criteria's
    expect(new Set([...p.rows, ...p.cols]).size).toBe(p.rows.length + p.cols.length);
    for (const [c, ans] of a.answers.entries()) {
      const r = facet(ds, p.rows[Math.floor(c / p.cols.length)]!), col = facet(ds, p.cols[c % p.cols.length]!);
      const nr = a.pool.filter(r.test).length, nc = a.pool.filter(col.test).length;
      expect(ans.length).toBeLessThan(Math.min(nr, nc));
    }
  }
});

test("an impossible ask says what to change", async () => {
  await expect(gen({ answers: 50, pool: "form:default gen:1", kinds: ["ability"] }, "z")).rejects.toThrow("allow fewer answers");
});

const fixed: GridPuzzle = { rows: ["type:fire", "type:water"], cols: ["gen:1", "typing:dual"], pool: "form:default", guesses: 5 };

test("right answers fill, wrong ones cost a guess, and nothing is used twice", () => {
  let s = def.init(fixed) as GridState;
  const g = (cell: number, item: string) => (s = def.reduce(fixed, s, { type: "guess", cell, item }));
  g(0, "charmander");
  expect(s.cells[0]).toBe("charmander");
  const was = s;
  expect(g(1, "charmander")).toBe(was); // already used
  expect(g(0, "vulpix")).toBe(was); // square taken
  expect(g(1, "mega-charizard-x")).toBe(was); // not in play
  g(1, "squirtle"); // water, not fire
  expect(s.wrong).toEqual([{ cell: 1, item: "squirtle" }]);
  const once = s;
  expect(g(1, "squirtle")).toBe(once); // the same miss again is ignored
  g(1, "charizard");
  g(2, "squirtle");
  expect(def.isLost!(fixed, s)).toBe(false);
  g(3, "pikachu"); // fifth guess, wrong: out of guesses
  expect(def.isLost!(fixed, s)).toBe(true);
  expect(g(3, "lapras")).toBe(s);
});

test("rarity: 100 ÷ answers for a filled square, 100 for an empty one", () => {
  const a = analyse(ds, fixed);
  const s: GridState = { cells: ["charmander", null, null, null], wrong: [] };
  expect(rarity(a, s)).toBe(Math.round(100 / a.answers[0]!.length + 300));
  expect(def.score!(fixed, s)).toEqual({ value: rarity(a, s), label: "rarity", better: "lower" });
  expect(def.shareText!(fixed, s)).toBe(`pokémon grid 1/4\n🟩⬜\n⬜⬜\nrarity ${rarity(a, s)}`);
});

test("revealing keeps the player's squares when they still leave a full answer", () => {
  const s: GridState = { cells: [null, "charizard", null, null], wrong: [] };
  const session = new Session(def, fixed, { kind: "imported" }, { state: s });
  expect(session.reveal()).toBe(true);
  expect((session.state as GridState).cells[1]).toBe("charizard");
  expect(def.isSolved(fixed, session.state)).toBe(true);
});

test("assignment respects fixed squares and finds a way round blocked ones", () => {
  expect(assignment([["a"], ["a", "b"]])).toEqual(["a", "b"]);
  expect(assignment([["a", "b"], ["a"]])).toEqual(["b", "a"]);
  expect(assignment([["a", "b"], ["a"]], ["a", null])).toBeNull();
});
