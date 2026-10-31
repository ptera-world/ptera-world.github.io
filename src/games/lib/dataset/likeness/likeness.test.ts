import { expect, test } from "bun:test";
import { api } from "../../../api";
import { Registry } from "../../../core/registry";
import dataPack from "../../../packs/pokemon-data/index";
import { embed } from "./mds";
import { closeness, Space, weightsFor } from "./similarity";
import { tsne } from "./tsne";

const registry = new Registry();
dataPack({ ...api, registry });
const data = registry.getDataset("pokemon")!;
const balanced = weightsFor(data, "balanced");
const species = data.items().filter((i) => (i as unknown as { form: string }).form === "default");
const scored = (id: string) => {
  const space = new Space(species, data.attributes, balanced);
  const answer = species.findIndex((it) => it.id === id);
  return { space, answer, close: closeness(space, answer), index: new Map(species.map((it, i) => [it.id, i])) };
};

test("the answer ranks #1, everything else #2 or below, closer always ranks better", () => {
  const sc = scored("charmander");
  expect(sc.close[sc.answer]!.rank).toBe(1);
  expect(sc.close[sc.answer]!.temp).toBe(100);
  const d = sc.space.row(sc.answer);
  for (let j = 0; j < species.length; j++) {
    if (j === sc.answer) continue;
    expect(sc.close[j]!.rank).toBeGreaterThanOrEqual(2);
    for (const k of [0, 100, 500]) if (k !== sc.answer && d[j]! < d[k]!) expect(sc.close[j]!.rank).toBeLessThan(sc.close[k]!.rank);
  }
});

test("under pokémon's balanced weights an evolution ranks closest, and same-type starters come soon after", () => {
  const sc = scored("charmander");
  const rank = (id: string) => sc.close[sc.index.get(id)!]!.rank;
  expect(rank("charmeleon")).toBe(2);
  expect(rank("charizard")).toBeLessThan(10);
  expect(rank("cyndaquil")).toBeLessThan(40);
  expect(rank("blastoise")).toBeGreaterThan(rank("cyndaquil"));
});

test("without a profile, the featured attributes weigh evenly", () => {
  expect(weightsFor(data, "")).toEqual(Object.fromEntries(data.featured!.map((id) => [id, 1])));
});

test("the map is deterministic and keeps neighbourhoods better than plain MDS", async () => {
  const items = species.filter((i) => i.values.gen === "1");
  const space = new Space(items, data.attributes, balanced);
  const start = embed(space);
  expect(embed(space)).toEqual(start);
  const map = await tsne(space, start, { iterations: 300 });
  expect(await tsne(space, start, { iterations: 300 })).toEqual(map);
  expect(map.every((v) => v >= 0 && v <= 1)).toBe(true);
  const kept = (xy: Float64Array) => {
    let hits = 0;
    for (let i = 0; i < space.n; i++) {
      const others = [...Array(space.n).keys()].filter((j) => j !== i);
      const truth = new Set(others.sort((a, b) => space.dist(i, a) - space.dist(i, b)).slice(0, 10));
      const near = others.sort((a, b) => Math.hypot(xy[2 * a]! - xy[2 * i]!, xy[2 * a + 1]! - xy[2 * i + 1]!) - Math.hypot(xy[2 * b]! - xy[2 * i]!, xy[2 * b + 1]! - xy[2 * i + 1]!)).slice(0, 10);
      hits += near.filter((j) => truth.has(j)).length;
    }
    return hits / (10 * space.n);
  };
  expect(kept(map)).toBeGreaterThan(kept(start) * 1.5);
}, 30000);
