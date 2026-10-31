import type { FieldOption } from "../../core/schema";
import type { DataAttribute, DataItem, Dataset } from "../../core/types";

/**
 * What a group's members can share, built from a dataset's own attributes, so the game names and
 * checks links on any dataset. A link is named by a short id that puzzles store and that is read
 * back without the catalog:
 * - `attr:value`: a category or ordinal attribute has that value, or a set attribute holds it
 * - `attr#n`: a set attribute holds exactly n values ("one type", "two egg groups")
 * - `attr` / `!attr`: a yes-or-no attribute is yes / no
 * - `attr>=n` / `attr<=n`: a number attribute is at least / at most n
 * A link's kind is what the player turns links on and off by: the attribute's id, or `attr#` for
 * how many values a set holds.
 */
export interface Link {
  id: string;
  kind: string;
  /** A few words for a group's reveal ("type: fire", "weight 100 kg or more"). */
  label: string;
  test(item: DataItem): boolean;
}

/** Number attributes get links at these shares of their values, from each end. */
const QUANTILES = [0.1, 0.2];

/** Kinds of attribute links come from (text is prose, never shared). */
const linkable = (a: DataAttribute): boolean => a.kind !== "text";

/** `x` rounded to a number people quote: one significant figure, or one and a half (1.5, 25, 350). */
export function roundish(x: number): number {
  if (x === 0) return 0;
  const m = 10 ** Math.floor(Math.log10(Math.abs(x)));
  return Number((Math.round((x / m) * 2) / 2 * m).toPrecision(6));
}

const listOf = (v: unknown): readonly string[] => (Array.isArray(v) ? (v as string[]) : v === null || v === undefined ? [] : [String(v)]);

/** Every value an attribute takes: its listed values, or those its items have (a category listing none). */
function valuesOf(d: Dataset, a: DataAttribute): { value: string; label: string }[] {
  if (a.values?.length) return a.values.map((v) => ({ value: v.value, label: v.label }));
  const seen = new Set<string>();
  for (const it of d.items()) for (const v of listOf(it.values[a.id])) seen.add(v);
  return [...seen].sort().map((v) => ({ value: v, label: v }));
}

function showNumber(a: DataAttribute, n: number): string {
  return `${n}${a.unit ? ` ${a.unit}` : ""}`;
}

/** The link a stored id names; one that matches nothing when the dataset no longer has it. */
export function linkOf(d: Dataset, id: string): Link {
  const none = (): Link => ({ id, kind: id, label: id, test: () => false });
  const num = /^([a-z0-9_-]+)(>=|<=)(-?[0-9.]+)$/i.exec(id);
  if (num) {
    const a = d.attributes.find((x) => x.id === num[1]);
    const at = Number(num[3]);
    if (!a || a.kind !== "number" || !Number.isFinite(at)) return none();
    const more = num[2] === ">=";
    return {
      id, kind: a.id, label: `${a.label} ${showNumber(a, at)} or ${more ? "more" : "less"}`,
      test: (it) => { const v = it.values[a.id]; return typeof v === "number" && (more ? v >= at : v <= at); },
    };
  }
  const count = /^([a-z0-9_-]+)#([0-9]+)$/i.exec(id);
  if (count) {
    const a = d.attributes.find((x) => x.id === count[1]);
    const n = Number(count[2]);
    if (!a || a.kind !== "set") return none();
    return { id, kind: `${a.id}#`, label: `${a.label}: ${n === 1 ? "only one" : `exactly ${n}`}`, test: (it) => Array.isArray(it.values[a.id]) && (it.values[a.id] as string[]).length === n };
  }
  const bool = /^(!?)([a-z0-9_-]+)$/i.exec(id);
  if (bool) {
    const a = d.attributes.find((x) => x.id === bool[2]);
    if (!a || a.kind !== "bool") return none();
    const yes = bool[1] === "";
    return { id, kind: a.id, label: yes ? a.label : `not ${a.label}`, test: (it) => it.values[a.id] === yes };
  }
  const colon = id.indexOf(":");
  const a = colon > 0 ? d.attributes.find((x) => x.id === id.slice(0, colon)) : undefined;
  if (!a || !(a.kind === "category" || a.kind === "ordinal" || a.kind === "set")) return none();
  const value = id.slice(colon + 1);
  const label = a.values?.find((v) => v.value === value)?.label ?? value;
  return {
    id, kind: a.id, label: `${a.label}: ${label}`,
    test: a.kind === "set" ? (it) => listOf(it.values[a.id]).includes(value) : (it) => it.values[a.id] === value,
  };
}

/** Ids of every link an attribute gives, in a fixed order. */
function idsOf(d: Dataset, a: DataAttribute): string[] {
  switch (a.kind) {
    case "category": case "ordinal": return valuesOf(d, a).map((v) => `${a.id}:${v.value}`);
    case "set": return valuesOf(d, a).map((v) => `${a.id}:${v.value}`);
    case "bool": return [a.id, `!${a.id}`];
    case "number": {
      const vs = d.items().map((it) => it.values[a.id]).filter((v): v is number => typeof v === "number").sort((x, y) => x - y);
      if (!vs.length) return [];
      const at = (q: number) => roundish(vs[Math.min(vs.length - 1, Math.floor(q * vs.length))]!);
      const ids = [...QUANTILES.map((q) => `${a.id}<=${at(q)}`), ...QUANTILES.map((q) => `${a.id}>=${at(1 - q)}`)];
      return [...new Set(ids)];
    }
    default: return [];
  }
}

/** Ids of the how-many links of a set attribute: one per size its items have. */
function countIdsOf(d: Dataset, a: DataAttribute): string[] {
  const sizes = new Set<number>();
  for (const it of d.items()) { const v = it.values[a.id]; if (Array.isArray(v) && v.length) sizes.add(v.length); }
  return [...sizes].sort((x, y) => x - y).map((n) => `${a.id}#${n}`);
}

const catalogs = new WeakMap<Dataset, Link[]>();

/** Every link the dataset gives, of the given kinds (all when none are given), in a fixed order. */
export function links(d: Dataset, kinds?: readonly string[]): Link[] {
  let all = catalogs.get(d);
  if (!all) {
    const ids = d.attributes.filter(linkable).flatMap((a) => [...idsOf(d, a), ...(a.kind === "set" ? countIdsOf(d, a) : [])]);
    catalogs.set(d, all = ids.map((id) => linkOf(d, id)));
  }
  return kinds ? all.filter((l) => kinds.includes(l.kind)) : all;
}

/** The kinds of link a dataset has, for the player to pick from. */
export function kindsOf(d: Dataset | undefined): FieldOption[] {
  return (d?.attributes ?? []).filter(linkable).flatMap((a) => [
    { value: a.id, label: a.label, ...(a.description ? { description: a.description } : {}) },
    ...(a.kind === "set" ? [{ value: `${a.id}#`, label: `how many ${a.label}`, description: `holds exactly one, two… ${a.label}` }] : []),
  ]);
}
