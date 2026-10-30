import type { Rng } from "../../core/rng";
import type { DataAttribute, DataItem, DataValue, Dataset } from "../../core/types";
import { filter } from "../../lib/dataset/query";
import { spellingOf } from "../../lib/dataset/spelling";
import { canonical, equationError, generateEquation, OPERATORS, type EquationRules } from "./equations";
import { spelled, type DataSource, type Settings } from "./params";

/**
 * A guess or an answer: a dataset item (by id), a sequence of symbols, or both (an item's spelling).
 * A sequence that is no item's spelling (a legal line of chess moves, a code) has no item.
 */
export interface Entry {
  item?: string;
  seq?: string[];
}

/** Up to this many possible answers are reasoned about (hints, answers that dodge, every guess could be it). */
export const UNIVERSE_LIMIT = 300_000;

/** Everything the rules need about what's hidden, for one puzzle's settings. */
export interface Kind {
  /** Symbols per spelling; 0 when spelling isn't compared. */
  length: number;
  /** Attributes compared, in order. */
  attrs: readonly DataAttribute[];
  data?: Dataset;
  itemOf(id: string): DataItem | undefined;
  /** An entry's symbols (an item's spelling), or null. */
  seqOf(e: Entry): readonly string[] | null;
  valuesOf(e: Entry): Readonly<Record<string, DataValue>> | null;
  /** Why `e` can't be guessed, or null. `target`: a target-form equation's number. */
  invalid(e: Entry, target?: number): string | null;
  /** Every possible answer (of this length), or null when there are too many to list. */
  universe(): readonly Entry[] | null;
  /** Items a guess can name (for typing a name), or null when guesses are spelled out symbol by symbol. */
  named: readonly DataItem[] | null;
  /** The keys offered for the next symbol after `prefix`, or null for any of `keys`. */
  next(prefix: readonly string[]): readonly string[] | null;
  /** Every symbol, in keyboard order (rows). */
  keys: readonly (readonly string[])[];
  /** Two entries are the same answer (an item, a spelling, or a rearranged equation). */
  same(guess: Entry, answer: Entry): boolean;
  /** A short label for an entry. */
  label(e: Entry): string;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const DIGITS = "0123456789".split("");

/** The symbols a code is made of. */
export function codeSymbols(s: Pick<Settings, "symbols" | "alphabet">): string[] {
  const n = Math.max(2, s.alphabet);
  if (s.symbols === "digits") return DIGITS.slice(0, Math.min(10, n));
  if (s.symbols === "letters") return LETTERS.slice(0, Math.min(26, n));
  return Array.from({ length: Math.min(10, n) }, (_, i) => String(i + 1));
}

const isPrime = (n: number): boolean => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};

const kindCache = new WeakMap<object, Kind>();

/** The kind for a puzzle (cached per puzzle object). `length`: the puzzle's spelling length. */
export function kindOf(data: DataSource, s: Settings, length: number, key: object = s): Kind {
  let k = kindCache.get(key);
  if (!k) kindCache.set(key, k = buildKind(data, s, length));
  return k;
}

function buildKind(data: DataSource, s: Settings, length: number): Kind {
  if (s.secret === "codes") return codesKind(s, length);
  if (s.secret === "equations") return equationsKind(s, length);
  return itemsKind(data, s, length);
}

function itemsKind(data: DataSource, s: Settings, length: number): Kind {
  const d = data.get(s.dataset);
  if (!d) throw new Error(`the ${s.dataset || "chosen"} dataset's pack isn't loaded`);
  const spell = spelled(s);
  const attrs = s.compare.flatMap((id) => d.attributes.filter((a) => a.id === id && a.kind !== "text"));
  const all = d.items();
  const byId = new Map(all.map((i) => [i.id, i]));
  const seqCache = new Map<string, readonly string[] | null>();
  const seq = (it: DataItem) => {
    let x = seqCache.get(it.id);
    if (x === undefined) seqCache.set(it.id, x = spellingOf(d, it));
    return x;
  };
  const fits = (it: DataItem) => !spell || seq(it)?.length === length;
  const r = filter(all, s.pool, d.attributes);
  if ("error" in r) throw new Error(`the filter: ${r.error}`);
  const pool = r.items.filter(fits);
  const guessable = (s.guess === "pool" ? pool : all.filter(fits));
  const guessIds = new Set(guessable.map((i) => i.id));
  // a spelling names the first guessable item spelled that way
  const bySpelling = new Map<string, DataItem>();
  if (spell) for (const it of guessable) { const q = seq(it); if (q && !bySpelling.has(q.join(" "))) bySpelling.set(q.join(" "), it); }
  const symbols = [...new Set(guessable.flatMap((it) => seq(it) ?? []))].sort();
  const typed = spell && !attrs.length;
  return {
    length: spell ? length : 0,
    attrs,
    data: d,
    itemOf: (id) => byId.get(id),
    seqOf: (e) => e.seq ?? (e.item && byId.has(e.item) ? seq(byId.get(e.item)!) : null),
    valuesOf: (e) => (e.item ? byId.get(e.item)?.values ?? null : null),
    invalid: (e) => {
      if (e.item) return guessIds.has(e.item) ? null : `not one of the ${d.noun?.many ?? "items"} that can be guessed`;
      if (!e.seq) return "nothing guessed";
      if (e.seq.length !== length) return "not the right length";
      if (bySpelling.has(e.seq.join(" "))) return null;
      if (s.guess === "valid" && d.spelling?.valid) return d.spelling.valid(e.seq);
      return `not ${d.noun?.one === "word" ? "a word in the list" : `the spelling of any ${d.noun?.one ?? "item"} that can be guessed`}`;
    },
    universe: () => pool.map((it) => ({ item: it.id, ...(spell ? { seq: [...seq(it)!] } : {}) })),
    named: typed ? null : guessable,
    next: (prefix) => (typed && d.spelling?.next ? d.spelling.next(prefix) : null),
    keys: d.spelling?.next ? [] : symbols.length <= 40 ? keyboardRows(symbols) : [],
    same: (g, a) => (g.item && a.item ? g.item === a.item : !!g.seq && !!a.seq && g.seq.join(" ") === a.seq.join(" ")),
    label: (e) => (e.item ? byId.get(e.item)?.name ?? e.item : (e.seq ?? []).join(" ")),
  };
}

/** Letters in qwerty rows when the symbols are letters; otherwise rows of up to 10. */
function keyboardRows(symbols: readonly string[]): string[][] {
  const set = new Set(symbols);
  if (symbols.every((c) => /^[a-z]$/.test(c))) {
    const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((r) => r.split("").filter((c) => set.has(c)));
    return rows.filter((r) => r.length);
  }
  const out: string[][] = [];
  for (let i = 0; i < symbols.length; i += 10) out.push(symbols.slice(i, i + 10));
  return out;
}

function codesKind(s: Settings, length: number): Kind {
  const syms = codeSymbols(s);
  const prime = s.symbols === "digits" && s.prime;
  const ok = (q: readonly string[]): string | null => {
    if (q.length !== length) return "not the right length";
    if (q.some((c) => c !== "" && !syms.includes(c))) return "not one of the symbols";
    if (q.every((c) => c === "")) return "nothing guessed";
    if (!s.blanks && q.some((c) => c === "")) return "every place needs a symbol";
    if (s.distinct) { const used = q.filter(Boolean); if (new Set(used).size !== used.length) return "no symbol twice"; }
    if (prime && (q.some((c) => c === "") || q[0] === "0" || !isPrime(Number(q.join(""))))) return `${q.join("")} isn't a prime`;
    return null;
  };
  let all: Entry[] | null | undefined;
  const count = s.distinct ? Array.from({ length }, (_, i) => syms.length - i).reduce((a, b) => a * Math.max(0, b), 1) : syms.length ** length;
  return {
    length,
    attrs: [],
    itemOf: () => undefined,
    seqOf: (e) => e.seq ?? null,
    valuesOf: () => null,
    invalid: (e) => (e.seq ? ok(e.seq) : "nothing guessed"),
    universe: () => {
      if (all !== undefined) return all;
      if (count > UNIVERSE_LIMIT * 10) return (all = null);
      const out: Entry[] = [];
      const cur: string[] = [];
      const walk = () => {
        if (out.length > UNIVERSE_LIMIT) return;
        if (cur.length === length) { if (!ok(cur)) out.push({ seq: cur.slice() }); return; }
        for (const c of syms) {
          if (s.distinct && cur.includes(c)) continue;
          cur.push(c); walk(); cur.pop();
        }
      };
      walk();
      return (all = out.length > UNIVERSE_LIMIT ? null : out);
    },
    named: null,
    next: () => null,
    keys: s.symbols === "letters" ? keyboardRows(syms) : [syms],
    same: (g, a) => !!g.seq && !!a.seq && g.seq.join(" ") === a.seq.join(" "),
    label: (e) => (e.seq ?? []).map((c) => c || "·").join(s.symbols === "colors" ? " " : ""),
  };
}

/** The rules equations follow under these settings. */
export const equationRules = (s: Pick<Settings, "form" | "ops">): EquationRules => ({ form: s.form === "target" ? "target" : "number", symbols: s.ops });

function equationsKind(s: Settings, length: number): Kind {
  const rules = equationRules(s);
  const keys = [DIGITS, [...OPERATORS.filter((o) => s.ops.includes(o)), ...s.ops.filter((o) => !OPERATORS.includes(o as never)), ...(rules.form === "number" ? ["="] : [])]];
  return {
    length,
    attrs: [],
    itemOf: () => undefined,
    seqOf: (e) => e.seq ?? null,
    valuesOf: () => null,
    invalid: (e, target) => (!e.seq ? "nothing guessed" : e.seq.length !== length ? "not the right length" : equationError(e.seq, rules, target)),
    universe: () => null,
    named: null,
    next: () => null,
    keys,
    same: (g, a) => !!g.seq && !!a.seq && (g.seq.join("") === a.seq.join("") || (s.commutative && canonical(g.seq) === canonical(a.seq))),
    label: (e) => (e.seq ?? []).join(""),
  };
}

/** Random answers for a new puzzle: `n` distinct entries (and targets, for target-form equations). */
export function drawAnswers(kind: Kind, s: Settings, length: number, rng: Rng, n: number, exclude: (e: Entry) => boolean = () => false): { entry: Entry; target?: number }[] {
  if (s.secret === "equations") {
    const out: { entry: Entry; target?: number }[] = [];
    const seen = new Set<string>();
    for (let tries = 0; out.length < n && tries < n * 50; tries++) {
      const e = generateEquation(rng, length, equationRules(s));
      const key = s.commutative ? canonical(e.seq) : e.seq.join("");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ entry: { seq: e.seq }, ...(e.target !== undefined ? { target: e.target } : {}) });
    }
    if (out.length < n) throw new Error(`only ${out.length} different equations turned up for ${n} boards`);
    return out;
  }
  if (s.secret === "codes" && !kind.universe()) {
    const syms = codeSymbols(s);
    const out: Entry[] = [];
    for (let tries = 0; out.length < n && tries < n * 1000; tries++) {
      const q = s.distinct ? rng.shuffle(syms.slice()).slice(0, length) : Array.from({ length }, () => rng.pick(syms));
      if (kind.invalid({ seq: q }) || out.some((o) => o.seq!.join() === q.join())) continue;
      out.push({ seq: q });
    }
    if (out.length < n) throw new Error("not enough different codes for that many boards");
    return out.map((entry) => ({ entry }));
  }
  const all = (kind.universe() ?? []).filter((e) => !exclude(e));
  if (all.length < n) throw new Error(`only ${all.length} possible answers for ${n} boards; widen what can be hidden`);
  return rng.shuffle(all.slice()).slice(0, n).map((entry) => ({ entry }));
}
