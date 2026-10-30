import { expect, test } from "bun:test";
import { generate as run } from "../../core/generate";
import { createRng } from "../../core/rng";
import { applyStep, firstStep } from "../../core/techniques";
import { consistent, compareItems } from "../../lib/dataset/compare";
import { filter } from "../../lib/dataset/query";
import { decode, type PokemonDataFile } from "../../lib/pokemon/codec";
import type { PokemonDataset } from "../../lib/pokemon/types";
import { candidates, ctxOf, fitsGiven, isOpen, pokedleDef, shareText, solvedAt, type PokedlePuzzle, type PokedleState } from "./logic";
import { pokedleMetrics } from "./stats";
import { fallbackHint, pokedleTechniques } from "./techniques";

const file = (await Bun.file(new URL("../pokemon-data/data.json", import.meta.url)).json()) as PokemonDataFile;
const items = decode(file);
const dataset: PokemonDataset = { id: "pokemon", name: "pokémon", version: file.version, credits: file.credits, attributes: file.attributes, items: () => items, tables: { typeChart: file.typeChart } };
const data = () => dataset;
const def = pokedleDef(data);
const techniques = pokedleTechniques(data, def);
const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => run(def, params, seed, sig()) as Promise<PokedlePuzzle>;
const guess = (p: PokedlePuzzle, s: PokedleState, id: string) => def.reduce(p, s, { type: "guess", id });
const byId = (id: string) => items.find((i) => i.id === id)!;

test("generation is deterministic, and answers come from the pool, one per board, all different", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  for (let t = 0; t < 10; t++) {
    const p = await gen({ pool: "form:default gen:2", boards: 6 }, `g${t}`);
    expect(p.boards.length).toBe(6);
    expect(new Set(p.boards.map((b) => b.answer)).size).toBe(6);
    for (const b of p.boards) expect(byId(b.answer).values.gen).toBe("2");
  }
  await expect(gen({ boards: 4, guesses: 3 }, "x")).rejects.toThrow("at least 4 guesses");
  await expect(gen({ pool: "type:nonsense" }, "x")).rejects.toThrow("filter");
});

test("split boards: one per value with candidates, each answer has its board's values", async () => {
  const p = await gen({ split: "type" }, "types");
  expect(p.boards.length).toBe(18);
  expect(new Set(p.boards.map((b) => b.answer)).size).toBe(18);
  for (const b of p.boards) expect(byId(b.answer).values.type).toContain(b.given!.type as string);
  const g = await gen({ pool: "form:default gen:1-3", split: "gen", split2: "type" }, "grid");
  const pool = (filter(items, "form:default gen:1-3", file.attributes) as { items: typeof items }).items;
  // only cells some pokémon fills; distinct answers can leave a cell short only if its pokémon are all taken
  for (const b of g.boards) {
    expect(fitsGiven(byId(b.answer), b.given)).toBe(true);
    expect(pool.some((i) => i.id === b.answer)).toBe(true);
  }
  expect(g.boards.length).toBeGreaterThan(40);
  expect(g.boards.length).toBeLessThanOrEqual(53);
});

test("guessing: only guessable pokémon, never twice, and the game ends found or out of guesses", async () => {
  const p = await gen({ pool: "form:default gen:1", guesses: 3 }, "play");
  let s = def.init(p);
  const outside = items.find((i) => i.values.gen === "5")!.id;
  expect(guess(p, s, outside)).toBe(s);
  const wrong = ctxOf(data, p).pool.filter((i) => i.id !== p.boards[0]!.answer).map((i) => i.id);
  s = guess(p, s, wrong[0]!);
  expect(guess(p, s, wrong[0]!)).toBe(s);
  s = guess(p, guess(p, s, wrong[1]!), wrong[2]!);
  expect(def.isLost!(p, s)).toBe(true);
  expect(guess(p, s, p.boards[0]!.answer)).toBe(s);
  const anyP = await gen({ pool: "form:default gen:1", any: true }, "play");
  expect(guess(anyP, def.init(anyP), outside).guesses).toEqual([outside]);
});

test("candidates are exactly the pool pokémon that would have marked every guess the same", async () => {
  const rng = createRng("cand");
  for (let t = 0; t < 8; t++) {
    const p = await gen({ pool: "form:default gen:1-4", boards: 2 }, `c${t}`);
    const c = ctxOf(data, p);
    let s = def.init(p);
    for (let k = 0; k < 3; k++) s = guess(p, s, rng.pick(c.pool).id);
    for (let b = 0; b < 2; b++) {
      const answer = byId(p.boards[b]!.answer);
      const cand = candidates(data, p, s, b).map((i) => i.id);
      if (solvedAt(p, s, b) >= 0) { expect(cand).toEqual([answer.id]); continue; }
      expect(cand).toContain(answer.id);
      const other = p.boards[1 - b]!.answer;
      const otherFound = s.guesses.includes(other);
      const brute = c.pool.filter((it) => !s.guesses.includes(it.id) && !(otherFound && it.id === other) && s.guesses.every((g) => {
        const gi = byId(g);
        return consistent(c.attrs, gi, compareItems(c.attrs, gi, answer, p.bands), it, p.bands);
      })).map((i) => i.id);
      expect(cand).toEqual(brute);
    }
  }
});

test("a guess marked all right that isn't the pokémon is ruled out", async () => {
  // with only generation compared, many pokémon look the same
  const p = await gen({ pool: "form:default gen:1", attrs: ["gen"] }, "same");
  const twin = ctxOf(data, p).pool.find((i) => i.id !== p.boards[0]!.answer)!;
  const s = guess(p, def.init(p), twin.id);
  const cand = candidates(data, p, s, 0);
  expect(cand.map((i) => i.id)).not.toContain(twin.id);
  expect(cand.length).toBe(ctxOf(data, p).pool.length - 1);
});

test("in sequence, a board opens once the one before is found, and a board found early stays hidden until then", async () => {
  const p = await gen({ boards: 3, sequence: "sequence", pool: "form:default gen:1" }, "seq");
  let s = guess(p, def.init(p), p.boards[1]!.answer);
  expect(isOpen(p, s, 1)).toBe(false);
  // board 1's pokémon isn't known to be taken while board 1 is closed
  expect(candidates(data, p, s, 0).some((i) => i.id === p.boards[1]!.answer)).toBe(false); // it was guessed: ruled out as a guess
  s = guess(p, s, p.boards[0]!.answer);
  expect(isOpen(p, s, 1) && isOpen(p, s, 2)).toBe(true);
  expect(solvedAt(p, s, 1)).toBe(0);
  s = guess(p, s, p.boards[2]!.answer);
  expect(def.isSolved(p, s)).toBe(true);
});

test("hints: the only-one step guesses the answer; otherwise the count of pokémon that fit is given", async () => {
  let sawOnly = 0;
  for (let t = 0; t < 10; t++) {
    const p = await gen({ pool: "form:default gen:1" }, `h${t}`);
    const pool = ctxOf(data, p).pool;
    const rng = createRng(`h${t}`);
    let s = def.init(p);
    for (let k = 0; k < 12 && !def.isSolved(p, s); k++) {
      const hit = firstStep(def, techniques, p, s);
      if (hit) {
        sawOnly++;
        expect(hit.step.actions as unknown).toEqual([{ type: "guess", id: p.boards[0]!.answer }]);
        s = applyStep(def, p, s, hit.step);
        expect(def.isSolved(p, s)).toBe(true);
        break;
      }
      if (s.guesses.length) {
        const n = candidates(data, p, s, 0).length;
        expect(fallbackHint(data, p, s)!.message).toStartWith(`${n} pokémon fit`);
      }
      s = guess(p, s, rng.pick(pool.filter((i) => !s.guesses.includes(i.id))).id);
    }
  }
  expect(sawOnly).toBeGreaterThan(3);
});

test("share text and score say how it went without naming the pokémon", async () => {
  const p = await gen({ pool: "form:default gen:1", guesses: 6 }, "share");
  const wrong = ctxOf(data, p).pool.find((i) => i.id !== p.boards[0]!.answer)!;
  const s = guess(p, guess(p, def.init(p), wrong.id), p.boards[0]!.answer);
  const text = shareText(data, p, s);
  expect(text.split("\n")).toEqual([`pokédle 2/6`, expect.stringMatching(/^[🟩🟨⬛]{6}$/u), "🟩".repeat(6)]);
  expect(text.toLowerCase()).not.toContain(byId(p.boards[0]!.answer).name.toLowerCase());
  expect(def.score!(p, s)).toMatchObject({ value: 2, better: "lower" });
  const q = await gen({ boards: 4, guesses: 9 }, "share4");
  const s4 = guess(q, def.init(q), q.boards[2]!.answer);
  expect(shareText(data, q, s4)).toBe("pokédle X/9\n🟥 🟥\n1\ufe0f\u20e3 🟥");
});

test("metrics: the guess each attribute was first right on, per attribute, over the boards found", async () => {
  const p = await gen({ pool: "form:default gen:1", attrs: ["gen", "type"] }, "stats");
  const ans = byId(p.boards[0]!.answer);
  const other = ctxOf(data, p).pool.find((i) => i.id !== ans.id && JSON.stringify(i.values.type) !== JSON.stringify(ans.values.type))!;
  const s = guess(p, guess(p, def.init(p), other.id), ans.id);
  const m = Object.fromEntries(pokedleMetrics(data)(p, s).map((x) => [x.id, x.value]));
  expect(m).toEqual({ "first-right:gen": 1, "first-right:type": 2 }); // gen 1 pool: gen right on the first guess
});
