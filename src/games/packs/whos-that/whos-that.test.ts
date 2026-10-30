import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { decode, type PokemonDataFile } from "../../lib/pokemon/codec";
import type { PokemonDataset } from "../../lib/pokemon/types";
import { BLANK, easeLevel, extrasShown, makeWhoThat, redact, type WhoAction, type WhoPuzzle, type WhoState } from "./logic";

const file = (await Bun.file(new URL("../pokemon-data/data.json", import.meta.url)).json()) as PokemonDataFile;
const items = decode(file);
const dataset = { id: "pokemon", name: "pokémon", version: file.version, credits: "", attributes: file.attributes, items: () => items, tables: { typeChart: file.typeChart } } as PokemonDataset;
const def = makeWhoThat(() => dataset);
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, new AbortController().signal) as Promise<WhoPuzzle>;
const play = (p: WhoPuzzle, actions: WhoAction[]): WhoState => actions.reduce((s, a) => def.reduce(p, s, a), def.init(p));
const byId = (id: string) => items.find((i) => i.id === id)!;

const base: WhoPuzzle = { answers: ["pikachu", "bulbasaur", "eevee"], clues: ["silhouette", "zoom", "entry"], spots: [0.1, 0.2, 0.3], pool: "form:default", picture: "art", guesses: 3, easing: true, extras: ["gen", "type", "genus"], game: "run" };

test("generation is deterministic and draws from the pool", async () => {
  expect(await gen({ game: "run", count: 5 }, "a")).toEqual(await gen({ game: "run", count: 5 }, "a"));
  const p = await gen({ game: "run", count: 20, pool: "form:default gen:1" }, "b");
  expect(p.answers.length).toBe(20);
  expect(new Set(p.answers).size).toBe(20);
  for (const id of p.answers) expect(byId(id).values.gen).toBe("1");
  const streak = await gen({ game: "streak", pool: "form:default gen:1" }, "c");
  expect(streak.answers.length).toBe(151);
});

test("mixed clues use only the clues picked", async () => {
  const p = await gen({ clue: "mixed", mix: ["blur", "entry"], game: "run", count: 30 }, "m");
  expect(new Set(p.clues)).toEqual(new Set(["blur", "entry"]));
  await expect(gen({ clue: "mixed", mix: [] }, "x")).rejects.toThrow("at least one clue");
});

test("a wrong guess eases the clue and uncovers the next fact; the right one ends the round", () => {
  let s = play(base, [{ type: "guess", id: "raichu" }]);
  expect(easeLevel(base, 0, s.rounds[0]!)).toBe(1);
  expect(extrasShown(base, 0, s.rounds[0]!)).toEqual(["gen"]);
  expect(def.reduce(base, s, { type: "guess", id: "raichu" })).toBe(s);
  expect(def.reduce(base, s, { type: "next" })).toBe(s);
  s = def.reduce(base, s, { type: "guess", id: "pikachu" });
  expect(def.reduce(base, s, { type: "guess", id: "eevee" })).toBe(s);
  s = def.reduce(base, s, { type: "next" });
  expect(s.rounds.length).toBe(2);
});

test("an entry clue already shows the category, so wrong guesses skip it", () => {
  const s = play(base, [{ type: "guess", id: "pikachu" }, { type: "next" }, { type: "pass" }, { type: "next" }, { type: "guess", id: "ditto" }, { type: "guess", id: "mew" }]);
  expect(extrasShown(base, 2, s.rounds[2]!)).toEqual(["gen", "type"]);
});

test("a run is played out and scored by how many were named", () => {
  const s = play(base, [
    { type: "guess", id: "pikachu" }, { type: "next" },
    { type: "pass" }, { type: "next" },
    { type: "guess", id: "ditto" }, { type: "guess", id: "eevee" },
  ]);
  expect(def.isSolved(base, s)).toBe(true);
  expect(def.score!(base, s)).toEqual({ value: 2, label: "2 of 3 named", better: "higher" });
  expect(def.shareText!(base, s)).toBe("Who's that pokémon? · mixed clues · 2/3\n🟩🟥🟨");
});

test("one pokémon: out of guesses is a loss with no score", () => {
  const p: WhoPuzzle = { ...base, answers: ["pikachu"], clues: ["silhouette"], game: "one" };
  const s = play(p, [{ type: "guess", id: "raichu" }, { type: "guess", id: "pichu" }, { type: "guess", id: "plusle" }]);
  expect(def.isLost!(p, s)).toBe(true);
  expect(def.isSolved(p, s)).toBe(false);
  expect(def.score!(p, s)).toBe(null);
  expect(def.shareText!(p, s)).toBe("Who's that pokémon? · silhouette · X/3\n⬛⬛⬛");
});

test("a streak ends at the first miss, as a loss that keeps its score", () => {
  const p: WhoPuzzle = { ...base, game: "streak", guesses: 1 };
  const s = play(p, [{ type: "guess", id: "pikachu" }, { type: "next" }, { type: "guess", id: "ivysaur" }]);
  expect(def.isLost!(p, s)).toBe(true);
  expect(def.score!(p, s)).toEqual({ value: 1, label: "streak of 1", better: "higher" });
  expect(def.reduce(p, s, { type: "next" })).toBe(s);
});

test("revealing names every remaining pokémon", () => {
  const s = play(base, [{ type: "guess", id: "raichu" }]);
  const ans = def.solve!(base, s);
  expect(ans && "moves" in ans && def.isSolved(base, ans.moves.reduce((x, a) => def.reduce(base, x, a), s))).toBe(true);
});

test("dex entries have every pokémon's name blanked out", () => {
  const dugtrio = redact(dataset, byId("dugtrio"));
  expect(dugtrio).toContain(BLANK);
  expect(dugtrio.toLowerCase()).not.toContain("diglett");
  for (const it of items.filter((i) => i.form === "default")) {
    const text = redact(dataset, it).toLowerCase();
    for (const n of [it.name, ...(it.aliases ?? [])]) expect(text.includes(n.toLowerCase()) ? `${it.id}: ${n}` : "").toBe("");
  }
});
