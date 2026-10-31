import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate as run } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { resolve } from "../../core/schema";
import openingsPack from "../openings-data/index";
import pokemonPack from "../pokemon-data/index";
import wordsPack from "../words-data/index";
import { generate, guessError, reduce, rules, shareText, wordleDef } from "./def";
import { board, candidates, currentRound, easeLevel, foundCount, hardError, inRounds, isLost, isOver, isSolved, kind, revealsShown, roundOver, shownAnswers, type WordleAction, type WordlePuzzle, type WordleState } from "./engine";
import { redact } from "./clue";
import { canonical, equationError } from "./equations";
import type { Entry } from "./kinds";
import { ABSENT, ELSEWHERE, RIGHT, markCounts, markPositions } from "./marks";
import { RANK, SPELLING, type DataSource, type Settings } from "./params";

const registry = new Registry();
for (const pack of [wordsPack, pokemonPack, openingsPack]) pack({ ...api, registry });
const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
const def = wordleDef(data);
const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed = "s") => run(def, params, seed, sig()) as Promise<WordlePuzzle>;
const init = (p: WordlePuzzle): WordleState => def.init(p);
const settings = (params: Record<string, unknown>) => resolve(def.params, params) as Settings;
const play = (p: WordlePuzzle, st: WordleState, e: Entry, b = 0) => reduce(data, p, st, { type: "guess", entry: e, board: b });
const word = (w: string): Entry => ({ seq: w.split("") });

test("wordle's marks: right places first, each answer letter claimed once", () => {
  // ALIEN against PREEN: the first E is grey, the second green
  expect(markPositions("alien".split(""), "preen".split(""))).toEqual([ABSENT, ABSENT, ABSENT, RIGHT, RIGHT]);
  expect(markPositions("eerie".split(""), "there".split(""))).toEqual([ELSEWHERE, ABSENT, ELSEWHERE, ABSENT, RIGHT]);
  // mastermind's black and white pegs are the same counts
  expect(markCounts(["1", "1", "2", "3"], ["1", "2", "1", "4"])).toEqual({ right: 1, elsewhere: 2 });
});

test("the default is classic Wordle: a common five-letter word, six guesses, a daily", async () => {
  const p = await gen({});
  expect(p.s.secret).toBe("items");
  expect(p.s.dataset).toBe("words");
  expect(p.length).toBe(5);
  expect(p.s.limit).toBe(6);
  expect(p.boards).toHaveLength(1);
  expect(await gen({})).toEqual(p);
  expect(def.daily).toBeDefined();
});

test("typing a word and handing it in marks it; the answer solves it", async () => {
  const p = await gen({}, "t");
  let st = init(p);
  const ans = kind(data, p).seqOf(p.boards[0]!.answers[0]!)!;
  for (const c of "zzzzz") st = reduce(data, p, st, { type: "type", sym: c });
  expect(guessError(data, p, st, { seq: st.row }, 0)).toMatch(/not a word/);
  st = reduce(data, p, st, { type: "submit" });
  expect(st.guesses).toHaveLength(0);
  st = { ...st, row: ["", "", "", "", ""] };
  for (const c of ans) st = reduce(data, p, st, { type: "type", sym: c });
  st = reduce(data, p, st, { type: "submit" });
  expect(isSolved(data, p, st)).toBe(true);
  expect(shareText(data, p, st, "wordle")).toStartWith("wordle 1/6\n🟩🟩🟩🟩🟩");
});

test("every named setup generates, and its own answer solves it", async () => {
  for (const preset of def.presets!) {
    const p = await gen(preset.params, `preset ${preset.label}`);
    let st = init(p);
    const sol = def.solve!(p, st);
    if (p.s.goal === "avoid" || p.s.answer === "dodge") { expect(sol).toBe(null); continue; }
    for (const m of (sol as { moves: WordleAction[] }).moves) st = m.type === "guess" ? play(p, st, m.entry, p.boards.findIndex((_, b) => board(data, p, st, b).solvedAt < 0)) : reduce(data, p, st, m);
    expect([preset.label, isSolved(data, p, st)]).toEqual([preset.label, true]);
    expect(rules(data, p).length).toBeGreaterThan(2);
  }
}, 60_000);

test("mastermind: counted marks, codes from the alphabet, any code can be guessed", async () => {
  const p = await gen({ secret: "codes", symbols: "colors", alphabet: 6, minLen: 4, maxLen: 4, marks: "counts" }, "mm");
  const st = play(p, init(p), { seq: ["1", "1", "2", "2"] });
  const m = board(data, p, st, 0).marks[0]!;
  expect(m.counts).toHaveLength(2);
  expect(m.pos).toBeUndefined();
  expect(candidates(data, p, st, 0)!.some((e) => e.seq!.join() === p.boards[0]!.answers[0]!.seq!.join())).toBe(true);
});

test("primel: the code and every guess is a prime", async () => {
  const p = await gen({ secret: "codes", symbols: "digits", alphabet: 10, prime: true, minLen: 5, maxLen: 5 }, "pr");
  const n = Number(p.boards[0]!.answers[0]!.seq!.join(""));
  for (let d = 2; d * d <= n; d++) expect(n % d).not.toBe(0);
  expect(guessError(data, p, init(p), word("12345"), 0)).toMatch(/prime/);
});

test("equations: answers are correct, guesses must be, rearranged answers count unless told not to", async () => {
  const p = await gen({ secret: "equations", minLen: 8, maxLen: 8 }, "eq");
  const ans = p.boards[0]!.answers[0]!.seq!;
  expect(equationError(ans, { form: "number", symbols: ["+", "-", "*", "/"] })).toBe(null);
  expect(guessError(data, p, init(p), word("12+34=99"), 0)).toMatch(/comes to/);
  expect(canonical(word("10+20=30").seq!)).toBe(canonical(word("20+10=30").seq!));
  const m = await gen({ secret: "equations", form: "target", minLen: 6, maxLen: 6 }, "ma");
  expect(m.boards[0]!.target).toBeNumber();
  expect(guessError(data, m, init(m), m.boards[0]!.answers[0]!, 0)).toBe(null);
});

test("chess openings: any legal line can be guessed, written as SAN writes it", async () => {
  const p = await gen({ secret: "items", dataset: "openings", compare: [SPELLING], guess: "valid", minLen: 4, maxLen: 4 }, "ch");
  expect(p.length).toBe(4);
  expect(guessError(data, p, init(p), { seq: ["a3", "a6", "b3", "b6"] }, 0)).toBe(null);
  expect(guessError(data, p, init(p), { seq: ["e4", "e5", "Ke3", "Nc6"] }, 0)).toMatch(/legal/);
  expect(kind(data, p).next(["e4"])).toContain("e5");
});

test("pokédle: per attribute marks, never close unless asked; squirdle's slots", async () => {
  const p = await gen({ secret: "items", dataset: "pokemon", compare: ["type", "gen", "height", "weight"], limit: 0 }, "pk");
  const k = kind(data, p);
  const g = (k.named!).find((i) => i.id !== p.boards[0]!.answers[0]!.item)!;
  const st = play(p, init(p), { item: g.id });
  const m = board(data, p, st, 0).marks[0]!;
  expect(m.attrs).toHaveLength(4);
  expect(m.attrs!.some((f) => f.verdict === "close")).toBe(false);
  const sq = await gen({ secret: "items", dataset: "pokemon", compare: ["type", "gen"], slots: true }, "sq");
  const s2 = play(sq, init(sq), { item: kind(data, sq).named![0]!.id });
  const at = kind(data, sq).attrs.findIndex((a) => a.id === "type");
  expect(board(data, sq, s2, 0).marks[0]!.slots![at]).toBeArray();
});

test("absurdle: the answer dodges, and is found only once one is left", async () => {
  const p = await gen({ answer: "dodge", limit: 0, pool: "common<=10" }, "ab");
  expect(p.boards[0]!.answers).toEqual([]);
  let st = init(p);
  for (let i = 0; i < 30 && !isSolved(data, p, st); i++) {
    const left = candidates(data, p, st, 0)!;
    st = play(p, st, left[0]!);
  }
  expect(isSolved(data, p, st)).toBe(true);
  // the same guesses dodge the same way
  expect(board(data, p, { ...st }, 0).marks.map((m) => JSON.stringify(m))).toEqual(board(data, p, st, 0).marks.map((m) => JSON.stringify(m)));
});

test("fibble: one false mark per row except the winning one; the answer always still fits", async () => {
  const p = await gen({ lies: "one", limit: 9 }, "fi");
  const k = kind(data, p);
  const ans = p.boards[0]!.answers[0]!;
  let st = init(p);
  for (const it of k.universe()!.slice(0, 4)) if (!k.same(it, ans)) st = play(p, st, it);
  const v = board(data, p, st, 0);
  v.marks.forEach((m, r) => {
    const truth = markPositions(k.seqOf(st.guesses[r]!)!, k.seqOf(ans)!);
    expect(m.pos!.filter((x, i) => x !== truth[i]).length).toBe(1);
  });
  expect(candidates(data, p, st, 0)!.some((e) => k.same(e, ans))).toBe(true);
  st = play(p, st, ans);
  expect(board(data, p, st, 0).marks.at(-1)!.pos!.every((x) => x === RIGHT)).toBe(true);
});

test("xordle: two answers sharing no letters, each mark the better of the two, both to find", async () => {
  const p = await gen({ pair: true, limit: 9 }, "xo");
  const [a, b] = p.boards[0]!.answers.map((e) => kind(data, p).seqOf(e)!);
  expect(a!.some((c) => b!.includes(c))).toBe(false);
  let st = play(p, init(p), p.boards[0]!.answers[0]!);
  expect(isSolved(data, p, st)).toBe(false);
  st = play(p, st, p.boards[0]!.answers[1]!);
  expect(isSolved(data, p, st)).toBe(true);
});

test("hard mode rules refuse what they say", async () => {
  const p = await gen({ hard: ["keep", "use", "move", "exact", "drop"], pool: "common<=10" }, "hd");
  const k = kind(data, p);
  const ans = k.seqOf(p.boards[0]!.answers[0]!)!;
  const other = k.universe()!.map((e) => k.seqOf(e)!).find((q) => q.some((c, i) => c === ans[i]) && q.join() !== ans.join())!;
  const st = play(p, init(p), { seq: [...other] });
  const right = other.findIndex((c, i) => c === ans[i]);
  const wrong = [...other];
  wrong[right] = wrong[right] === "q" ? "z" : "q";
  expect(hardError(data, p, st, 0, { seq: wrong })).not.toBe(null);
  expect(hardError(data, p, st, 0, { seq: [...ans] })).toBe(null);
});

test("avoiding: the game ends when you find it; surviving the limit wins", async () => {
  const p = await gen({ goal: "avoid", limit: 3 }, "av");
  const k = kind(data, p);
  const ans = p.boards[0]!.answers[0]!;
  const others = k.universe()!.filter((e) => !k.same(e, ans));
  let st = play(p, init(p), others[0]!);
  st = play(p, st, ans);
  expect(isLost(data, p, st)).toBe(true);
  let ok = init(p);
  for (const e of others.slice(1, 4)) ok = play(p, ok, e);
  expect(isSolved(data, p, ok)).toBe(true);
});

test("boards in sequence open one at a time with earlier guesses marked; starters count", async () => {
  const p = await gen({ boards: 3, open: "sequence", starters: 2, limit: 10 }, "sqn");
  let st = init(p);
  expect(st.guesses).toHaveLength(2);
  for (const s of p.starters) expect(p.boards.some((b) => kind(data, p).same(s, b.answers[0]!))).toBe(false);
  st = play(p, st, p.boards[0]!.answers[0]!);
  expect(board(data, p, st, 1).marks).toHaveLength(3);
});

/** Small settings for every axis, so the cross product runs quickly. */
const AXES: Record<string, Record<string, unknown>[]> = {
  secret: [
    { secret: "items", pool: "common<=10", minLen: 4, maxLen: 4 },
    { secret: "codes", symbols: "colors", alphabet: 4, minLen: 3, maxLen: 3 },
    { secret: "equations", minLen: 6, maxLen: 6 },
    { secret: "items", dataset: "pokemon", pool: "form:default gen:1", compare: ["type", "gen", "height"] },
    { secret: "items", dataset: "pokemon", pool: "form:default gen:1", compare: [], clues: ["media:art", "text:entry"], reveals: ["gen", "type"] },
  ],
  boards: [{ boards: 1 }, { boards: 3 }, { boards: 3, open: "sequence" }, { boards: 3, open: "rounds" }, { boards: 3, open: "rounds", streak: true }],
  marks: [{ marks: "positions" }, { marks: "counts" }, { marks: "order" }],
  twist: [{}, { lies: "one" }, { answer: "dodge" }, { pair: true }, { starters: 1 }],
  hard: [{ hard: [] }, { hard: ["keep", "fit"], hardRows: "all" }],
  goal: [{ goal: "find", limit: 0 }, { goal: "find", limit: 4, overtime: true }, { goal: "avoid", limit: 5 }],
};

test("every combination of the axes plays to an end without breaking its own rules", async () => {
  const keys = Object.keys(AXES);
  const combos: Record<string, unknown>[] = [{}];
  for (const key of keys) combos.splice(0, combos.length, ...combos.flatMap((c) => AXES[key]!.map((x) => ({ ...c, ...x }))));
  let played = 0;
  for (const params of combos) {
    let p: WordlePuzzle;
    try {
      p = generate(data, settings(params), createRng(JSON.stringify(params)));
    } catch (e) {
      // only refusals that say why, for combinations that can't exist
      expect(String(e)).toMatch(/can only|too many|need at least|no two|pick at least|pick something|nothing can show|at most|only \d+/);
      continue;
    }
    played++;
    const k = kind(data, p);
    const rng = createRng(`play ${JSON.stringify(params)}`);
    let st = init(p);
    for (let i = 0; i < 60 && !isOver(data, p, st); i++) {
      if (inRounds(p) && roundOver(data, p, st, currentRound(p, st))) { st = reduce(data, p, st, { type: "next" }); continue; }
      const b = inRounds(p) ? currentRound(p, st) : p.boards.findIndex((_, x) => board(data, p, st, x).solvedAt < 0);
      const open = candidates(data, p, st, Math.max(0, b));
      // guess something that could be the answer when it's known, else a fresh valid guess
      const pool = open?.length ? open : k.universe() ?? [];
      let e = pool.length ? rng.pick(pool) : shownAnswers(data, p, st, Math.max(0, b))[0]!;
      if (guessError(data, p, st, e, Math.max(0, b))) e = shownAnswers(data, p, st, Math.max(0, b))[0] ?? e;
      const next = play(p, st, e, Math.max(0, b));
      if (next === st) break;
      st = next;
    }
    // the hidden answer always agrees with what was shown (lies included)
    p.boards.forEach((bd, b) => {
      if (!bd.answers.length || board(data, p, st, b).solvedAt >= 0) return;
      const c = candidates(data, p, st, b);
      const ok = !c || p.s.pair || c.some((e) => k.same(e, bd.answers[0]!));
      if (!ok) console.log("BROKEN", JSON.stringify(params), b, st.guesses.length);
      expect(ok).toBe(true);
    });
    expect(shareText(data, p, st, "wordle").length).toBeGreaterThan(0);
    expect(rules(data, p).length).toBeGreaterThan(2);
  }
  expect(played).toBeGreaterThan(combos.length / 2);
}, 300_000);

test("Guess game ids round-trip and use the original's hidden form", async () => {
  const p = await gen({ secret: "codes", symbols: "colors", alphabet: 8, minLen: 5, maxLen: 5, limit: 12, blanks: true, distinct: true, marks: "counts" }, "fmt");
  const f = def.formats[0]!;
  const text = f.serialize!(p);
  expect(text.startsWith("c8p5g12bM:")).toBe(true);
  expect(text).not.toContain(p.boards[0]!.answers[0]!.seq!.map((c) => Number(c).toString(16).padStart(2, "0")).join(""));
  const back = f.parse(text) as WordlePuzzle;
  expect(back.boards[0]!.answers[0]!.seq).toEqual(p.boards[0]!.answers[0]!.seq);
  expect([back.s.alphabet, back.length, back.s.limit, back.s.blanks, back.s.distinct]).toEqual([8, 5, 12, true, true]);
  expect(() => f.parse("c6p4g10Bm:00")).toThrow();
  // a blank in a guess is never marked
  const st = play(back, init(back), { seq: ["_", "_", "_", "_", back.boards[0]!.answers[0]!.seq![4]!] });
  expect(board(data, back, st, 0).marks[0]!.counts).toEqual([1, 0]);
});

test("who's that pokémon: shown by a clue, marked right or wrong; wrong guesses ease it and reveal facts", async () => {
  const p = await gen({ secret: "items", dataset: "pokemon", compare: [], clues: ["media:art"], looks: ["circle"], reveals: ["gen", "type", "genus"] }, "who");
  expect(p.s.limit).toBe(5);
  const bd = p.boards[0]!;
  expect(bd.clue).toMatchObject({ id: "media:art", look: "circle" });
  const k = kind(data, p);
  const ans = bd.answers[0]!;
  const wrong = k.named!.filter((it) => it.id !== ans.item).slice(0, 2);
  let st = init(p);
  expect(easeLevel(data, p, st, 0)).toBe(0);
  st = play(p, st, { item: wrong[0]!.id });
  st = play(p, st, { item: wrong[1]!.id });
  expect(board(data, p, st, 0).marks.map((m) => [m.found, m.attrs, m.pos])).toEqual([[false, undefined, undefined], [false, undefined, undefined]]);
  expect(easeLevel(data, p, st, 0)).toBe(2);
  expect(revealsShown(data, p, st, 0)).toEqual(["gen", "type"]);
  expect(def.hint!(p, st)?.message).toBe(String(k.itemOf(ans.item!)!.values.genus));
  st = play(p, st, ans);
  expect(isSolved(data, p, st)).toBe(true);
});

test("a cry is only a clue for an answer that has one; a dex entry has every name blanked", async () => {
  const d = data.get("pokemon")!;
  const p = await gen({ secret: "items", dataset: "pokemon", compare: [], clues: ["media:cry"], boards: 20, limit: 25 }, "cry");
  for (const bd of p.boards) expect(d.media!.cry!.url(kind(data, p).itemOf(bd.answers[0]!.item!)!)).not.toBeNull();
  const pika = d.items().find((it) => it.name === "Pikachu")!;
  expect(redact(d, pika, "Pikachu and Raichu like Pikachu.")).toBe("▬▬▬ and ▬▬▬ like ▬▬▬.");
});

test("rounds: each with its own guesses; a miss moves on, or ends a streak", async () => {
  const base = { secret: "items", dataset: "pokemon", pool: "form:default gen:1", compare: [], clues: ["media:art"], open: "rounds", boards: 3, limit: 2 };
  const p = await gen(base, "run");
  const k = kind(data, p);
  const other = (b: number) => ({ item: k.named!.find((it) => !p.boards.some((x) => x.answers[0]!.item === it.id) && it.id !== p.boards[b]!.answers[0]!.item)!.id });
  let st = init(p);
  // round 1: given up on
  st = reduce(data, p, st, { type: "pass" });
  expect(roundOver(data, p, st, 0)).toBe(true);
  expect(play(p, st, p.boards[0]!.answers[0]!)).toBe(st);
  st = reduce(data, p, st, { type: "next" });
  expect(currentRound(p, st)).toBe(1);
  // round 2: one wrong, then found; the wrong guess counts only here
  st = play(p, st, other(1));
  st = play(p, st, p.boards[1]!.answers[0]!);
  expect(board(data, p, st, 1).solvedAt).toBe(1);
  st = reduce(data, p, st, { type: "next" });
  // round 3: out of guesses
  st = play(p, st, other(2));
  st = play(p, st, { item: k.named!.filter((it) => it.id !== p.boards[2]!.answers[0]!.item)[5]!.id });
  expect(isOver(data, p, st)).toBe(true);
  expect(isSolved(data, p, st)).toBe(true);
  expect(foundCount(data, p, st)).toBe(1);
  expect(def.score!(p, st)).toMatchObject({ value: 1, better: "higher" });
  expect(shareText(data, p, st, "wordle")).toBe("wordle 1/3\n🟥🟨🟥");

  const q = await gen({ ...base, streak: true, boards: 1024, limit: 1 }, "streak");
  expect(q.boards.length).toBe(kind(data, q).universe()!.length);
  let t = init(q);
  t = play(q, t, q.boards[0]!.answers[0]!);
  t = reduce(data, q, t, { type: "next" });
  t = reduce(data, q, t, { type: "pass" });
  expect(isLost(data, q, t)).toBe(true);
  expect(def.score!(q, t)).toMatchObject({ value: 1, label: "streak of 1" });
});

test("ranked (Contexto): each guess gets its rank; a hint lands halfway to the answer; the answer is #1", async () => {
  const p = await gen({ secret: "items", dataset: "pokemon", pool: "form:default gen:1", guess: "pool", compare: [RANK], limit: 0 }, "rank");
  const k = kind(data, p);
  const l = k.likeness!(p.boards[0]!.answers[0]!)!;
  expect(l.items.length).toBe(151);
  let st = init(p);
  const far = l.items[l.close.findIndex((c) => c.rank === 120)]!;
  st = play(p, st, { item: far.id });
  expect(board(data, p, st, 0).marks[0]!.rank).toMatchObject({ rank: 120 });
  const h = def.hint!(p, st)!;
  const tip = (h.actions![0] as { entry: Entry }).entry.item!;
  const r = l.close[l.index.get(tip)!]!.rank;
  expect(r).toBeLessThanOrEqual(60);
  expect(r).toBeGreaterThan(1);
  st = play(p, st, p.boards[0]!.answers[0]!);
  expect(board(data, p, st, 0).marks[1]!.rank!.rank).toBe(1);
  expect(isSolved(data, p, st)).toBe(true);
  expect(shareText(data, p, st, "wordle")).toBe("wordle 2/∞\n🟥\n🟩");
  expect(() => generate(data, settings({ secret: "items", dataset: "pokemon", compare: [RANK], answer: "dodge" }), createRng("x"))).toThrow(/dodges/);
});
