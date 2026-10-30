import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { decode, type PokemonDataFile } from "../../lib/pokemon/codec";
import type { PokemonDataset } from "../../lib/pokemon/types";
import { groups, isSolved, limitFor, makeDef, missed, nameIndex, readTyped, type NameAllPuzzle } from "./logic";

const file = (await Bun.file(new URL("../pokemon-data/data.json", import.meta.url)).json()) as PokemonDataFile;
const items = decode(file);
const dataset: PokemonDataset = { id: "pokemon", name: "pokémon", version: file.version, credits: file.credits, attributes: file.attributes, items: () => items, tables: { typeChart: file.typeChart } };
const def = makeDef(() => dataset);
const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed = "s") => generate(def, params, seed, sig()) as Promise<NameAllPuzzle>;
const byName = (n: string) => items.find((i) => i.name === n && i.form === "default")!;

test("the default round is generation 1 in dex order, 6 seconds each rounded up to minutes", async () => {
  const p = await gen({});
  expect(p.pool.length).toBe(151);
  expect(p.pool[0]).toBe("bulbasaur");
  expect(p.pool[150]).toBe("mew");
  expect(p.limitMs).toBe(16 * 60_000);
  expect(limitFor(151, 0)).toBe(0);
});

test("random rounds are one generation or type of the filter, and differ by seed", async () => {
  const picks = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const p = await gen({ pool: "form:default", round: "type" }, `t${i}`);
    expect(p.label).toMatch(/ types$/);
    const t = p.label!.replace(/ types$/, "");
    for (const id of p.pool) expect(items.find((x) => x.id === id)!.values.type).toContain(t);
    picks.add(t);
  }
  expect(picks.size).toBeGreaterThan(3);
  const g = await gen({ pool: "form:default", round: "gen" }, "g");
  const gens = new Set(g.pool.map((id) => items.find((x) => x.id === id)!.values.gen));
  expect(gens.size).toBe(1);
  expect(await gen({ pool: "form:default", round: "any" }, "x")).toEqual(await gen({ pool: "form:default", round: "any" }, "x"));
});

test("naming adds pool members once; names outside the pool do nothing", async () => {
  const p = await gen({});
  let s = def.init(p);
  s = def.reduce(p, s, { type: "name", ids: ["pikachu"] });
  expect(s.named).toEqual(["pikachu"]);
  expect(def.reduce(p, s, { type: "name", ids: ["pikachu"] })).toBe(s);
  expect(def.reduce(p, s, { type: "name", ids: ["chikorita"] })).toBe(s);
});

test("typing: exact names (accents and punctuation forgiven), names that start longer ones, names outside the pool", async () => {
  const p = await gen({});
  const pool = p.pool.map((id) => items.find((x) => x.id === id)!);
  const index = nameIndex(pool), all = nameIndex(items);
  expect(readTyped("Farfetchd", index, all, new Set()).name).toEqual([byName("Farfetch’d").id]);
  expect(readTyped("mr mime", index, all, new Set()).name).toEqual([byName("Mr. Mime").id]);
  expect(readTyped("nidoran f", index, all, new Set()).name).toEqual([byName("Nidoran♀").id]);
  expect(readTyped("nidoran", index, all, new Set()).name).toEqual([]);
  // Mew is a name of its own and the start of Mewtwo
  const mew = readTyped("mew", index, all, new Set());
  expect(mew.name).toEqual(["mew"]);
  expect(mew.longer).toBe(true);
  // once Mewtwo is named, Mew is just Mew
  expect(readTyped("mew", index, all, new Set(["mewtwo"])).longer).toBe(false);
  expect(readTyped("mew", index, all, new Set(["mew"])).known).toEqual(["mew"]);
  expect(readTyped("chikorita", index, all, new Set()).outside).toBe(true);
  expect(readTyped("chiko", index, all, new Set()).outside).toBe(false);
});

test("giving up (or time up) ends the game as a loss with a score; nothing can be named or undone after", async () => {
  const p = await gen({});
  const session = new Session(def, p, { kind: "imported" });
  session.dispatch({ type: "name", ids: ["pikachu"] });
  session.dispatch({ type: "name", ids: ["mew"] });
  expect(session.canUndo).toBe(false);
  session.dispatch({ type: "end" });
  expect(session.lost).toBe(true);
  expect(missed(p, session.state).length).toBe(149);
  expect(session.dispatch({ type: "name", ids: ["eevee"] })).toBe(false);
  expect(isSolved(p, session.state)).toBe(false);
  expect(def.hint!(p, session.state)).toBe(null);
  expect(def.score!(p, session.state)).toEqual({ value: 2, label: "2/151", better: "higher" });
  expect(def.shareText!(p, session.state)).toBe("name them all · form:default gen:1\n2/151 in 16:00");
});

test("naming every one solves it", async () => {
  const p = await gen({ pool: "form:default gen:1 type=fire" });
  const session = new Session(def, p, { kind: "imported" });
  for (const id of p.pool) session.dispatch({ type: "name", ids: [id] });
  expect(session.solved).toBe(true);
});

test("groups follow generation or first type, in the attribute's order", async () => {
  const p = await gen({ pool: "form:default gen:1-2" });
  const pool = p.pool.map((id) => items.find((x) => x.id === id)!);
  expect(groups(pool, "gen", dataset).map((g) => [g.label, g.items.length])).toEqual([["gen 1", 151], ["gen 2", 100]]);
  const byType = groups(pool, "type", dataset);
  expect(byType[0]!.key).toBe("normal");
  expect(byType.find((g) => g.key === "grass")!.items.map((i) => i.id)).toContain("bulbasaur");
  expect(byType.find((g) => g.key === "poison")!.items.map((i) => i.id)).not.toContain("bulbasaur");
});

test("the hint names the first open slot's first letter, then half of it", async () => {
  const p = await gen({});
  let s = def.init(p);
  s = def.reduce(p, s, { type: "name", ids: ["bulbasaur"] });
  const h = def.hint!(p, s)!;
  expect(h.message).toBe("#0002 starts with I");
  expect(h.more!.message).toBe("#0002 starts with Ivys…");
});
