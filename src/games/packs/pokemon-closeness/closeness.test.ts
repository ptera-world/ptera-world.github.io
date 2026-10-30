import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import dataPack from "../pokemon-data/index";
import pack from "./index";
import { makeCloseness, type ClosenessPuzzle, type ClosenessState } from "./logic";
import { embed } from "./mds";
import { resolveWeights, Space } from "./similarity";
import { tsne } from "./tsne";

const registry = new Registry();
dataPack({ ...api, registry });
pack({ ...api, registry });
const data = registry.getDataset("pokemon")!;
const game = makeCloseness(() => data);
const def = game.def;
const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, sig()) as Promise<ClosenessPuzzle>;
const balanced = resolveWeights("balanced", "", data.attributes);
const puzzle = (answer: string, pool = "form:default"): ClosenessPuzzle => ({ pool, answer, weights: balanced });

test("generation is deterministic, and the answer is in the pool", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  for (let i = 0; i < 10; i++) {
    const p = await gen({ pool: "form:default gen:1" }, `s${i}`);
    expect(game.scored(p).items.find((it) => it.id === p.answer)?.values.gen).toBe("1");
  }
});

test("the answer ranks #1, everything else #2 or below, closer always ranks better", () => {
  const sc = game.scored(puzzle("charmander"));
  expect(sc.close[sc.answer]!.rank).toBe(1);
  expect(sc.close[sc.answer]!.temp).toBe(100);
  const d = sc.space.row(sc.answer);
  for (let j = 0; j < sc.items.length; j++) {
    if (j === sc.answer) continue;
    expect(sc.close[j]!.rank).toBeGreaterThanOrEqual(2);
    for (const k of [0, 100, 500]) if (k !== sc.answer && d[j]! < d[k]!) expect(sc.close[j]!.rank).toBeLessThan(sc.close[k]!.rank);
  }
});

test("under the balanced weights an evolution ranks closest, and same-type starters come soon after", () => {
  const sc = game.scored(puzzle("charmander"));
  const rank = (id: string) => sc.close[sc.index.get(id)!]!.rank;
  expect(rank("charmeleon")).toBe(2);
  expect(rank("charizard")).toBeLessThan(10);
  expect(rank("cyndaquil")).toBeLessThan(40);
  expect(rank("blastoise")).toBeGreaterThan(rank("cyndaquil"));
});

test("guesses: only pool members, once each; the answer ends the game", () => {
  const p = puzzle("pikachu", "form:default gen:1");
  let s: ClosenessState = def.init(p);
  expect(def.reduce(p, s, { type: "guess", id: "chikorita" })).toBe(s);
  s = def.reduce(p, s, { type: "guess", id: "raichu" });
  expect(def.reduce(p, s, { type: "guess", id: "raichu" })).toBe(s);
  expect(def.isSolved(p, s)).toBe(false);
  s = def.reduce(p, s, { type: "guess", id: "pikachu" });
  expect(def.isSolved(p, s)).toBe(true);
  expect(def.reduce(p, s, { type: "guess", id: "mew" })).toBe(s);
  expect(def.score!(p, s)).toEqual({ value: 2, label: "guesses", better: "lower" });
});

test("a hint guesses something ranked better than your best, about halfway to the answer", () => {
  const p = puzzle("gengar");
  const sc = game.scored(p);
  let s: ClosenessState = def.init(p);
  s = def.reduce(p, s, { type: "guess", id: "magikarp" });
  const before = game.best(p, s);
  const h = def.hint!(p, s)!;
  s = def.reduce(p, s, h.actions![0]!);
  const after = game.best(p, s);
  expect(after).toBeLessThan(before);
  expect(after).toBeLessThanOrEqual(Math.floor(before / 2));
  expect(s.hinted).toHaveLength(1);
  // a hint never repeats a guess, down to the answer itself
  for (let k = 0; k < 20 && !def.isSolved(p, s); k++) s = def.reduce(p, s, def.hint!(p, s)!.actions![0]!);
  expect(def.isSolved(p, s)).toBe(true);
  expect(new Set(s.guesses).size).toBe(s.guesses.length);
  expect(sc.close[sc.answer]!.rank).toBe(1);
});

test("giving up reveals the answer, ends unsolved, and the share text says so without naming it", async () => {
  const p = await gen({}, "reveal");
  const session = new Session(def, p, { kind: "generated", seed: "reveal", params: {}, generatorVersion: def.generatorVersion });
  session.dispatch({ type: "guess", id: p.answer === "bulbasaur" ? "ivysaur" : "bulbasaur" });
  expect(session.reveal()).toBe(true);
  expect(session.outcome).toBe("revealed");
  const text = def.shareText!(p, session.state)!;
  expect(text).toContain("revealed after 1 guess");
  const name = game.scored(p).items.find((it) => it.id === p.answer)!.name;
  expect(text.toLowerCase()).not.toContain(name.toLowerCase());
});

test("weights: a tweak lays over the profile; bad ones say what's wrong", () => {
  expect(resolveWeights("balanced", "type:6, color:0", data.attributes)).toMatchObject({ type: 6, family: 3 });
  expect("color" in resolveWeights("balanced", "color:0", data.attributes)).toBe(false);
  expect(() => resolveWeights("balanced", "entry:2", data.attributes)).toThrow(/isn't something to weigh/);
  expect(() => resolveWeights("balanced", "type", data.attributes)).toThrow(/attribute:weight/);
  expect(() => resolveWeights("looks", Object.keys(resolveWeights("looks", "", data.attributes)).map((k) => `${k}:0`).join(","), data.attributes)).toThrow(/every weight is zero/);
});

test("the map is deterministic and keeps neighbourhoods better than plain MDS", async () => {
  const items = data.items().filter((i) => i.form === "default" && i.values.gen === "1");
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
