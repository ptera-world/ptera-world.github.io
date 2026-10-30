import { expect, test } from "bun:test";
import type { DataAttribute } from "../../core/types";
import { decode, type PokemonDataFile } from "../pokemon/codec";
import { compare, consistent, compareItems, parseBands } from "./compare";
import { compile, filter } from "./query";
import { matchNames, normalizeName } from "./names";

const file = (await Bun.file(new URL("../../packs/pokemon-data/data.json", import.meta.url)).json()) as PokemonDataFile;
const items = decode(file);
const attrs = file.attributes;
const attr = (id: string) => attrs.find((a) => a.id === id)!;
const get = (id: string) => items.find((i) => i.id === id)!;
const ids = (q: string) => (filter(items, q, attrs) as { items: typeof items }).items.map((i) => i.id);

// --- the published facts these checks lean on are pokémon basics: Charizard is fire/flying from
// gen 1, Mew is mythical, Bulbasaur is grass/poison, mono-fire gen 1 starters' line is Charmander's

test("query: terms side by side all hold; | means either; ! negates", () => {
  expect(ids("type:fire type:flying gen:1 form:default")).toEqual(["charizard", "moltres"]);
  expect(ids("name:charmander | name:squirtle")).toEqual(["charmander", "squirtle"]);
  const notFire = ids("gen:1 form:default !type:fire");
  expect(notFire).not.toContain("charmander");
  expect(notFire).toContain("bulbasaur");
  expect(ids("gen:1 form:default -(type:fire | type:water | type:grass)")).not.toContain("bulbasaur");
});

test("query: sets — `:` has any of, `=` exactly", () => {
  const anyFire = ids("gen:1 form:default type:fire");
  const monoFire = ids("gen:1 form:default type=fire");
  expect(anyFire).toContain("charizard");
  expect(monoFire).not.toContain("charizard");
  expect(monoFire).toContain("charmander");
  expect(ids("form:default type=poison,grass")).toContain("bulbasaur");
});

test("query: ordinals and numbers take ranges and comparisons", () => {
  expect(ids("gen:1-2 form:default").length).toBe(251);
  expect(ids("gen<=2 form:default").length).toBe(251);
  expect(ids("gen>8 form:default").length).toBe(1025 - 905);
  expect(ids("bst>=700 form:default").every((id) => (get(id).values.bst as number) >= 700)).toBe(true);
  expect(ids("dex:25")).toContain("pikachu");
});

test("query: bare words are yes/no attributes or a value only one attribute has", () => {
  expect(ids("final gen:1 form:default")).toContain("charizard");
  expect(ids("final gen:1 form:default")).not.toContain("charmander");
  expect(ids("mythical")).toContain("mew");
  expect(ids("mega").every((id) => get(id).form === "mega")).toBe(true);
});

test("query: labels work as well as ids, and case and spaces don't matter", () => {
  expect(ids("Generation:1 Form:Standard Class:Mythical")).toEqual(["mew"]);
  expect(ids("bodyshape:quadruped gen:1 form:default type:fire")).toContain("ponyta");
});

test("query: mistakes say what is wrong and where", () => {
  for (const [q, msg] of [
    ["colour:red", "no attribute"],
    ["type:fiire", "has no"],
    ["color>red", "no order"],
    ["(type:fire", "isn't closed"],
    ["type:fire)", "no opening"],
    ["blorp", "isn't an attribute or a value"],
  ] as const) {
    const r = filter(items, q, attrs);
    expect("error" in r ? r.error : "").toContain(msg);
  }
  expect(compile("", attrs)(get("pikachu"))).toBe(true);
});

test("compare: numbers say which way; close only within a band the game gives", () => {
  const w = attr("weight");
  expect(compare(w, 10, 10)).toEqual({ verdict: "match" });
  expect(compare(w, 10, 11)).toEqual({ verdict: "miss", dir: "higher" });
  expect(compare(w, 10, 11, { weight: { rel: 0.2 } })).toEqual({ verdict: "close", dir: "higher" });
  expect(compare(w, 10, 20, { weight: { rel: 0.2 } })).toEqual({ verdict: "miss", dir: "higher" });
  expect(compare(attr("gen"), "3", "4")).toEqual({ verdict: "miss", dir: "higher" });
  expect(compare(attr("gen"), "3", "4", { gen: { abs: 1 } })).toEqual({ verdict: "close", dir: "higher" });
  expect(compare(attr("gen"), "3", "1", { gen: { abs: 1 } })).toEqual({ verdict: "miss", dir: "lower" });
});

test("datasets carry no close bands: closeness is a game's setting, not a fact about the data", async () => {
  for (const pack of ["pokemon-data", "words-data", "openings-data"]) {
    const j = JSON.parse(await Bun.file(new URL(`../../packs/${pack}/data.json`, import.meta.url)).text()) as { attributes: object[] };
    for (const a of j.attributes) expect("near" in a).toBe(false);
  }
});

test("compare: sets as sets — order doesn't matter, overlap is partial", () => {
  const t = attr("type");
  expect(compare(t, ["flying", "fire"], ["fire", "flying"]).verdict).toBe("match");
  expect(compare(t, ["fire"], ["fire", "flying"])).toEqual({ verdict: "partial", shared: ["fire"] });
  expect(compare(t, ["fire", "flying"], ["fire"])).toEqual({ verdict: "partial", shared: ["fire"] });
  expect(compare(t, ["water"], ["fire"])).toEqual({ verdict: "miss", shared: [] });
});

test("compare: the answer is always consistent with its own feedback, and narrows", () => {
  const shown = attrs.filter((a) => a.kind !== "text");
  const answer = get("garchomp"), guess = get("pikachu");
  const fb = compareItems(shown, guess, answer);
  expect(consistent(shown, guess, fb, answer)).toBe(true);
  const left = items.filter((c) => consistent(shown, guess, fb, c));
  expect(left.length).toBeLessThan(10);
  expect(left).toContain(answer);
});

test("bands: amounts, percentages and off", () => {
  expect(parseBands("weight:25%, gen:2, height:off", attrs)).toEqual({ weight: { rel: 0.25 }, gen: { abs: 2 }, height: null });
  expect(() => parseBands("color:2", attrs)).toThrow("isn't a number attribute");
  expect(() => parseBands("gen:10%", attrs)).toThrow("steps");
});

test("names: what people type finds the pokémon", () => {
  expect(normalizeName("Farfetch’d")).toBe(normalizeName("farfetchd"));
  expect(normalizeName("Flabébé")).toBe("flabebe");
  const first = (q: string) => matchNames(items, q, 5)[0]?.id;
  expect(first("pika")).toBe("pikachu");
  expect(first("mr mime")).toBe("mr-mime");
  expect(first("nidoran f")).toBe("nidoran-f");
  expect(first("type null")).toBe("type-null");
  expect(first("ho-oh")).toBe("ho-oh");
  expect(first("alolan raichu")).toBe("raichu-alola");
  expect(matchNames(items, "", 5)).toEqual([]);
});

const _typecheck: readonly DataAttribute[] = attrs;
void _typecheck;
