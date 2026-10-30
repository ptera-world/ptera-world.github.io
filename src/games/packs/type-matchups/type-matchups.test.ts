import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { findPracticePosition, firstStep } from "../../core/techniques";
import pokemonData from "../pokemon-data/index";
import pack from "./index";
import { answerOf, factor, resisters, shareText, typesOf, weaknesses, type TMAction, type TMPuzzle, type TMState } from "./logic";

const registry = new Registry();
pokemonData({ ...api, registry });
pack({ ...api, registry });
const def = registry.getPuzzle("type-matchups")!;
const T = typesOf(registry.getDataset("pokemon")!);
const techniques = registry.techniquesFor(def);
const make = (params: Record<string, unknown>, seed = "s") => generate(def, params, seed, new AbortController().signal) as Promise<TMPuzzle>;
const play = (p: TMPuzzle, actions: TMAction[], from: TMState = def.init(p)) => actions.reduce((s, a) => def.reduce(p, s, a), from);

test("the chart: dual types multiply, an immunity zeroes", () => {
  expect(factor(T, "fire", ["grass", "steel"])).toBe(4);
  expect(factor(T, "ground", ["fire", "flying"])).toBe(0);
  expect(factor(T, "fire", ["water", "dragon"])).toBe(0.25);
  expect(factor(T, "ice", ["dragon", "fire"])).toBe(1);
  expect(weaknesses(T, ["water", "ground"])).toEqual(["grass"]);
  expect(resisters(T, ["fire", "ice"])).toContain("water");
});

test("a seed gives the same round; kinds take turns; defenders don't repeat", async () => {
  const a = await make({}, "x");
  expect(a).toEqual(await make({}, "x"));
  expect(a.questions.length).toBe(10);
  const kinds = a.questions.map((q) => q.kind);
  for (const k of ["factor", "weak", "resist"]) expect(kinds.filter((x) => x === k).length).toBeGreaterThanOrEqual(3);
  const big = await make({ kinds: ["weak"], questions: 50 });
  const ids = big.questions.map((q) => (q.kind === "weak" ? q.defender : ""));
  expect(new Set(ids).size).toBe(50);
});

test("every resist question has an answer, with the asked number of attacks", async () => {
  const p = await make({ kinds: ["resist"], questions: 50, attacks: 4 });
  for (const q of p.questions) {
    if (q.kind !== "resist") throw new Error("kind");
    expect(q.attacks.length).toBe(4);
    expect(resisters(T, q.attacks).length).toBeGreaterThan(0);
  }
});

test("even mix: every factor comes up", async () => {
  const p = await make({ kinds: ["factor"], questions: 50 });
  const seen = new Set(p.questions.map((q) => answerOf(T, q)));
  expect([...seen].sort()).toEqual([0, 0.25, 0.5, 1, 2, 4]);
});

test("the pool picks the defenders", async () => {
  const p = await make({ kinds: ["weak"], pool: "form:default type=fire", questions: 20 });
  for (const q of p.questions) if (q.kind === "weak") expect(T.of(q.defender)).toEqual(["fire"]);
  await expect(make({ kinds: [] })).rejects.toThrow(/at least one/);
});

const hand: TMPuzzle = {
  questions: [
    { kind: "factor", attack: "fire", defender: "ferrothorn" },
    { kind: "weak", defender: "swampert" },
    { kind: "resist", attacks: ["fire", "ice"] },
  ],
  seconds: 0, showTypes: true,
};

test("answering, explanation, next; picks toggle; score counts right ones", () => {
  let s = play(hand, [{ type: "factor", factor: 4 }]);
  expect(s.open).toBe(true);
  // answers are ignored while the explanation shows
  expect(def.reduce(hand, s, { type: "factor", factor: 2 })).toBe(s);
  s = play(hand, [{ type: "next", at: 5000 }, { type: "pick", t: "grass" }, { type: "pick", t: "fire" }, { type: "pick", t: "fire" }], s);
  expect(s.picked).toEqual(["grass"]);
  expect(s.since).toBe(5000);
  s = play(hand, [{ type: "submit" }, { type: "next", at: 0 }, { type: "pick", t: "fire" }, { type: "submit" }], s);
  expect(s.replies).toEqual([4, ["grass"], ["fire"]]);
  expect(def.isSolved(hand, s)).toBe(false);
  s = play(hand, [{ type: "next", at: 0 }], s);
  expect(def.isSolved(hand, s)).toBe(true);
  expect(def.score!(hand, s)).toEqual({ value: 2, label: "2/3", better: "higher" });
  expect(shareText(T, hand, s)).toBe("type matchups 2/3\n🟩🟩🟥");
});

test("time up counts as wrong, only with a time limit", () => {
  expect(play(hand, [{ type: "timeout" }]).replies).toEqual([]);
  const timed = { ...hand, seconds: 5 };
  // a timed round waits for start, so time spent before it doesn't count against the first question
  const waiting = def.init(timed);
  expect(play(timed, [{ type: "timeout" }, { type: "factor", factor: 4 }], waiting)).toBe(waiting);
  const s = play(timed, [{ type: "next", at: 7000 }, { type: "timeout" }, { type: "next", at: 0 }], waiting);
  expect(s.replies).toEqual([null]);
  expect(shareText(T, timed, s)).toBe("type matchups 0/3, 5 s each\n⬛");
});

test("techniques: an immunity, one type, two types; the pick questions one type at a time", () => {
  const step = (p: TMPuzzle, s: TMState) => firstStep(def, techniques, p, s) as { technique: { id: string }; step: { message: string; actions: TMAction[] } } | null;
  const q = (x: TMPuzzle["questions"][number]): TMPuzzle => ({ questions: [x], seconds: 0, showTypes: true });
  const imm = step(q({ kind: "factor", attack: "ground", defender: "charizard" }), def.init(hand))!;
  expect(imm.technique.id).toBe("type-matchups.immunity");
  expect(imm.step.actions).toEqual([{ type: "factor", factor: 0 }]);
  const mono = step(q({ kind: "factor", attack: "water", defender: "charmander" }), def.init(hand))!;
  expect(mono.technique.id).toBe("type-matchups.one-type");
  const dual = step(hand, def.init(hand))!;
  expect(dual.technique.id).toBe("type-matchups.multiply");
  expect(dual.step.message).toBe("fire vs grass ×2, vs steel ×2: multiplied, ×4");

  // weaknesses: add the missing one, drop the wrong one, then check
  const w = q({ kind: "weak", defender: "swampert" });
  let s = play(w, [{ type: "pick", t: "fire" }]);
  const first = step(w, s)!;
  expect(first.technique.id).toBe("type-matchups.weaknesses");
  expect(first.step.actions).toEqual([{ type: "pick", t: "grass" }]);
  expect(first.step.message).toMatch(/grass vs water ×2, vs ground ×2 → ×4/);
  s = play(w, first.step.actions, s);
  const second = step(w, s)!;
  expect(second.step.actions).toEqual([{ type: "pick", t: "fire" }]);
  s = play(w, second.step.actions, s);
  expect(step(w, s)!.step.actions).toEqual([{ type: "submit" }]);
});

test("the answer finishes the round with every question right", async () => {
  const p = await make({ questions: 12, seconds: 10 });
  const sol = def.solve!(p, def.init(p));
  if (!sol || !("moves" in sol)) throw new Error("no moves");
  const end = play(p, sol.moves);
  expect(def.isSolved(p, end)).toBe(true);
  expect(def.score!(p, end)!.value).toBe(12);
});

test("every technique has a practice board", async () => {
  for (const t of techniques) expect([t.id, !!(await findPracticePosition(def, techniques, t, "x", new AbortController().signal))]).toEqual([t.id, true]);
});

test("the results headline is the score", () => {
  const s = { replies: [4, ["grass"], ["fire"]], picked: [], open: false, since: 0 };
  expect(def.verdict!(hand, s)).toBe("2 of 3 right");
  expect(def.verdict!(hand, { ...s, replies: [4, ["grass"], ["fire", "water"]] })).toBe("all 3 right");
});
