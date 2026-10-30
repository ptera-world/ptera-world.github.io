import type { DataAttribute, DataItem, DataValue } from "../../core/types";

/**
 * How a guessed item's value for one attribute relates to the answer's:
 * - match: the same (sets: the same members, in any order).
 * - close: not the same but within the attribute's close band (numbers, ordinals).
 * - partial: sets that share some members but not all.
 * - miss: neither.
 * `dir` says where the answer lies from the guess for numbers and ordinals.
 */
export type Verdict = "match" | "close" | "partial" | "miss";

export interface Feedback {
  verdict: Verdict;
  dir?: "higher" | "lower";
  /** Sets: the guess's members the answer also has. */
  shared?: readonly string[];
}

/** How far off still counts as close, per attribute id (overrides the attribute's own `near`). */
export type Bands = Readonly<Record<string, { abs?: number; rel?: number } | null>>;

/** Position of an ordinal value among the attribute's values, or -1. */
export function rank(attr: DataAttribute, v: DataValue): number {
  return attr.values?.findIndex((x) => x.value === v) ?? -1;
}

function within(diff: number, of: number, band: { abs?: number; rel?: number } | null | undefined): boolean {
  if (!band) return false;
  const limit = Math.max(band.abs ?? 0, (band.rel ?? 0) * Math.abs(of));
  return limit > 0 && Math.abs(diff) <= limit;
}

/**
 * Compare a guess's value to the answer's. Two unrecorded values (null) are the same: the player
 * learns the answer has nothing recorded either. Text attributes are never compared (always miss
 * unless equal).
 */
export function compare(attr: DataAttribute, guess: DataValue, answer: DataValue, bands: Bands = {}): Feedback {
  const band = attr.id in bands ? bands[attr.id] : attr.near;
  if (guess === null || answer === null) return { verdict: guess === answer ? "match" : "miss" };
  switch (attr.kind) {
    case "number": {
      const g = Number(guess), a = Number(answer);
      if (g === a) return { verdict: "match" };
      return { verdict: within(a - g, a, band) ? "close" : "miss", dir: a > g ? "higher" : "lower" };
    }
    case "ordinal": {
      const g = rank(attr, guess), a = rank(attr, answer);
      if (g === a) return { verdict: "match" };
      return { verdict: within(a - g, 0, band ? { abs: band.abs } : null) ? "close" : "miss", dir: a > g ? "higher" : "lower" };
    }
    case "set": {
      const gs = Array.isArray(guess) ? (guess as string[]) : [String(guess)];
      const as = new Set(Array.isArray(answer) ? (answer as string[]) : [String(answer)]);
      const shared = gs.filter((x) => as.has(x));
      if (shared.length === gs.length && new Set(gs).size === as.size) return { verdict: "match", shared };
      return { verdict: shared.length ? "partial" : "miss", shared };
    }
    default:
      return { verdict: guess === answer ? "match" : "miss" };
  }
}

/** Feedback for every attribute in `attrs`, guess against answer. */
export function compareItems(attrs: readonly DataAttribute[], guess: DataItem, answer: DataItem, bands: Bands = {}): Feedback[] {
  return attrs.map((a) => compare(a, guess.values[a.id] ?? null, answer.values[a.id] ?? null, bands));
}

/** True if `candidate` as the answer would have given exactly `fb` for `guess` (used to narrow down what's left). */
export function consistent(attrs: readonly DataAttribute[], guess: DataItem, fb: readonly Feedback[], candidate: DataItem, bands: Bands = {}): boolean {
  return attrs.every((a, i) => {
    const want = fb[i]!;
    const got = compare(a, guess.values[a.id] ?? null, candidate.values[a.id] ?? null, bands);
    if (got.verdict !== want.verdict || got.dir !== want.dir) return false;
    if (a.kind === "set") return (got.shared ?? []).join() === (want.shared ?? []).join();
    return true;
  });
}

/** What to show for a value: labels for listed values, the number with its unit, yes / no. */
export function formatValue(attr: DataAttribute, v: DataValue): string {
  if (v === null) return "—";
  const label = (x: string) => attr.values?.find((o) => o.value === x)?.label ?? x;
  switch (attr.kind) {
    case "number": return `${Number(v).toFixed(attr.decimals ?? 0)}${attr.unit ? ` ${attr.unit}` : ""}`;
    case "bool": return v ? "yes" : "no";
    case "set": return (Array.isArray(v) ? (v as string[]) : [String(v)]).map(label).join(", ") || "none";
    default: return label(String(v));
  }
}

/**
 * Parse close bands written as `weight:25%, gen:2, height:off`: a number is an absolute band, a
 * percentage a relative one, `off` no band. Throws with a message naming what's wrong.
 */
export function parseBands(text: string, attrs: readonly DataAttribute[]): Record<string, { abs?: number; rel?: number } | null> {
  const out: Record<string, { abs?: number; rel?: number } | null> = {};
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z0-9_-]+)\s*[:=]\s*(off|none|\d+(?:\.\d+)?%?)$/i.exec(part);
    if (!m) throw new Error(`"${part}": write attribute:amount, e.g. weight:20% or gen:1`);
    const attr = attrs.find((a) => a.id === m[1]!.toLowerCase());
    if (!attr || (attr.kind !== "number" && attr.kind !== "ordinal")) throw new Error(`"${m[1]}" isn't a number attribute`);
    const amt = m[2]!.toLowerCase();
    if (amt === "off" || amt === "none") out[attr.id] = null;
    else if (amt.endsWith("%")) {
      if (attr.kind === "ordinal") throw new Error(`${attr.id} is counted in steps, not percent`);
      out[attr.id] = { rel: Number(amt.slice(0, -1)) / 100 };
    } else out[attr.id] = { abs: Number(amt) };
  }
  return out;
}
