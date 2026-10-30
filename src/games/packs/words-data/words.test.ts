import { expect, test } from "bun:test";
import { api } from "../../api";
import { Registry } from "../../core/registry";
import { filter } from "../../lib/dataset/query";
import { frontCode, frontDecode } from "./codec";
import pack from "./index";

const registry = new Registry();
pack({ ...api, registry });
const data = registry.getDataset("words")!;
const items = data.items();
const pool = (query: string) => {
  const r = filter(items, query, data.attributes);
  if ("error" in r) throw new Error(`${query}: ${r.error}`);
  return r.items;
};

test("the pack registers the dataset, built once", () => {
  expect(data.id).toBe("words");
  expect(data.items()).toBe(items);
  expect(items.length).toBeGreaterThan(200_000);
});

test("ids are unique lowercase a-z words, named as themselves, length read off the word", () => {
  expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  for (const it of items) {
    if (!/^[a-z]+$/.test(it.id) || it.name !== it.id || it.values.length !== it.id.length) throw new Error(`bad item ${JSON.stringify(it)}`);
  }
});

test("every attribute value is one the attribute declares", () => {
  for (const a of data.attributes) {
    if (!a.values) continue;
    const ok = new Set(a.values.map((v) => v.value));
    for (const it of items) {
      const v = it.values[a.id];
      for (const x of Array.isArray(v) ? v : [v]) if (!ok.has(String(x))) throw new Error(`${it.id}: ${a.id} ${x}`);
    }
  }
});

test("pools: every one compiles, the first is the default answer pool, the last is every word", () => {
  const pools = data.pools!;
  const counts = Object.fromEntries(pools.map((p) => [p.label, pool(p.query).length]));
  // a five-letter answer pool about the size of wordle's (about 2,300 answers)
  expect(counts["common five-letter words"]).toBeGreaterThan(1500);
  expect(counts["common five-letter words"]).toBeLessThan(5000);
  for (const p of pools.slice(0, -1)) expect(pool(p.query).length).toBeGreaterThan(500);
  // guesses: far more five-letter words are accepted than are answers
  expect(counts["five-letter words"]).toBeGreaterThan(counts["common five-letter words"]! * 2);
  expect(pools.at(-1)!.query).toBe("");
  expect(counts["every word"]).toBe(items.length);
  // answers are a subset of guesses
  const guesses = new Set(pool("length:5").map((i) => i.id));
  expect(pool(pools[0]!.query).every((i) => guesses.has(i.id))).toBe(true);
});

test("pools leave out regional spellings and offensive words", () => {
  const answers = new Set(pool(data.pools![0]!.query).map((i) => i.id));
  const color = items.filter((i) => i.id === "color" || i.id === "colour");
  expect(color.map((i) => i.id).sort()).toEqual(["color", "colour"]);
  expect(pool("offensive").length).toBeGreaterThan(0);
  for (const it of pool("offensive")) expect(answers.has(it.id)).toBe(false);
  for (const it of pool("length:5 !spelling:us | length:5 !spelling:gb")) expect(answers.has(it.id)).toBe(false);
});

test("front coding round-trips, including long shared prefixes", () => {
  const words = ["a", "ab", "abc", "abd", "b", "x".repeat(40), "x".repeat(45), "xy"];
  expect(frontDecode(frontCode(words))).toEqual(words);
});
