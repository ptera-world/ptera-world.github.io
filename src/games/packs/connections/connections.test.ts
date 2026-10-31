import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { optionsOf, resolve, type EnumField } from "../../core/schema";
import { Session } from "../../core/session";
import openingsPack from "../openings-data/index";
import dataPack from "../pokemon-data/index";
import wordsPack from "../words-data/index";
import pack from "./index";
import { linkOf, roundish } from "./links";
import { countPartitions, defaultKinds, isLost, linkFacets, mistakesMade, oneAway, playable, poolOf, unique, type ConnPuzzle, type ConnState, type Params } from "./logic";

const registry = new Registry();
for (const p of [dataPack, wordsPack, openingsPack, pack]) p({ ...api, registry });
const def = registry.getPuzzle("connections")!;
const ds = registry.getDataset("pokemon")!;
const byId = new Map(ds.items().map((it) => [it.id, it]));
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, new AbortController().signal) as Promise<ConnPuzzle>;

test("the game knows no dataset: nothing in the pack imports pokémon code", () => {
  for (const f of readdirSync(new URL(".", import.meta.url)).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    expect([f, /from\s+"[^"]*(lib\/pokemon|pokemon-data)[^"]*"/.test(src)]).toEqual([f, false]);
  }
});

test("partitions are counted over every link, not only the intended ones", () => {
  // items 0-3 share link A, 4-7 link B: one way
  expect(countPartitions(8, 4, [[0, 1, 2, 3], [4, 5, 6, 7]])).toBe(1);
  // a third link crossing them (0,1,4,5 / 2,3,6,7) makes a second way
  expect(countPartitions(8, 4, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 4, 5], [2, 3, 6, 7]])).toBe(2);
  // a link with five members offers five groups of four
  expect(countPartitions(8, 4, [[0, 1, 2, 3, 4], [4, 5, 6, 7]])).toBe(1);
  expect(countPartitions(8, 4, [[0, 1, 2]])).toBe(0);
});

test("links are read back from their ids, off the dataset's attributes", () => {
  const pikachu = byId.get("pikachu")!, snorlax = byId.get("snorlax")!, charizard = byId.get("charizard")!;
  expect(linkOf(ds, "type:electric").test(pikachu)).toBe(true);
  expect(linkOf(ds, "type:electric").label).toBe("type: electric");
  expect(linkOf(ds, "weight>=200").test(snorlax)).toBe(true);
  expect(linkOf(ds, "weight>=200").test(pikachu)).toBe(false);
  expect(linkOf(ds, "type#2").test(charizard)).toBe(true);
  expect(linkOf(ds, "final").test(snorlax)).toBe(true);
  expect(linkOf(ds, "!final").test(pikachu)).toBe(true);
  // the evolution family is a category attribute like any other
  expect(linkOf(ds, `family:${String(pikachu.values.family)}`).test(byId.get("raichu")!)).toBe(true);
  expect(linkOf(ds, "nothing:here").test(pikachu)).toBe(false);
  expect([roundish(147), roundish(580), roundish(0.27), roundish(1234)]).toEqual([150, 600, 0.25, 1000]);
});

test("pokémon by default plays the narrow kinds, which hold the old defaults; broad ones and numbers are opt-in", () => {
  const kinds = defaultKinds(ds);
  for (const k of ["type", "gen", "class", "color", "shape", "egg", "ability", "gender", "family"]) expect(kinds).toContain(k);
  for (const k of ["stage", "final", "type#", "weight", "bst"]) expect(kinds).not.toContain(k);
});

test("generated boards: deterministic, every group fits its link, and the whole board splits only one way", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  const presets = def.presets!.filter((x) => x.params.dataset === "pokemon").map((x) => x.params);
  for (const [params, seed] of [[{}, "1"], [{ difficulty: "hard" }, "2"], [{ difficulty: "easy" }, "3"], [{ groups: 3, size: 3 }, "4"], [{ groups: 5, size: 5 }, "5"], [{ pool: "form:default gen:1" }, "6"], ...presets.map((x, i) => [x, `preset ${i}`])] as [Record<string, unknown>, string][]) {
    const p = await gen(params, seed);
    const groups = (params as { groups?: number }).groups ?? 4, size = (params as { size?: number }).size ?? 4;
    expect(p.dataset).toBe("pokemon");
    expect(p.items.length).toBe(groups * size);
    expect(new Set(p.items).size).toBe(p.items.length);
    expect(p.groups.map((g) => g.tier)).toEqual(Array.from({ length: groups }, (_, i) => i));
    expect(p.groups.flatMap((g) => g.items).sort()).toEqual(p.items.slice().sort());
    for (const g of p.groups) {
      expect(g.items.length).toBe(size);
      const f = linkOf(ds, g.link);
      for (const id of g.items) expect(f.test(byId.get(id)!)).toBe(true);
    }
    expect(unique(linkFacets(ds, p.kinds, poolOf(ds, p.pool)), p.items.map((id) => byId.get(id)!), size)).toBe(true);
    // one species at most once: the default pool has one form per species, and the forms preset asks for apart: dex
    const species = p.items.map((id) => byId.get(id)!.values.dex);
    expect(new Set(species).size).toBe(species.length);
  }
}, 120000);

test("guessing: a right group is found, a wrong one is a mistake, the same guess twice is ignored, and mistakes run out", async () => {
  const p = await gen({ mistakes: 2 }, "play");
  let s = def.init(p) as ConnState;
  const g = (items: string[]) => (s = def.reduce(p, s, { type: "guess", items }));
  g(p.groups[0]!.items);
  expect(mistakesMade(p, s)).toBe(0);
  const was = s;
  expect(g(p.groups[0]!.items)).toBe(was); // already found
  expect(g(p.groups[1]!.items.slice(0, 3))).toBe(was); // too few
  const near = [...p.groups[1]!.items.slice(0, 3), p.groups[2]!.items[0]!];
  g(near);
  expect(mistakesMade(p, s)).toBe(1);
  expect(oneAway(p, s)).toBe(true);
  const once = s;
  expect(g([...near].reverse())).toBe(once); // same group in another order
  g([p.groups[1]!.items[0]!, p.groups[1]!.items[1]!, p.groups[2]!.items[0]!, p.groups[2]!.items[1]!]);
  expect(oneAway(p, s)).toBe(false);
  expect(isLost(p, s)).toBe(true);
  expect(def.score!(p, s)).toBeNull();
  expect(g(p.groups[1]!.items)).toBe(s);
  const share = def.shareText!(p, s)!.split("\n");
  expect(share[0]).toBe("connections · pokémon (not solved)");
  expect(share[1]).toBe("🟨".repeat(4));
  expect(share.length).toBe(4);
});

test("revealing after a loss shows every group", async () => {
  const p = await gen({ mistakes: 1 }, "lose");
  const session = new Session(def, p, { kind: "imported" });
  const wrong = [p.groups[0]!.items[0]!, p.groups[1]!.items[0]!, p.groups[2]!.items[0]!, p.groups[3]!.items[0]!];
  session.dispatch({ type: "guess", items: wrong });
  expect(session.lost).toBe(true);
  expect(session.reveal()).toBe(true);
  expect(def.isSolved(p, session.state)).toBe(true);
});

test("a solved game scores its mistakes", async () => {
  const p = await gen({}, "win");
  let s = def.init(p) as ConnState;
  for (const grp of p.groups) s = def.reduce(p, s, { type: "guess", items: grp.items });
  expect(def.isSolved(p, s)).toBe(true);
  expect(def.score!(p, s)).toEqual({ value: 0, label: "0 mistakes", better: "lower" });
});

test("other datasets: offered only when their attributes make groups; one that is offered generates and plays", async () => {
  const offered = optionsOf(def.params!.dataset as EnumField, {}).map((o) => o.value);
  for (const d of registry.listDatasets()) expect([d.id, offered.includes(d.id)]).toEqual([d.id, playable(d)]);
  // english words: lengths are numbers and how common splits them too evenly, so nothing to group by
  expect(offered).not.toContain("words");
  expect(offered).toContain("openings");
  const openings = registry.getDataset("openings")!;
  const one = new Map(openings.items().map((it) => [it.id, it]));
  const preset = def.presets!.find((x) => x.params.dataset === "openings")!;
  for (const seed of ["o1", "o2"]) {
    const p = await gen(preset.params, seed);
    expect(p.dataset).toBe("openings");
    const v = resolve(def.params as Params, preset.params);
    expect(p.items.length).toBe(v.groups * v.size);
    for (const g of p.groups) for (const id of g.items) expect(linkOf(openings, g.link).test(one.get(id)!)).toBe(true);
    expect(unique(linkFacets(openings, p.kinds, poolOf(openings, p.pool)), p.items.map((id) => one.get(id)!), v.size)).toBe(true);
    // openings reached by two move orders share a name; tiles never do
    const names = p.items.map((id) => one.get(id)!.name);
    expect(new Set(names).size).toBe(names.length);
    let s = def.init(p) as ConnState;
    for (const grp of p.groups) s = def.reduce(p, s, { type: "guess", items: grp.items });
    expect(def.isSolved(p, s)).toBe(true);
    expect(def.shareText!(p, s)!.split("\n")[0]).toBe("connections · chess openings");
    expect(def.rules!(p)[0]).toContain("openings");
  }
}, 60000);
