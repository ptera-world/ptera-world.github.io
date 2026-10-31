import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { optionsOf, resolve, type EnumField } from "../../core/schema";
import { Session } from "../../core/session";
import type { DataItem } from "../../core/types";
import openingsPack from "../openings-data/index";
import pokemonPack from "../pokemon-data/index";
import wordsPack from "../words-data/index";
import {
  groups, isSolved, limitFor, makeDef, MAX_POOL, missed, nameIndex, readTyped, setupOf,
  type DataSource, type NameAllPuzzle,
} from "./logic";

const registry = new Registry();
for (const pack of [pokemonPack, wordsPack, openingsPack]) pack({ ...api, registry });
const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
const def = makeDef(data);
const dataset = data.get("pokemon")!;
const items = dataset.items() as readonly (DataItem & { form: string })[];
const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed = "s") => generate(def, params, seed, sig()) as Promise<NameAllPuzzle>;
const byName = (n: string) => items.find((i) => i.name === n && i.form === "default")!;

test("the default round is generation 1 of pokémon in dex order, 6 seconds each rounded up to minutes", async () => {
  const p = await gen({});
  expect(p.dataset).toBe("pokemon");
  expect(p.pool.length).toBe(151);
  expect(p.pool[0]).toBe("bulbasaur");
  expect(p.pool[150]).toBe("mew");
  expect(p.limitMs).toBe(16 * 60_000);
  expect(p.slots).toBe("dex");
  expect(limitFor(151, 0)).toBe(0);
});

test("forms follow their species, as in the dex", async () => {
  const p = await gen({ pool: "" });
  const at = (id: string) => p.pool.indexOf(id);
  expect(at("deoxys-normal")).toBeLessThan(at("deoxys-attack"));
  expect(at("deoxys-attack")).toBeLessThan(at("turtwig"));
});

test("random rounds are one generation or type of the filter, and differ by seed", async () => {
  const picks = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const p = await gen({ pool: "form:default", round: ["type"] }, `t${i}`);
    expect(p.label).toMatch(/^type: /);
    const t = p.label!.replace(/^type: /, "");
    for (const id of p.pool) expect(items.find((x) => x.id === id)!.values.type).toContain(t);
    picks.add(t);
  }
  expect(picks.size).toBeGreaterThan(3);
  const g = await gen({ pool: "form:default", round: ["gen"] }, "g");
  const gens = new Set(g.pool.map((id) => items.find((x) => x.id === id)!.values.gen));
  expect(gens.size).toBe(1);
  const any = { pool: "form:default", round: ["gen", "type"] };
  expect(await gen(any, "x")).toEqual(await gen(any, "x"));
  const kinds = new Set<string>();
  for (let i = 0; i < 12; i++) kinds.add((await gen(any, `a${i}`)).label!.split(":")[0]!);
  expect([...kinds].sort()).toEqual(["generation", "type"]);
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
  const index = nameIndex<DataItem>(pool), all = nameIndex<DataItem>(items);
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
  expect(def.shareText!(p, session.state)).toBe("name them all · form:default gen:1\n2/151 · 16:00 limit");
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
  expect(groups(pool, "one", dataset).map((g) => [g.label, g.items.length])).toEqual([["gen 1", 151], ["gen 2", 100]]);
  const byType = groups(pool, "first", dataset);
  expect(byType[0]!.key).toBe("normal");
  expect(byType.find((g) => g.key === "grass")!.items.map((i) => i.id)).toContain("bulbasaur");
  expect(byType.find((g) => g.key === "poison")!.items.map((i) => i.id)).not.toContain("bulbasaur");
});

test("the hint names the first open slot's first letter, then half of it", async () => {
  const p = await gen({});
  let s = def.init(p);
  s = def.reduce(p, s, { type: "name", ids: ["bulbasaur"] });
  const h = def.hint!(p, s)!;
  expect(h.message).toBe("dex number 2 starts with I");
  expect(h.more!.message).toBe("dex number 2 starts with Ivys…");
  const blank = await gen({ slots: "blank" });
  expect(def.hint!(blank, def.init(blank))!.message).toBe("no. 1 starts with B");
});

test("games saved before the game took a dataset still play: pokémon, numbered by dex", async () => {
  const old = { query: "form:default gen:1", pool: ["bulbasaur", "ivysaur"], limitMs: 0, slots: "number" } as NameAllPuzzle;
  expect(def.datasetsOf!(old)).toEqual(["pokemon"]);
  expect(def.hint!(old, def.init(old))!.message).toBe("dex number 1 starts with B");
});

test("a pool too big for the board is refused unless a round narrows it", async () => {
  await expect(gen({ dataset: "openings", pool: "" })).rejects.toThrow(`at most ${MAX_POOL}`);
  const p = await gen({ dataset: "openings", pool: "", round: ["family"] }, "r");
  expect(p.pool.length).toBeLessThanOrEqual(MAX_POOL);
  expect(p.label).toMatch(/^opening: /);
});

test("chess openings: offered with a preset, and play from a typed name to the end", async () => {
  const dsOpts = optionsOf(def.params.dataset as EnumField, {}).map((o) => o.value);
  expect(dsOpts).toContain("openings");
  const preset = def.presets!.find((x) => x.params.dataset === "openings")!;
  expect(preset).toBeDefined();
  const p = await gen(preset.params, "o");
  expect(p.dataset).toBe("openings");
  expect(p.pool.length).toBeGreaterThanOrEqual(5);
  expect(p.pool.length).toBeLessThanOrEqual(MAX_POOL);
  // ECO codes are shared by dozens of openings, so slots show nothing rather than a row of A00s; dex numbers tell pokémon apart
  expect(resolve(def.params, { dataset: "openings" }).slots).toBe("blank");
  expect(resolve(def.params, { dataset: "pokemon" }).slots).toBe("dex");
  const openings = data.get("openings")!;
  const pool = p.pool.map((id) => openings.items().find((x) => x.id === id)!);
  const r = readTyped(pool[0]!.name.toUpperCase(), nameIndex(pool), nameIndex(openings.items()), new Set());
  expect(r.name).toContain(pool[0]!.id);
  const session = new Session(def, p, { kind: "imported" });
  session.dispatch({ type: "name", ids: r.name });
  expect(def.hint!(p, session.state)!.message).toMatch(/^ECO code [A-E]\d\d starts with /);
  for (const id of p.pool) session.dispatch({ type: "name", ids: [id] });
  expect(session.solved).toBe(true);
  expect(def.rules!(p)[0]).toContain(`name all ${p.pool.length} openings`);
});

test("english words: no pool or round of them fits the board, so they're not offered", () => {
  const words = data.get("words")!;
  expect(setupOf(words)).toBe(null);
  expect(optionsOf(def.params.dataset as EnumField, {}).map((o) => o.value)).not.toContain("words");
  expect(def.presets!.some((x) => x.params.dataset === "words")).toBe(false);
});

test("every preset generates", async () => {
  for (const preset of def.presets!) await gen(preset.params, `preset ${preset.label}`);
  expect(def.presets!.length).toBe(7);
});
