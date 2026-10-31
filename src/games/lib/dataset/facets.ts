import type { DataAttribute } from "../../core/types";

/**
 * A filter as picks per attribute, for a form that offers values to tap instead of a query to
 * type: each attribute's picks must all hold. It is written as a query (lib/dataset/query), so URLs
 * and games read it as before; a query with alternatives or brackets has no picks (null).
 */
export type Pick = { kind: "values"; values: string[] } | { kind: "range"; min?: number; max?: number } | { kind: "bool"; value: boolean };
export type Picks = Record<string, Pick>;

/** Attributes a picker offers: values to tap, a number range, or yes/no. Text and long value lists are left out. */
export function pickable(attrs: readonly DataAttribute[], most = 40): DataAttribute[] {
  return attrs.filter((a) => a.kind === "bool" || a.kind === "number" || ((a.kind === "category" || a.kind === "ordinal" || a.kind === "set") && (a.values?.length ?? 0) > 0 && (a.values?.length ?? 0) <= most));
}

const word = (v: string) => (/^[\w.-]+$/u.test(v) ? v : `"${v.replace(/"/g, "")}"`);

export function formatPicks(picks: Picks, attrs: readonly DataAttribute[]): string {
  const out: string[] = [];
  // in the attributes' order, so the same picks always write the same query
  for (const a of attrs) {
    const p = picks[a.id];
    if (!p) continue;
    if (p.kind === "values" && p.values.length) {
      const order = (a.values ?? []).map((x) => x.value);
      out.push(`${a.id}:${p.values.slice().sort((x, y) => order.indexOf(x) - order.indexOf(y)).map(word).join(",")}`);
    } else if (p.kind === "range") {
      if (p.min !== undefined && p.max !== undefined && p.min === p.max) out.push(`${a.id}:${p.min}`);
      else {
        if (p.min !== undefined) out.push(`${a.id}>=${p.min}`);
        if (p.max !== undefined) out.push(`${a.id}<=${p.max}`);
      }
    } else if (p.kind === "bool") out.push(p.value ? a.id : `!${a.id}`);
  }
  return out.join(" ");
}

/** The picks a query says, or null if it says something picks can't (alternatives, brackets, text, unknown names). */
export function parsePicks(query: string, attrs: readonly DataAttribute[]): Picks | null {
  const picks: Picks = {};
  const q = query.trim();
  if (!q) return picks;
  if (/[()|]/.test(q) || /(^|\s)(or|not)(\s|$)/i.test(q)) return null;
  const byName = (n: string) => attrs.find((a) => a.id.toLowerCase() === n.toLowerCase() || a.label.replace(/\s+/g, "").toLowerCase() === n.toLowerCase());
  const valueOf = (a: DataAttribute, v: string) => a.values?.find((x) => x.value.toLowerCase() === v.toLowerCase() || x.label.replace(/\s+/g, "").toLowerCase() === v.replace(/\s+/g, "").toLowerCase())?.value;
  // terms are space separated, but a value list may have spaces after its commas
  for (const t of q.replace(/,\s+/g, ",").split(/\s+/)) {
    let m = /^([!-]?)([\w.-]+)$/u.exec(t);
    if (m) {
      const a = byName(m[2]!);
      if (!a || a.kind !== "bool") return null;
      picks[a.id] = { kind: "bool", value: m[1] === "" };
      continue;
    }
    m = /^([\w.-]+)(>=|<=|>|<)(-?\d+(?:\.\d+)?)$/u.exec(t);
    if (m) {
      const a = byName(m[1]!);
      if (!a || (a.kind !== "number" && a.kind !== "ordinal")) return null;
      const n = Number(m[3]);
      const r = picks[a.id]?.kind === "range" ? (picks[a.id] as Extract<Pick, { kind: "range" }>) : { kind: "range" as const };
      if (m[2] === ">=") r.min = n; else if (m[2] === ">") r.min = n + 1; else if (m[2] === "<=") r.max = n; else r.max = n - 1;
      picks[a.id] = r;
      continue;
    }
    m = /^([\w.-]+):(.+)$/u.exec(t);
    if (!m) return null;
    const a = byName(m[1]!);
    if (!a) return null;
    const raw = m[2]!.replace(/"/g, "");
    if (a.kind === "number") {
      const r = /^(-?\d+(?:\.\d+)?)(?:-(-?\d+(?:\.\d+)?))?$/.exec(raw);
      if (!r) return null;
      picks[a.id] = { kind: "range", min: Number(r[1]), max: Number(r[2] ?? r[1]) };
      continue;
    }
    if (!a.values?.length) return null;
    const values: string[] = [];
    for (const part of raw.split(",")) {
      // ordinals may be given as a span (gen:1-4)
      const span = /^(\d+)-(\d+)$/.exec(part);
      if (span && a.kind === "ordinal") {
        const order = a.values.map((x) => x.value);
        const lo = order.indexOf(span[1]!), hi = order.indexOf(span[2]!);
        if (lo < 0 || hi < 0) return null;
        values.push(...order.slice(Math.min(lo, hi), Math.max(lo, hi) + 1));
        continue;
      }
      const v = valueOf(a, part);
      if (!v) return null;
      values.push(v);
    }
    picks[a.id] = { kind: "values", values };
  }
  return picks;
}
