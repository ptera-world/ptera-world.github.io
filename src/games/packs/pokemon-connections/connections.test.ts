import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { facet } from "../../lib/pokemon/facets";
import dataPack from "../pokemon-data/index";
import pack from "./index";
import { poolOf } from "../../lib/pokemon/pool";
import { countPartitions, isLost, linkFacets, mistakesMade, oneAway, unique, type ConnPuzzle, type ConnState } from "./logic";

const registry = new Registry();
dataPack({ ...api, registry });
pack({ ...api, registry });
const def = registry.getPuzzle("pokemon-connections")!;
const ds = registry.getDataset("pokemon")!;
const byId = new Map(ds.items().map((it) => [it.id, it]));
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, new AbortController().signal) as Promise<ConnPuzzle>;

test("partitions are counted over every link, not only the intended ones", () => {
  // items 0-3 share link A, 4-7 link B: one way
  expect(countPartitions(8, 4, [[0, 1, 2, 3], [4, 5, 6, 7]])).toBe(1);
  // a third link crossing them (0,1,4,5 / 2,3,6,7) makes a second way
  expect(countPartitions(8, 4, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 4, 5], [2, 3, 6, 7]])).toBe(2);
  // a link with five members offers five groups of four
  expect(countPartitions(8, 4, [[0, 1, 2, 3, 4], [4, 5, 6, 7]])).toBe(1);
  expect(countPartitions(8, 4, [[0, 1, 2]])).toBe(0);
});

test("generated boards: deterministic, every group fits its link, and the whole board splits only one way", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  for (const [params, seed] of [[{}, "1"], [{ difficulty: "hard" }, "2"], [{ difficulty: "easy" }, "3"], [{ groups: 3, size: 3 }, "4"], [{ groups: 5, size: 5 }, "5"], [{ pool: "form:default gen:1" }, "6"]] as const) {
    const p = await gen(params, seed);
    const groups = (params as { groups?: number }).groups ?? 4, size = (params as { size?: number }).size ?? 4;
    expect(p.items.length).toBe(groups * size);
    expect(new Set(p.items).size).toBe(p.items.length);
    expect(p.groups.map((g) => g.tier)).toEqual(Array.from({ length: groups }, (_, i) => i));
    expect(p.groups.flatMap((g) => g.items).sort()).toEqual(p.items.slice().sort());
    for (const g of p.groups) {
      expect(g.items.length).toBe(size);
      const f = facet(ds, g.link);
      for (const id of g.items) expect(f.test(byId.get(id)!)).toBe(true);
    }
    expect(unique(linkFacets(ds, p.kinds, poolOf(ds, p.pool)), p.items.map((id) => byId.get(id)!), size)).toBe(true);
    // one species at most once, so no two tiles look alike
    const species = p.items.map((id) => byId.get(id)!.species);
    expect(new Set(species).size).toBe(species.length);
  }
}, 60000);

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
  expect(share[0]).toBe("pokémon connections (not solved)");
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
  expect(def.score!(p, s)).toEqual({ value: 0, label: "mistakes", better: "lower" });
});
