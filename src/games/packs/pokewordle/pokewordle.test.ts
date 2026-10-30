import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { applyStep, firstStep } from "../../core/techniques";
import { decode, type PokemonDataFile } from "../../lib/pokemon/codec";
import type { PokemonDataset } from "../../lib/pokemon/types";
import { ABSENT, ELSEWHERE, RIGHT, candidates, hardModeError, makeDef, markWord, wordOf, wordsOf, type WordlePuzzle, type WordleState } from "./logic";
import { makeTechniques } from "./techniques";

const file = (await Bun.file(new URL("../pokemon-data/data.json", import.meta.url)).json()) as PokemonDataFile;
const items = decode(file);
const dataset: PokemonDataset = { id: "pokemon", name: "pokémon", version: file.version, credits: file.credits, attributes: file.attributes, items: () => items, tables: { typeChart: file.typeChart } };
const def = makeDef(() => dataset);
const { techniques, plugins } = makeTechniques(def, () => dataset);
const words = wordsOf(dataset);
const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed = "s") => generate(def, params, seed, sig()) as Promise<WordlePuzzle>;
const puzzle = (answer: string, extra: Partial<WordlePuzzle> = {}): WordlePuzzle => ({ pool: "form:default", answer, guesses: 6, hard: false, ...extra });
const play = (p: WordlePuzzle, ...guesses: string[]): WordleState => {
  let s = def.init(p);
  for (const g of guesses) {
    s = def.reduce(p, s, { type: "row", row: g.split("") });
    s = def.reduce(p, s, { type: "submit" });
  }
  return s;
};

test("a name's word is its letters only; names with digits have none", () => {
  expect(wordOf("Mr. Mime")).toBe("mrmime");
  expect(wordOf("Farfetch’d")).toBe("farfetchd");
  expect(wordOf("Nidoran♀")).toBe("nidoranf");
  expect(wordOf("Flabébé")).toBe("flabebe");
  expect(wordOf("Porygon2")).toBe(null);
});

test("marks follow wordle's rule for repeated letters", () => {
  // only as many E's are marked as the answer has, right places first
  expect(markWord("eevee", "abcde")).toEqual([ABSENT, ABSENT, ABSENT, ABSENT, RIGHT]);
  expect(markWord("eevee", "exxxx")).toEqual([RIGHT, ABSENT, ABSENT, ABSENT, ABSENT]);
  expect(markWord("eevee", "xexex")).toEqual([ABSENT, RIGHT, ABSENT, RIGHT, ABSENT]);
  expect(markWord("eevee", "xxeex")).toEqual([ELSEWHERE, ABSENT, ABSENT, RIGHT, ABSENT]);
  expect(markWord("abbey", "kebab")).toEqual([ELSEWHERE, ELSEWHERE, RIGHT, ELSEWHERE, ABSENT]);
});

test("answers come from the filter, in the length range, and are deterministic per seed", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  for (let i = 0; i < 20; i++) {
    const p = await gen({ pool: "form:default gen:1", minLen: 5, maxLen: 6 }, `n${i}`);
    const it = items.find((x) => x.id === p.answer)!;
    expect(it.values.gen).toBe("1");
    expect(wordOf(it.name)!.length).toBeGreaterThanOrEqual(5);
    expect(wordOf(it.name)!.length).toBeLessThanOrEqual(6);
  }
  await expect(gen({ pool: "form:default gen:1", minLen: 12, maxLen: 12 })).rejects.toThrow(/12 letters/);
});

test("only pokémon names of the right length can be handed in; a right guess solves", () => {
  const p = puzzle("pikachu");
  let s = def.init(p);
  expect(s.row.length).toBe(7);
  for (const ch of "pikach") s = def.reduce(p, s, { type: "letter", ch });
  expect(def.reduce(p, s, { type: "submit" })).toBe(s);
  s = def.reduce(p, s, { type: "letter", ch: "x" });
  expect(def.reduce(p, s, { type: "submit" })).toBe(s);
  s = def.reduce(p, s, { type: "back" });
  s = def.reduce(p, s, { type: "letter", ch: "u" });
  s = def.reduce(p, s, { type: "submit" });
  expect(def.isSolved(p, s)).toBe(true);
  expect(def.score!(p, s)).toEqual({ value: 1, label: "1/6", better: "lower" });
  expect(def.shareText!(p, s)).toBe("name wordle 1/6 · 7 letters\n\n🟩🟩🟩🟩🟩🟩🟩");
});

test("losing has no score, and the share text says X", () => {
  const p = puzzle("pikachu", { guesses: 2 });
  const s = play(p, "rattata", "pidgeot");
  expect(def.isLost!(p, s)).toBe(true);
  expect(def.score!(p, s)).toBe(null);
  expect(def.shareText!(p, s)!.split("\n")[0]).toBe("name wordle X/2 · 7 letters");
});

test("hard mode keeps greens in place and found letters in use", () => {
  const p = puzzle("pikachu", { hard: true });
  const s = play(p, "pidgeot");
  expect(s.done[0]!.marks.slice(0, 2)).toEqual([RIGHT, RIGHT]);
  expect(hardModeError(s.done, "rattata")).toBe("the 1st letter must be P");
  expect(def.reduce(p, s, { type: "row", row: "rattata".split("") })).not.toBe(s);
  const typed = def.reduce(p, s, { type: "row", row: "rattata".split("") });
  expect(def.reduce(p, typed, { type: "submit" })).toBe(typed);
  expect(hardModeError(play(puzzle("eevee"), "zubat").done, "abcde")).toBe(null);
});

test("names that still fit are exactly the pool words consistent with every mark", () => {
  const p = puzzle("pikachu");
  const s = play(p, "rattata");
  const c = candidates(words, p, s);
  expect(c.length).toBe(20);
  expect(c).toContain("pikachu");
  for (const w of words.pool(p.pool).filter((w) => w.length === 7)) {
    expect(c.includes(w)).toBe(s.done.every((g) => markWord(g.word, w).join() === g.marks.join()));
  }
  expect(def.hint!(p, s)!.message).toBe(`${c.length} names of 7 letters still fit every mark`);
});

test("known letter fills a letter every fitting name has; no technique guesses the answer", () => {
  const p = puzzle("pikachu");
  // CETITAN leaves JIRACHI, LUCARIO and PIKACHU: all have A 4th, though CETITAN's A was only yellow
  const s = play(p, "cetitan");
  expect(candidates(words, p, s)).toEqual(["jirachi", "lucario", "pikachu"]);
  const step = firstStep(def, techniques, p, s);
  expect(step?.technique.id).toBe("pokewordle.known-letter");
  let filled = applyStep(def, p, s, step!.step);
  expect(filled.row).toEqual(["", "", "", "a", "", "", ""]);
  // spelling a name out types over the letter filled in ahead
  for (const ch of "jirachi") filled = def.reduce(p, filled, { type: "letter", ch });
  expect(filled.row.join("")).toBe("jirachi");
  expect(firstStep(def, techniques, p, def.init(p))).toBe(null);
  // guess fitting names until one is left: no technique plays it
  let t = s;
  while (candidates(words, p, t).length > 1) t = play(p, ...t.done.map((g) => g.word), candidates(words, p, t).find((w) => w !== "pikachu")!);
  expect(firstStep(def, techniques, p, t)).toBe(null);
});

test("the check plugin points out a typed name an earlier guess rules out", () => {
  const p = puzzle("pikachu");
  const session = new Session(def, p, { kind: "imported" });
  for (const pl of plugins) pl.setup!({ session, settings: {}, owner: pl.id });
  session.dispatch({ type: "row", row: "pidgeot".split("") });
  session.dispatch({ type: "submit" });
  session.dispatch({ type: "row", row: "rattata".split("") });
  expect(session.hint()?.message).toMatch(/^RATTATA can't be the answer/);
  expect(session.canUndo).toBe(false);
});
