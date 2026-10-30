import type { DataAttribute, DataItem, DataValue } from "../../core/types";
import { rank } from "./compare";

/**
 * A small filter language for slicing a dataset, the same for every dataset because it reads
 * only the attributes' declared kinds and values:
 *
 *   gen:1-4 type:fire,water !legendary bst>=500 (color:red | color:pink)
 *
 * - terms next to each other must all hold; `|` (or `or`) means either; `!`, `-` or `not` before a
 *   term or a bracket negates it; brackets group.
 * - `attr:a,b` the value is one of a, b (sets: has any of them); `attr=a,b` exactly (sets: exactly
 *   those members, so `type=fire` is mono fire).
 * - numbers and ordinals: `attr:3`, `attr:2-5`, `attr>3`, `attr<=3`.
 * - text: `attr:word` or `attr:"some words"`, found anywhere in the text. `name:` likewise.
 * - a bare word is a yes/no attribute (`final`) or a value only one attribute has (`fire`, `mega`).
 *
 * Attributes are named by id or by label without spaces; values by value or label; case and
 * spaces never matter. An empty query keeps everything.
 */
export type Predicate = (item: DataItem) => boolean;

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_]+/g, "");

type Tok = { kind: "word"; text: string; at: number } | { kind: "(" | ")" | "|"; at: number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c) || c === "&" || c === ",") {
      // a comma between terms (rather than inside one) is harmless; inside a term it is read with the term
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === "|") {
      out.push({ kind: c, at: i });
      i++;
      continue;
    }
    const at = i;
    let text = "";
    while (i < src.length && !/[\s()|&]/.test(src[i]!)) {
      if (src[i] === '"') {
        const end = src.indexOf('"', i + 1);
        if (end < 0) throw new QueryError(`a quote at ${i + 1} isn't closed`, i);
        text += src.slice(i, end + 1);
        i = end + 1;
      } else {
        text += src[i];
        i++;
        // a term's value list goes on after commas: `type:fire, water` reads as one term
        if (src[i - 1] === ",") while (src[i] === " ") i++;
      }
    }
    const word = text.toLowerCase();
    if (word === "or") out.push({ kind: "|", at });
    else if (word !== "and") out.push({ kind: "word", text, at });
  }
  return out;
}

export class QueryError extends Error {
  constructor(message: string, readonly at: number) {
    super(message);
  }
}

interface Ctx {
  attrs: readonly DataAttribute[];
}

function findAttr(ctx: Ctx, name: string): DataAttribute | "name" | undefined {
  const n = norm(name);
  if (n === "name") return "name";
  return ctx.attrs.find((a) => norm(a.id) === n) ?? ctx.attrs.find((a) => norm(a.label) === n);
}

function valueOf(attr: DataAttribute, raw: string): string | undefined {
  const n = norm(raw);
  return attr.values?.find((v) => norm(v.value) === n)?.value ?? attr.values?.find((v) => norm(v.label) === n)?.value;
}

const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

function term(ctx: Ctx, tok: { text: string; at: number }): Predicate {
  const fail = (msg: string): never => { throw new QueryError(msg, tok.at); };
  const m = /^([^:=<>!"]+)(:|=|!=|<=|>=|<|>)(.*)$/s.exec(tok.text);
  if (!m) return bare(ctx, tok, fail);
  const [, field, op, rest] = m as unknown as [string, string, string, string];
  const attr = findAttr(ctx, field);
  if (!attr) return fail(`no attribute called "${field}"`);
  if (rest === "") return fail(`${field}${op} needs a value`);
  if (op === "!=") {
    const inner = term(ctx, { text: `${field}:${rest}`, at: tok.at });
    return (it) => !inner(it);
  }
  if (attr === "name") {
    if (op !== ":" && op !== "=") return fail("names can only be searched with name:");
    const want = norm(unquote(rest));
    return op === "=" ? (it) => norm(it.name) === want : (it) => norm(it.name).includes(want) || (it.aliases ?? []).some((a) => norm(a).includes(want));
  }
  const get = (it: DataItem): DataValue => it.values[attr.id] ?? null;
  const list = rest.split(",").map((s) => s.trim()).filter(Boolean);
  switch (attr.kind) {
    case "text": {
      if (op !== ":") return fail(`${attr.label} is text: search it with ${attr.id}:word`);
      const want = norm(unquote(rest));
      return (it) => { const v = get(it); return typeof v === "string" && norm(v).includes(want); };
    }
    case "bool": {
      const yes = ["yes", "y", "true", "1"], no = ["no", "n", "false", "0"];
      const w = rest.toLowerCase();
      if (op !== ":" && op !== "=") return fail(`${attr.label} is yes or no`);
      if (!yes.includes(w) && !no.includes(w)) return fail(`${attr.label} is yes or no, not "${rest}"`);
      const want = yes.includes(w);
      return (it) => get(it) === want;
    }
    case "number": {
      const num = (s: string): number => { const x = Number(s); return Number.isFinite(x) ? x : fail(`"${s}" isn't a number`); };
      if (op === ":" || op === "=") {
        const ranges = list.map((s) => {
          const r = /^(-?[\d.]+)-(-?[\d.]+)$/.exec(s);
          return r ? [num(r[1]!), num(r[2]!)] as const : [num(s), num(s)] as const;
        });
        return (it) => { const v = get(it); return typeof v === "number" && ranges.some(([lo, hi]) => v >= lo && v <= hi); };
      }
      const x = num(rest);
      return cmp(op, (it) => { const v = get(it); return typeof v === "number" ? v : null; }, x);
    }
    case "ordinal": {
      const pos = (s: string): number => { const v = valueOf(attr, s); return v === undefined ? fail(`${attr.label} has no "${s}"`) : rank(attr, v); };
      if (op === ":" || op === "=") {
        const ranges = list.map((s) => {
          if (valueOf(attr, s) !== undefined) return [pos(s), pos(s)] as const;
          const r = /^(.+?)-(.+)$/.exec(s);
          return r ? [pos(r[1]!), pos(r[2]!)] as const : [pos(s), pos(s)] as const;
        });
        return (it) => { const v = get(it); const k = v === null ? -1 : rank(attr, v); return k >= 0 && ranges.some(([lo, hi]) => k >= lo && k <= hi); };
      }
      return cmp(op, (it) => { const v = get(it); const k = v === null ? -1 : rank(attr, v); return k >= 0 ? k : null; }, pos(rest));
    }
    case "category": {
      if (op !== ":" && op !== "=") return fail(`${attr.label} has no order; use ${attr.id}:value`);
      const want = new Set(list.map((s) => valueOf(attr, s) ?? fail(`${attr.label} has no "${s}"`)));
      return (it) => { const v = get(it); return v !== null && want.has(String(v)); };
    }
    case "set": {
      if (op !== ":" && op !== "=") return fail(`${attr.label} is a list; use ${attr.id}:a,b (has any) or ${attr.id}=a,b (exactly)`);
      const want = list.map((s) => valueOf(attr, s) ?? fail(`${attr.label} has no "${s}"`));
      if (op === ":") return (it) => { const v = get(it); return Array.isArray(v) && want.some((w) => v.includes(w)); };
      const exact = new Set(want);
      return (it) => { const v = get(it); return Array.isArray(v) && v.length === exact.size && v.every((x) => exact.has(x)); };
    }
  }
}

function cmp(op: string, read: (it: DataItem) => number | null, x: number): Predicate {
  return (it) => {
    const v = read(it);
    if (v === null) return false;
    return op === "<" ? v < x : op === "<=" ? v <= x : op === ">" ? v > x : v >= x;
  };
}

/** A word on its own: a yes/no attribute, or a value exactly one attribute has. */
function bare(ctx: Ctx, tok: { text: string; at: number }, fail: (msg: string) => never): Predicate {
  const word = unquote(tok.text);
  const attr = findAttr(ctx, word);
  if (attr && attr !== "name" && attr.kind === "bool") return (it) => it.values[attr.id] === true;
  const owners = ctx.attrs.filter((a) => a.kind !== "text" && a.kind !== "bool" && valueOf(a, word) !== undefined);
  if (owners.length === 1) return term(ctx, { text: `${owners[0]!.id}:${word}`, at: tok.at });
  if (owners.length > 1) return fail(`"${word}" could be ${owners.map((a) => `${a.id}:${word}`).join(" or ")}; say which`);
  return fail(`"${word}" isn't an attribute or a value; write attribute:value`);
}

/** Compile a query against a dataset's attributes. Throws QueryError (with the position) for anything it can't read. */
export function compile(src: string, attrs: readonly DataAttribute[]): Predicate {
  const toks = lex(src);
  const ctx: Ctx = { attrs };
  let i = 0;
  const peek = () => toks[i];
  const or = (): Predicate => {
    const parts = [and()];
    while (peek()?.kind === "|") {
      i++;
      parts.push(and());
    }
    return parts.length === 1 ? parts[0]! : (it) => parts.some((p) => p(it));
  };
  const and = (): Predicate => {
    const parts: Predicate[] = [];
    while (peek() && peek()!.kind !== "|" && peek()!.kind !== ")") parts.push(unary());
    if (!parts.length) {
      const t = peek();
      throw new QueryError(t ? "nothing before this" : "the query ends too soon", t?.at ?? src.length);
    }
    return parts.length === 1 ? parts[0]! : (it) => parts.every((p) => p(it));
  };
  const unary = (): Predicate => {
    const t = peek()!;
    if (t.kind === "(") {
      i++;
      const inner = or();
      if (peek()?.kind !== ")") throw new QueryError("a bracket isn't closed", t.at);
      i++;
      return inner;
    }
    if (t.kind === ")") throw new QueryError("a closing bracket with no opening one", t.at);
    if (t.kind !== "word") throw new QueryError("unexpected |", t.at);
    i++;
    const neg = /^(!|-|not$)/i.exec(t.text);
    if (neg) {
      const rest = t.text.slice(neg[0].length);
      const inner = rest ? term(ctx, { text: rest, at: t.at + neg[0].length }) : unary();
      return (it) => !inner(it);
    }
    return term(ctx, t);
  };
  if (!toks.length) return () => true;
  const p = or();
  if (i < toks.length) throw new QueryError("a closing bracket with no opening one", toks[i]!.at);
  return p;
}

/** Items matching `src`, or the error message. */
export function filter<T extends DataItem>(items: readonly T[], src: string, attrs: readonly DataAttribute[]): { items: T[] } | { error: string } {
  try {
    const p = compile(src, attrs);
    return { items: items.filter(p) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
