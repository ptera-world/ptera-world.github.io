import { expect, test } from "bun:test";
import { decode, encode, type PokemonDataFile } from "./codec";
import { parseCsv, parseShowdown } from "../../packs/pokemon-data/build";

const file = (await Bun.file(new URL("../../packs/pokemon-data/data.json", import.meta.url)).json()) as PokemonDataFile;
const items = decode(file);

test("the stored file decodes and encodes back to itself", () => {
  const again = encode(items, file.attributes, { version: file.version, credits: file.credits, typeChart: file.typeChart });
  expect(again).toEqual(file);
});

test("every item has a value slot for every attribute, and ids are unique", () => {
  expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  for (const i of items) expect(Object.keys(i.values).sort()).toEqual(file.attributes.map((a) => a.id).sort());
});

test("category, ordinal and set values are among the attribute's declared values", () => {
  for (const a of file.attributes) {
    if (!a.values) continue;
    const allowed = new Set(a.values.map((v) => v.value));
    for (const i of items) {
      const v = i.values[a.id];
      if (v === null || v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) expect(allowed.has(String(x))).toBe(true);
    }
  }
});

test("one default form per national dex number, 1 to 1025", () => {
  const defaults = items.filter((i) => i.form === "default").map((i) => i.species).sort((a, b) => a - b);
  expect(defaults).toEqual(Array.from({ length: 1025 }, (_, k) => k + 1));
});

test("csv fields may hold quotes, commas and newlines", () => {
  expect(parseCsv('a,b\n1,"x, ""y""\nz"\n2,\n')).toEqual([{ a: "1", b: 'x, "y"\nz' }, { a: "2", b: "" }]);
});

test("showdown entries: base species by number, forms and negative fan entries skipped", () => {
  const text = `export const Pokedex = {
\tpikachu: {
\t\tnum: 25,
\t\tname: "Pikachu",
\t\ttags: ["Mythical"],
\t},
\tpikachucosplay: {
\t\tnum: 25,
\t\tbaseSpecies: "Pikachu",
\t\ttags: ["Restricted Legendary"],
\t},
\tsyclant: {
\t\tnum: -1,
\t\ttags: ["Sub-Legendary"],
\t},
};`;
  expect([...parseShowdown(text).values()]).toEqual([{ num: 25, tags: ["Mythical"] }]);
});
