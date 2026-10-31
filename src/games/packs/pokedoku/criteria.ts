import type { DataAttribute, DataItem, Dataset } from "../../core/types";

/**
 * What a row or column of the grid can ask about an item, built from the dataset's declared
 * attributes alone, so it works on any dataset:
 * - a listed value: `type:fire` (category and ordinal: is it; set: has it)
 * - how many a set holds: `type#2`
 * - yes or no: `final`, `!final`
 * - a number past a round threshold: `weight>=100`, `spe<=30`
 * Puzzles store the id; the criterion is read back from the id against the dataset when needed.
 */
export interface Criterion {
  id: string;
  /** The attribute it asks about. */
  attr: string;
  /** A few words for a header ("type: fire", "weight 100 kg or more"). */
  label: string;
  /** What the attribute means, when the dataset says (the same for every criterion on it). */
  detail?: string;
  /** A value's own colour and short label, for drawing it as a chip. */
  chip?: { label: string; color: string };
  test(item: DataItem): boolean;
}

/** Attributes rows and columns can ask about: listed values, yes / no, numbers. */
export function askable(d: Dataset | undefined): DataAttribute[] {
  return (d?.attributes ?? []).filter((a) => a.kind === "bool" || a.kind === "number" || ((a.kind === "category" || a.kind === "ordinal" || a.kind === "set") && (a.values?.length ?? 0) > 0));
}

/** Thresholds per number attribute: this share of items at or past it, from the top and from the bottom. */
const SHARES = [0.1, 0.25];

/** True if the dataset's attributes declare enough to fill the smallest grid (2 × 2: four criteria). */
export function gridable(d: Dataset | undefined): boolean {
  let n = 0;
  for (const a of askable(d)) n += a.kind === "bool" ? 2 : a.kind === "number" ? SHARES.length * 2 : a.values!.length;
  return n >= 4;
}

/** A round number near x: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7 or 8 times a power of ten. */
export function nice(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return 0;
  const a = Math.abs(x);
  const k = 10 ** Math.floor(Math.log10(a));
  let best = k;
  for (const s of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10]) if (Math.abs(Math.log((s * k) / a)) < Math.abs(Math.log(best / a))) best = s * k;
  return Math.sign(x) * Number(best.toPrecision(3));
}

const showNumber = (a: DataAttribute, n: number) => `${n}${a.unit ? ` ${a.unit}` : ""}`;
const describe = (a: DataAttribute) => (a.description ? { detail: a.description } : {});

/** The criterion an id names, or one that matches nothing when the dataset doesn't have it. */
export function criterion(d: Dataset, id: string): Criterion {
  const none: Criterion = { id, attr: "", label: id, test: () => false };
  const attrOf = (aid: string) => d.attributes.find((a) => a.id === aid);
  let m = /^([\w-]+)(>=|<=)(-?\d+(?:\.\d+)?)$/.exec(id);
  if (m) {
    const a = attrOf(m[1]!);
    if (a?.kind !== "number") return none;
    const at = Number(m[3]), up = m[2] === ">=";
    return {
      id, attr: a.id, label: `${a.label} ${showNumber(a, at)} or ${up ? "more" : "less"}`, ...describe(a),
      test: (it) => { const v = it.values[a.id]; return typeof v === "number" && (up ? v >= at : v <= at); },
    };
  }
  m = /^([\w-]+)#(\d+)$/.exec(id);
  if (m) {
    const a = attrOf(m[1]!);
    if (a?.kind !== "set") return none;
    const n = Number(m[2]);
    return { id, attr: a.id, label: `${a.label}: exactly ${n}`, ...describe(a), test: (it) => { const v = it.values[a.id]; return Array.isArray(v) && v.length === n; } };
  }
  m = /^(!?)([\w-]+)$/.exec(id);
  if (m) {
    const a = attrOf(m[2]!);
    if (a?.kind !== "bool") return none;
    const want = m[1] === "";
    return { id, attr: a.id, label: want ? a.label : `not ${a.label}`, ...describe(a), test: (it) => it.values[a.id] === want };
  }
  m = /^([\w-]+):(.+)$/.exec(id);
  if (m) {
    const a = attrOf(m[1]!);
    const v = a?.values?.find((x) => x.value === m![2]);
    if (!a || !v || (a.kind !== "category" && a.kind !== "ordinal" && a.kind !== "set")) return none;
    const test = a.kind === "set"
      ? (it: DataItem) => { const x = it.values[a.id]; return Array.isArray(x) && x.includes(v.value); }
      : (it: DataItem) => { const x = it.values[a.id]; return x !== null && x !== undefined && String(x) === v.value; };
    return { id, attr: a.id, label: `${a.label}: ${v.label}`, ...describe(a), ...(v.color ? { chip: { label: v.label, color: v.color } } : {}), test };
  }
  return none;
}

/** The ids of every criterion an attribute offers on this dataset, in a fixed order. */
function idsFor(d: Dataset, a: DataAttribute): string[] {
  switch (a.kind) {
    case "category":
    case "ordinal":
      return (a.values ?? []).map((v) => `${a.id}:${v.value}`);
    case "set": {
      const sizes = new Set<number>();
      for (const it of d.items()) { const v = it.values[a.id]; if (Array.isArray(v) && v.length) sizes.add(v.length); }
      const counts = sizes.size > 1 ? [...sizes].sort((x, y) => x - y).map((n) => `${a.id}#${n}`) : [];
      return [...(a.values ?? []).map((v) => `${a.id}:${v.value}`), ...counts];
    }
    case "bool":
      return [a.id, `!${a.id}`];
    case "number": {
      const vals = d.items().map((it) => it.values[a.id]).filter((v): v is number => typeof v === "number").sort((x, y) => x - y);
      if (!vals.length) return [];
      const whole = vals.every((v) => Number.isInteger(v));
      const round = (x: number) => (whole ? Math.max(1, Math.round(nice(x))) : nice(x));
      const out = new Set<string>();
      for (const s of SHARES) out.add(`${a.id}>=${round(vals[Math.min(vals.length - 1, Math.floor(vals.length * (1 - s)))]!)}`);
      for (const s of SHARES) out.add(`${a.id}<=${round(vals[Math.floor(vals.length * s)]!)}`);
      return [...out];
    }
    default:
      return [];
  }
}

const catalogs = new WeakMap<Dataset, Map<string, Criterion[]>>();

/** Every criterion the given attributes offer (all askable ones when none are given). */
export function criteria(d: Dataset, attrs?: readonly string[]): Criterion[] {
  let per = catalogs.get(d);
  if (!per) catalogs.set(d, per = new Map());
  const out: Criterion[] = [];
  for (const a of askable(d)) {
    if (attrs && !attrs.includes(a.id)) continue;
    let list = per.get(a.id);
    if (!list) per.set(a.id, list = idsFor(d, a).map((id) => criterion(d, id)));
    out.push(...list);
  }
  return out;
}
