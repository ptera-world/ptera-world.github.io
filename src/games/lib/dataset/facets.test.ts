import { expect, test } from "bun:test";
import { api } from "../../api";
import { Registry } from "../../core/registry";
import pokemonPack from "../../packs/pokemon-data/index";
import { POOL_PRESETS } from "../pokemon/pool";
import { formatPicks, parsePicks, pickable } from "./facets";
import { filter } from "./query";

const registry = new Registry();
pokemonPack({ ...api, registry });
const d = registry.getDataset("pokemon")!;
const count = (q: string) => { const r = filter(d.items(), q, d.attributes); if ("error" in r) throw new Error(r.error); return r.items.length; };

test("every pool preset reads as picks and writes back to a query keeping the same pokémon", () => {
  for (const p of POOL_PRESETS) {
    const picks = parsePicks(p.pool, d.attributes);
    expect([p.label, picks !== null]).toEqual([p.label, true]);
    expect([p.label, count(formatPicks(picks!, d.attributes))]).toEqual([p.label, count(p.pool)]);
  }
});

test("picks write queries the filter reads: values, ranges, yes/no", () => {
  const q = formatPicks({ type: { kind: "values", values: ["water", "fire"] }, bst: { kind: "range", min: 500 }, final: { kind: "bool", value: true } }, d.attributes);
  expect(q).toBe("type:fire,water bst>=500 final");
  expect(count(q)).toBeGreaterThan(0);
  expect(parsePicks(q, d.attributes)).toEqual({ type: { kind: "values", values: ["fire", "water"] }, bst: { kind: "range", min: 500 }, final: { kind: "bool", value: true } });
});

test("what picks can't say is left as it is", () => {
  expect(parsePicks("type:fire | type:water", d.attributes)).toBeNull();
  expect(parsePicks("entry:lightning", d.attributes)).toBeNull();
  // abilities have hundreds of values: not offered to tap
  expect(pickable(d.attributes).map((a) => a.id)).not.toContain("ability");
});
