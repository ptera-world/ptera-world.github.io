import { expect, test } from "bun:test";
import { api } from "../../api";
import { Registry } from "../../core/registry";
import type { Dataset } from "../../core/types";
import { playSan } from "../../lib/chess/chess";
import { compile } from "../../lib/dataset/query";
import { validLine } from "./build";
import dataPack from "./index";
import type { OpeningItem } from "./types";

const registry = new Registry();
dataPack({ ...api, registry });
const ds = registry.getDataset("openings") as Dataset<OpeningItem>;
const items = ds.items();
const byName = (name: string) => items.filter((i) => i.name === name);

test("openings: registered, every line legal from the start, ids unique", () => {
  expect(items.length).toBeGreaterThan(3000);
  expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  for (const it of items) {
    expect(() => playSan(it.moves)).not.toThrow();
    expect(it.values.plies).toBe(it.moves.length);
  }
});

test("openings: attribute values are declared, and the pools all read", () => {
  for (const a of ds.attributes) {
    if (!a.values) continue;
    const known = new Set(a.values.map((v) => v.value));
    for (const it of items) expect(known.has(String(it.values[a.id]))).toBe(true);
  }
  for (const f of ds.featured ?? []) expect(ds.attributes.some((a) => a.id === f)).toBe(true);
  for (const pool of ds.pools ?? []) expect(items.filter(compile(pool.query, ds.attributes)).length).toBeGreaterThan(0);
});

// well-known lines: the Sicilian is 1. e4 c5 (B20), the Ruy Lopez 1. e4 e5 2. Nf3 Nc6 3. Bb5 (C60)
test("openings: known lines", () => {
  const sicilian = byName("Sicilian Defense").find((i) => i.moves.join(" ") === "e4 c5")!;
  expect(sicilian.values).toMatchObject({ eco: "B20", volume: "B", family: "sicilian-defense", variation: false, plies: 2, first: "e4", pgn: "1. e4 c5" });
  expect(sicilian.id).toBe("e4.c5");
  const ruy = byName("Ruy Lopez").find((i) => i.moves.join(" ") === "e4 e5 Nf3 Nc6 Bb5")!;
  expect(ruy.values.eco).toBe("C60");
  const ids = (q: string) => items.filter(compile(q, ds.attributes)).map((i) => i.id);
  expect(ids("family:siciliandefense eco:B20")).toContain("e4.c5");
  expect(ids("eco:C60-C99 !family:ruy-lopez").length).toBeLessThan(ids("eco:C60-C99").length);
  expect(items.find((i) => i.name.startsWith("Grünfeld"))!.aliases?.[0]).toStartWith("Grunfeld");
});

test("openings build: rejects illegal or non-standard SAN", () => {
  expect(validLine("1. e4 e5 2. Nf3")).toEqual(["e4", "e5", "Nf3"]);
  expect(() => validLine("1. e4 e4")).toThrow(/isn't legal/);
  expect(() => validLine("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7")).toThrow(/lib\/chess writes "Qxf7#"/);
});
