import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { resolve } from "../../core/schema";
import { Session } from "../../core/session";
import dataPack from "../pokemon-data/index";
import wordsPack from "../words-data/index";
import openingsPack from "../openings-data/index";
import { criteria, criterion, gridable, nice } from "./criteria";
import pack from "./index";
import { analyse, assignment, rarity, type GridPuzzle, type GridState } from "./logic";

const registry = new Registry();
for (const p of [dataPack, wordsPack, openingsPack, pack]) p({ ...api, registry });
const def = registry.getPuzzle("pokedoku")!;
const ds = registry.getDataset("pokemon")!;
const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, sig()) as Promise<GridPuzzle>;

/** What the grid asked on pokémon before it took any dataset; the pokémon presets ask the same. */
const CLASSIC = ["type", "gen", "class", "stage", "final", "form", "height", "weight", "bst", "hp", "atk", "def", "spa", "spd", "spe"];

test("generation is deterministic and every square has at least the asked-for answers, with a full distinct assignment", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  const cases: [Record<string, unknown>, string][] = [[{ ask: CLASSIC }, "x"], [{ answers: 1, difficulty: "hard" }, "h"], [{ rows: 4, cols: 4, answers: 5, ask: CLASSIC }, "big"], [{ ask: ["type", "gen", "ability"], answers: 2 }, "ab"], [{ pool: "form:default gen:1", answers: 2 }, "g1"]];
  for (const [params, seed] of cases) {
    const p = await gen(params, seed);
    expect(p.dataset).toBe("pokemon");
    const a = analyse(ds, p);
    const k = (params as { answers?: number }).answers ?? 3;
    for (const ans of a.answers) expect(ans.length).toBeGreaterThanOrEqual(k);
    const board = assignment(a.answers)!;
    expect(new Set(board).size).toBe(board.length);
    board.forEach((id, c) => expect(a.answers[c]).toContain(id));
    // no criterion twice, and no square whose answers are all of one of its criteria's
    expect(new Set([...p.rows, ...p.cols]).size).toBe(p.rows.length + p.cols.length);
    for (const [c, ans] of a.answers.entries()) {
      const r = criterion(ds, p.rows[Math.floor(c / p.cols.length)]!), col = criterion(ds, p.cols[c % p.cols.length]!);
      const nr = a.pool.filter(r.test).length, nc = a.pool.filter(col.test).length;
      expect(ans.length).toBeLessThan(Math.min(nr, nc));
    }
  }
});

test("an impossible ask says what to change", async () => {
  await expect(gen({ answers: 50, pool: "form:default gen:1", ask: ["ability"] }, "z")).rejects.toThrow("allow fewer answers");
});

test("criteria come from the attributes: values, set sizes, yes or no, round thresholds", () => {
  const fire = criterion(ds, "type:fire");
  expect([fire.label, fire.chip?.label]).toEqual(["type: fire", "fire"]);
  expect(fire.chip?.color).toBeTruthy();
  const charizard = ds.items().find((i) => i.id === "charizard")!;
  expect(fire.test(charizard)).toBe(true);
  expect(criterion(ds, "type#2").test(charizard)).toBe(true);
  expect(criterion(ds, "type#1").test(charizard)).toBe(false);
  expect(criterion(ds, "final").test(charizard)).toBe(true);
  expect(criterion(ds, "!final").test(charizard)).toBe(false);
  expect(criterion(ds, "weight>=90").test(charizard)).toBe(true);
  expect(criterion(ds, "weight>=90").label).toBe("weight 90 kg or more");
  expect(criterion(ds, "gen:1").detail).toBe(ds.attributes.find((a) => a.id === "gen")!.description);
  // ids the dataset can't read match nothing
  for (const id of ["typing:dual", "type:plastic", "entry:fire", "nope>=3"]) expect(criterion(ds, id).test(charizard)).toBe(false);
  // every catalog id reads back to itself, and thresholds are round
  for (const f of criteria(ds)) expect(criterion(ds, f.id).id).toBe(f.id);
  for (const f of criteria(ds, ["bst", "weight", "height", "spe"])) {
    const n = Number(/[<>]=(.+)$/.exec(f.id)![1]);
    expect(nice(n)).toBe(n);
  }
  expect([nice(583), nice(130), nice(0.47), nice(7.2)]).toEqual([600, 150, 0.5, 7]);
});

const fixed: GridPuzzle = { dataset: "pokemon", rows: ["type:fire", "type:water"], cols: ["gen:1", "type#2"], pool: "form:default", guesses: 5 };

test("right answers fill, wrong ones cost a guess, and nothing is used twice", () => {
  let s = def.init(fixed) as GridState;
  const g = (cell: number, item: string) => (s = def.reduce(fixed, s, { type: "guess", cell, item }));
  g(0, "charmander");
  expect(s.cells[0]).toBe("charmander");
  const was = s;
  expect(g(1, "charmander")).toBe(was); // already used
  expect(g(0, "vulpix")).toBe(was); // square taken
  expect(g(1, "mega-charizard-x")).toBe(was); // not in play
  g(1, "squirtle"); // water, not fire
  expect(s.wrong).toEqual([{ cell: 1, item: "squirtle" }]);
  const once = s;
  expect(g(1, "squirtle")).toBe(once); // the same miss again is ignored
  g(1, "charizard");
  g(2, "squirtle");
  expect(def.isLost!(fixed, s)).toBe(false);
  g(3, "pikachu"); // fifth guess, wrong: out of guesses
  expect(def.isLost!(fixed, s)).toBe(true);
  expect(g(3, "lapras")).toBe(s);
});

test("rarity: 100 ÷ answers for a filled square, 100 for an empty one", () => {
  const a = analyse(ds, fixed);
  const s: GridState = { cells: ["charmander", null, null, null], wrong: [] };
  expect(rarity(a, s)).toBe(Math.round(100 / a.answers[0]!.length + 300));
  expect(def.score!(fixed, s)).toEqual({ value: rarity(a, s), label: `rarity ${rarity(a, s)}`, better: "lower" });
  expect(def.shareText!(fixed, s)).toBe(`pokémon grid 1/4\n🟩⬜\n⬜⬜\nrarity ${rarity(a, s)}`);
});

test("revealing keeps the player's squares when they still leave a full answer", () => {
  const s: GridState = { cells: [null, "charizard", null, null], wrong: [] };
  const session = new Session(def, fixed, { kind: "imported" }, { state: s });
  expect(session.reveal()).toBe(true);
  expect((session.state as GridState).cells[1]).toBe("charizard");
  expect(def.isSolved(fixed, session.state)).toBe(true);
});

test("a puzzle saved before the dataset was a setting is read as pokémon", () => {
  const { dataset: _, ...old } = fixed;
  const legacy = old as GridPuzzle;
  expect(def.datasetsOf!(legacy)).toEqual(["pokemon"]);
  expect(def.reduce(legacy, def.init(legacy), { type: "guess", cell: 0, item: "charmander" }).cells[0]).toBe("charmander");
});

test("assignment respects fixed squares and finds a way round blocked ones", () => {
  expect(assignment([["a"], ["a", "b"]])).toEqual(["a", "b"]);
  expect(assignment([["a", "b"], ["a"]])).toEqual(["b", "a"]);
  expect(assignment([["a", "b"], ["a"]], ["a", null])).toBeNull();
});

test("other datasets: offered, given a preset of the largest grid their defaults fill, generated and played through to solved", async () => {
  const offered = (def.params.dataset.options as () => { value: string }[])().map((o) => o.value);
  expect(offered).toEqual(["pokemon", "words", "openings"]);
  // common words: only length thresholds and two commonness sizes are narrow enough, and same-attribute ones nest or never meet
  await expect(gen({ dataset: "words" }, "words 3")).rejects.toThrow("fewer rows or columns");
  for (const [id, n] of [["words", 2], ["openings", 3]] as const) {
    expect(gridable(registry.getDataset(id))).toBe(true);
    const preset = def.presets!.find((x) => x.params.dataset === id)!;
    expect(preset.label).toBe(`${registry.getDataset(id)!.name}: ${n} × ${n}`);
    // the defaults follow the dataset: its first pool, its featured attributes
    const v = resolve(def.params, { dataset: id }) as { pool: string; ask: readonly string[] };
    expect(v.pool).toBe(registry.getDataset(id)!.pools![0]!.query);
    expect(v.ask).toEqual(registry.getDataset(id)!.featured!.filter((f) => v.ask.includes(f)));
    const p = await gen(preset.params, `other ${id}`);
    expect([p.dataset, p.rows.length, p.cols.length]).toEqual([id, n, n]);
    const a = analyse(registry.getDataset(id)!, p);
    for (const ans of a.answers) expect(ans.length).toBeGreaterThanOrEqual(3);
    // play the found answer square by square
    const board = assignment(a.answers)!;
    let s = def.init(p);
    board.forEach((item, cell) => { s = def.reduce(p, s, { type: "guess", cell, item }); });
    expect(def.isSolved(p, s)).toBe(true);
    expect(def.rules!(p)[0]).toContain(registry.getDataset(id)!.noun!.one);
  }
}, 60000);

test("a dataset that can't fill a grid is not offered", () => {
  const reg = new Registry();
  reg.dataset({ id: "bare", name: "bare", version: "1", credits: "", attributes: [{ id: "note", label: "note", kind: "text" }], items: () => [] });
  pack({ ...api, registry: reg });
  const d = reg.getPuzzle("pokedoku")!;
  expect((d.params.dataset.options as () => unknown[])()).toEqual([]);
  expect(d.presets).toEqual([]);
});

test("every preset generates", async () => {
  for (const preset of def.presets!) await gen(preset.params, `preset ${preset.label}`);
}, 120000);

test("the pack reads no pokémon-specific code", () => {
  for (const f of readdirSync(import.meta.dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
    expect([f, /lib\/pokemon/.test(readFileSync(`${import.meta.dir}/${f}`, "utf8"))]).toEqual([f, false]);
  }
});
