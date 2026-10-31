import type { Rng } from "../../core/rng";
import { defineSchema, effective, type FieldOption, type Values } from "../../core/schema";
import type { DataItem, Dataset, DatasetChart, PuzzleDef } from "../../core/types";
import { filter } from "../../lib/dataset/query";

/** The datasets the game can be played on, looked up when needed (packs load in any order). */
export interface DataSource {
  get(id: string): Dataset | undefined;
  list(): readonly Dataset[];
}

/** A dataset's charts whose attribute it has. */
export const chartsOf = (d: Dataset | undefined): DatasetChart[] => (d?.charts ?? []).filter((c) => d!.attributes.some((a) => a.id === c.attribute));

export type Kind = "factor" | "weak" | "resist";
export const KINDS: readonly { value: Kind; label: string; description: string }[] = [
  { value: "factor", label: "how effective", description: "an attacking type against a pokémon: ×0, ×¼, ×½, ×1, ×2 or ×4?" },
  { value: "weak", label: "weaknesses", description: "pick every type that's super effective against a pokémon" },
  { value: "resist", label: "resist these", description: "pick every type that takes ×½ or less from all of a few attacking types" },
];

/** The answers a "how effective" question offers, in order. */
export const FACTORS = [0, 0.25, 0.5, 1, 2, 4] as const;

export function makeParams(data: DataSource) {
  const ds = (v: Record<string, unknown>) => data.get(String(v.dataset));
  return defineSchema({
    dataset: {
      type: "enum", label: "dataset",
      default: () => (data.get("pokemon") ? "pokemon" : data.list().find((d) => chartsOf(d).length)?.id ?? ""),
      options: () => data.list().filter((d) => chartsOf(d).length).map((d) => ({ value: d.id, label: d.name })),
    },
    chart: {
      type: "enum", label: "chart", default: (v) => chartsOf(ds(v))[0]?.id ?? "",
      options: (v): FieldOption[] => chartsOf(ds(v)).map((c) => ({ value: c.id, label: c.label })),
    },
    kinds: { type: "set", label: "questions", default: ["factor", "weak", "resist"], options: KINDS },
    questions: { type: "int", label: "questions in a round", default: 10, min: 1, max: 50 },
    seconds: { type: "int", label: "seconds per question", default: 0, min: 0, max: 60, description: "0: no time limit. running out counts as wrong" },
    showTypes: { type: "bool", label: "show the pokémon's types", default: true, description: "off: you have to know them" },
    mix: {
      type: "enum", label: "how effective: answers", default: "even",
      options: [
        { value: "even", label: "every answer about as often" },
        { value: "natural", label: "any attacking type (mostly ×1, as in battle)" },
      ],
      when: (v) => (v.kinds as readonly string[] | undefined)?.includes("factor") ?? true,
    },
    attacks: {
      type: "int", label: "attacking types to resist", default: 3, min: 2, max: 4,
      when: (v) => (v.kinds as readonly string[] | undefined)?.includes("resist") ?? true,
    },
    pool: {
      type: "string", label: "which ones defend", default: (v) => ds(v)?.pools?.[0]?.query ?? "", placeholder: "a filter; empty: everything",
      filterOf: (v) => ds(v),
      check: (q, v) => {
        const d = ds(v);
        if (!d) return "that dataset's pack isn't loaded";
        const r = filter(d.items(), q, d.attributes);
        return "error" in r ? r.error : `${r.items.length} ${d.noun?.many ?? "items"}`;
      },
      when: (v) => (v.kinds as readonly string[] | undefined)?.some((k) => k !== "resist") ?? true,
    },
  });
}

export type Params = ReturnType<typeof makeParams>;

export type Question =
  | { kind: "factor"; attack: string; defender: string }
  | { kind: "weak"; defender: string }
  | { kind: "resist"; attacks: string[] };

export interface TMPuzzle {
  dataset: string;
  chart: string;
  questions: Question[];
  /** Per question; 0: no limit. */
  seconds: number;
  showTypes: boolean;
}

/** What the player answered: a factor, a set of types (in chart order), or null when time ran out. */
export type Reply = number | string[] | null;

export interface TMState {
  replies: Reply[];
  /** Types picked so far for the current question (pick questions). */
  picked: string[];
  /** The last answer's explanation is showing; "next" moves on. */
  open: boolean;
  /** Game time (ms) the current question came up at, for the time limit; -1: a timed round not started yet. */
  since: number;
}

export type TMAction =
  | { type: "factor"; factor: number }
  | { type: "pick"; t: string }
  | { type: "submit" }
  | { type: "timeout" }
  | { type: "next"; at: number };

/** What the game reads from the dataset. */
export interface Types {
  /** Every type, in the chart's order. */
  all: readonly string[];
  chart: DatasetChart["factors"];
  /** The chart's own words, and the dataset's: "attacking type", "defending type", "type", "pokémon". */
  words: { row: string; column: string; value: string; one: string; many: string };
  /** A value's label and colour, as the dataset gives them. */
  label(v: string): string;
  color(v: string): string | undefined;
  d: Dataset;
  of(id: string): readonly string[];
  item(id: string): DataItem;
}

const cache = new WeakMap<Dataset, Map<string, Types>>();

export function typesOf(ds: Dataset, chartId: string): Types {
  let per = cache.get(ds);
  if (!per) cache.set(ds, per = new Map());
  let t = per.get(chartId);
  if (t) return t;
  const c = chartsOf(ds).find((x) => x.id === chartId);
  if (!c) throw new Error(`the ${ds.name} data has no chart "${chartId}"`);
  const attr = ds.attributes.find((a) => a.id === c.attribute)!;
  const byId = new Map(ds.items().map((i) => [i.id, i]));
  const item = (id: string) => {
    const it = byId.get(id);
    if (!it) throw new Error(`this game names one (${id}) the loaded ${ds.name} data doesn't have`);
    return it;
  };
  const chart = c.factors;
  const declared = attr.values?.map((v) => v.value) ?? [];
  const val = (v: string) => attr.values?.find((x) => x.value === v);
  per.set(chartId, t = {
    all: declared.filter((x) => x in chart),
    chart,
    item,
    d: ds,
    words: { row: c.row, column: c.column, value: attr.label, one: ds.noun?.one ?? "item", many: ds.noun?.many ?? "items" },
    label: (v) => val(v)?.label ?? v,
    color: (v) => val(v)?.color,
    of: (id) => { const x = item(id).values[c.attribute]; return Array.isArray(x) ? (x as string[]) : typeof x === "string" ? [x] : []; },
  });
  return t;
}

/** Damage factor of one attacking type against one defending type. */
export const single = (T: Types, attack: string, defend: string): number => T.chart[attack]?.[defend] ?? 1;

/** Against a defender of these types: the factors multiply. */
export const factor = (T: Types, attack: string, defend: readonly string[]): number => defend.reduce((m, d) => m * single(T, attack, d), 1);

/** Attacking types super effective (×2 or more) against these types, in chart order. */
export const weaknesses = (T: Types, defend: readonly string[]): string[] => T.all.filter((a) => factor(T, a, defend) > 1);

/** Single types that take ×½ or less from every one of these attacks, in chart order. */
export const resisters = (T: Types, attacks: readonly string[]): string[] => T.all.filter((d) => attacks.every((a) => single(T, a, d) <= 0.5));

/** The right reply to a question. */
export function answerOf(T: Types, q: Question): number | string[] {
  switch (q.kind) {
    case "factor": return factor(T, q.attack, T.of(q.defender));
    case "weak": return weaknesses(T, T.of(q.defender));
    case "resist": return resisters(T, q.attacks);
  }
}

export function isRight(T: Types, q: Question, r: Reply): boolean {
  if (r === null) return false;
  const a = answerOf(T, q);
  return typeof a === "number" ? r === a : Array.isArray(r) && r.length === a.length && r.every((x, i) => x === a[i]);
}

export const isPick = (q: Question): boolean => q.kind !== "factor";
export const started = (s: TMState): boolean => s.since >= 0;
export const current = (p: TMPuzzle, s: TMState): Question | undefined => (s.open || !started(s) ? undefined : p.questions[s.replies.length]);
export const isDone = (p: TMPuzzle, s: TMState): boolean => s.replies.length >= p.questions.length && !s.open;
export const rightCount = (T: Types, p: TMPuzzle, s: TMState): number => s.replies.reduce<number>((n, r, i) => n + (isRight(T, p.questions[i]!, r) ? 1 : 0), 0);

export function reduce(p: TMPuzzle, s: TMState, a: TMAction, T: Types): TMState {
  if (a.type === "next") {
    if (!s.open && started(s)) return s;
    return { replies: s.replies, picked: [], open: false, since: Number.isFinite(a.at) && a.at >= 0 ? a.at : Math.max(0, s.since) };
  }
  const q = current(p, s);
  if (!q) return s;
  const reply = (r: Reply): TMState => ({ replies: [...s.replies, r], picked: [], open: true, since: s.since });
  switch (a.type) {
    case "factor":
      return q.kind === "factor" && (FACTORS as readonly number[]).includes(a.factor) ? reply(a.factor) : s;
    case "pick": {
      if (!isPick(q) || !T.all.includes(a.t)) return s;
      const has = s.picked.includes(a.t);
      return { ...s, picked: T.all.filter((x) => (x === a.t ? !has : s.picked.includes(x))) };
    }
    case "submit":
      return isPick(q) ? reply(s.picked) : s;
    case "timeout":
      return p.seconds > 0 ? reply(null) : s;
    default:
      return s;
  }
}

/** Moves that answer every question left correctly and finish the round. */
export function solveMoves(p: TMPuzzle, s: TMState, T: Types): TMAction[] {
  const moves: TMAction[] = [];
  if (s.open || !started(s)) moves.push({ type: "next", at: Math.max(0, s.since) });
  for (let i = s.replies.length; i < p.questions.length; i++) {
    const q = p.questions[i]!;
    const a = answerOf(T, q);
    if (typeof a === "number") moves.push({ type: "factor", factor: a });
    else {
      const have = i === s.replies.length && !s.open ? s.picked : [];
      for (const t of T.all) if (have.includes(t) !== a.includes(t)) moves.push({ type: "pick", t });
      moves.push({ type: "submit" });
    }
    moves.push({ type: "next", at: Math.max(0, s.since) });
  }
  return moves;
}

// --- generation ---

const resistSets = new WeakMap<Types, Map<number, string[][]>>();

/** Every set of `k` attacking types (chart order) that some single type resists. */
function answerableAttacks(T: Types, k: number): string[][] {
  let m = resistSets.get(T);
  if (!m) resistSets.set(T, m = new Map());
  let out = m.get(k);
  if (out) return out;
  out = [];
  const pick: string[] = [];
  const walk = (from: number) => {
    if (pick.length === k) {
      if (resisters(T, pick).length) out!.push(pick.slice());
      return;
    }
    for (let i = from; i < T.all.length; i++) {
      pick.push(T.all[i]!);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  m.set(k, out);
  return out;
}

export function generate(v: Values<Params>, rng: Rng, ds: Dataset): TMPuzzle {
  const T = typesOf(ds, v.chart);
  const kinds = KINDS.map((k) => k.value).filter((k) => v.kinds.includes(k));
  if (!kinds.length) throw new Error("pick at least one kind of question");
  const needPool = kinds.some((k) => k !== "resist");
  const r = needPool ? filter(ds.items(), v.pool, ds.attributes) : { items: [] };
  if ("error" in r) throw new Error(`the filter: ${r.error}`);
  const pool = r.items.filter((i) => T.of(i.id).length > 0);
  if (needPool && !pool.length) throw new Error(`the filter leaves no ${T.words.many} with a ${T.words.value}`);
  // kinds take turns as evenly as the count allows, in a shuffled order
  const order = rng.shuffle(Array.from({ length: v.questions }, (_, i) => kinds[i % kinds.length]!));
  // defenders without repeats until the pool runs out
  let deck: DataItem[] = [];
  const defender = (): string => {
    if (!deck.length) deck = rng.shuffle(pool.slice());
    return deck.pop()!.id;
  };
  const questions = order.map((kind): Question => {
    if (kind === "resist") return { kind, attacks: rng.pick(answerableAttacks(T, v.attacks)) };
    const d = defender();
    if (kind === "weak") return { kind, defender: d };
    const types = T.of(d);
    if (v.mix === "natural") return { kind, attack: rng.pick(T.all), defender: d };
    const byFactor = new Map<number, string[]>();
    for (const a of T.all) {
      const f = factor(T, a, types);
      byFactor.set(f, [...(byFactor.get(f) ?? []), a]);
    }
    const f = rng.pick([...byFactor.keys()].sort((x, y) => x - y));
    return { kind, attack: rng.pick(byFactor.get(f)!), defender: d };
  });
  return { dataset: ds.id, chart: v.chart, questions, seconds: v.seconds, showTypes: v.showTypes };
}

// --- words ---

export const factorText = (f: number): string => `×${f === 0.25 ? "¼" : f === 0.5 ? "½" : f}`;

/** "fire vs grass ×2, vs steel ×2 → ×4": how the factor comes about, type by type. */
export function breakdown(T: Types, attack: string, defend: readonly string[]): string {
  const parts = defend.map((d) => `vs ${d} ${factorText(single(T, attack, d))}`);
  return defend.length > 1 ? `${attack} ${parts.join(", ")} → ${factorText(factor(T, attack, defend))}` : `${attack} ${parts[0]}`;
}

export function shareText(T: Types, p: TMPuzzle, s: TMState): string {
  const marks = s.replies.map((r, i) => (r === null ? "⬛" : isRight(T, p.questions[i]!, r) ? "🟩" : "🟥"));
  const rows: string[] = [];
  for (let i = 0; i < marks.length; i += 10) rows.push(marks.slice(i, i + 10).join(""));
  return [`type matchups ${rightCount(T, p, s)}/${p.questions.length}${p.seconds ? `, ${p.seconds} s each` : ""}${p.showTypes ? "" : `, ${T.words.value}s hidden`}`, ...rows].join("\n");
}

/** The chart a puzzle is played on. */
export const typesFor = (data: DataSource) => (p: TMPuzzle): Types => {
  const d = data.get(p.dataset);
  if (!d) throw new Error(`the ${p.dataset} dataset's pack isn't loaded`);
  return typesOf(d, p.chart);
};

export function makeTypeMatchups(data: DataSource): PuzzleDef<TMPuzzle, TMState, TMAction, null, Params> {
  const typesOfP = typesFor(data);
  const params = makeParams(data);
  return {
    id: "type-matchups",
    name: "type matchups",
    aliases: ["type chart quiz", "type effectiveness", "pokémon types quiz", "super effective", "matchup chart"],
    tags: ["trivia", "quiz"],
    description: "how effective is this attack against that one? which types hit it super effectively, which resist these attacks? a round of questions on a dataset's chart (pokémon's type chart), explained as you go.",
    datasetsOf: (p) => [p.dataset],
    generatorVersion: 1,
    params,
    get presets() {
      const on = (id: string, list: { label: string; params: Record<string, unknown> }[]) => (data.get(id) ? list.map((x) => ({ label: x.label, params: { dataset: id, ...x.params } })) : []);
      return [
        ...on("pokemon", [
          { label: "pokémon types: mixed, 10 questions", params: {} },
          { label: "pokémon types: how effective", params: { kinds: ["factor"] } },
          { label: "pokémon types: weaknesses", params: { kinds: ["weak"] } },
          { label: "pokémon types: resist these", params: { kinds: ["resist"] } },
          { label: "as in battle: 8 seconds, types hidden", params: { seconds: 8, showTypes: false, mix: "natural" } },
          { label: "gen 1 pokémon, 20 questions", params: { pool: "form:default gen:1", questions: 20 } },
        ]),
        ...data.list().filter((d) => d.id !== "pokemon" && chartsOf(d).length).map((d) => ({ label: d.name, params: { dataset: d.id } })),
      ];
    },
    daily: { params: {} },
    irreversible: true,
    generate: (v, rng) => {
      const d = data.get(String(v.dataset));
      if (!d) throw new Error(`the ${v.dataset} dataset's pack isn't loaded`);
      return generate(effective(params, v), rng, d);
    },
    formats: [],
    // a timed round waits for "start", so reading the rules doesn't eat the first question's time
    init: (p) => ({ replies: [], picked: [], open: false, since: p.seconds > 0 ? -1 : 0 }),
    reduce: (p, s, a) => reduce(p, s, a, typesOfP(p)),
    isSolved: isDone,
    solve: (p, s) => (isDone(p, s) ? null : { moves: solveMoves(p, s, typesOfP(p)) }),
    score: (p, s) => {
      const n = rightCount(typesOfP(p), p, s);
      return { value: n, label: `${n}/${p.questions.length}`, better: "higher" };
    },
    shareText: (p, s) => shareText(typesOfP(p), p, s),
    verdict: (p, s) => {
      const n = rightCount(typesOfP(p), p, s), of = p.questions.length;
      return n === of ? `all ${of} right` : `${n} of ${of} right`;
    },
    rules: (p) => {
      const kinds = new Set(p.questions.map((q) => q.kind));
      const T = typesOfP(p);
      const { row, column, value, one } = T.words;
      const factors = [...new Set(T.all.flatMap((a) => T.all.map((b) => single(T, a, b))))].sort((x, y) => y - x).map(factorText);
      return [
        `${p.questions.length} questions on the ${data.get(p.dataset)?.charts?.find((c) => c.id === p.chart)?.label ?? "chart"}. each ${row} does ${factors.join(", ")} against each ${column}.`,
        `against ${one === "item" ? "one" : `a ${one}`} with two ${value}s, the two factors multiply: ×2 and ×2 make ×4, ×2 and ×½ make ×1, and ×0 makes ×0 whatever the other is.`,
        ...(kinds.has("factor") ? [`how effective: pick the factor the ${row} does to the ${one}.`] : []),
        ...(kinds.has("weak") ? [`weaknesses: pick every ${row} that does ×2 or ×4 to the ${one}, then check.`] : []),
        ...(kinds.has("resist") ? [`resist these: pick every single ${value} that takes ×½ or less (immune counts) from all of the ${row}s, then check.`] : []),
        ...(p.seconds ? [`you have ${p.seconds} seconds per question; running out counts as wrong.`] : []),
        ...(p.showTypes ? [] : [`the ${one}'s ${value}s aren't shown: you need to know them.`]),
        `after each answer you see how it works out, ${value} by ${value}.`,
      ];
    },
    describe: (p) => `${p.questions.length} questions${p.seconds ? `, ${p.seconds} s` : ""}`,
    describeAction: (p, a, before) => {
      const n = before.replies.length + (before.open ? 0 : 1);
      switch (a.type) {
        case "factor": return `${n}: ${factorText(a.factor)}`;
        case "pick": return `${n}: ${before.picked.includes(a.t) ? "unpick" : "pick"} ${a.t}`;
        case "submit": return `${n}: check`;
        case "timeout": return `${n}: time up`;
        case "next": return !started(before) ? "start" : before.replies.length >= p.questions.length ? "finish" : "next question";
      }
    },
  };
}
