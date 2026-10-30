import type { Rng } from "../../core/rng";

/**
 * Equations as Nerdle, Mathler and Numberle use them: digits, + - * / and optionally brackets,
 * ² and ³, with the usual order of operations, numbers without leading zeros and no unary minus.
 * Values are exact fractions, so 7/2*2=7 holds.
 */

export const OPERATORS = ["+", "-", "*", "/"] as const;
export const EXTRAS = ["(", ")", "²", "³"] as const;

interface Frac { n: number; d: number }
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const frac = (n: number, d = 1): Frac => {
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
};

/** A parsed expression: numbers, binary operators, powers. */
export type Expr =
  | { t: "num"; v: number }
  | { t: "op"; op: "+" | "-" | "*" | "/"; a: Expr; b: Expr }
  | { t: "pow"; e: number; a: Expr };

/** Parse a whole expression, or null if it isn't one. */
export function parse(src: readonly string[]): Expr | null {
  let i = 0;
  const peek = () => src[i];
  const primary = (): Expr | null => {
    if (peek() === "(") {
      i++;
      const e = sum();
      if (!e || peek() !== ")") return null;
      i++;
      return e;
    }
    let s = "";
    while (i < src.length && /^[0-9]$/.test(src[i]!)) s += src[i++];
    if (!s || (s.length > 1 && s[0] === "0")) return null;
    return { t: "num", v: Number(s) };
  };
  const power = (): Expr | null => {
    let e = primary();
    while (e && (peek() === "²" || peek() === "³")) e = { t: "pow", e: src[i++] === "²" ? 2 : 3, a: e };
    return e;
  };
  const product = (): Expr | null => {
    let e = power();
    while (e && (peek() === "*" || peek() === "/")) {
      const op = src[i++] as "*" | "/";
      const b = power();
      if (!b) return null;
      e = { t: "op", op, a: e, b };
    }
    return e;
  };
  const sum = (): Expr | null => {
    let e = product();
    while (e && (peek() === "+" || peek() === "-")) {
      const op = src[i++] as "+" | "-";
      const b = product();
      if (!b) return null;
      e = { t: "op", op, a: e, b };
    }
    return e;
  };
  const e = sum();
  return e && i === src.length ? e : null;
}

/** Exact value, or null on division by zero or numbers too large to be exact. */
export function evaluate(e: Expr): Frac | null {
  switch (e.t) {
    case "num": return frac(e.v);
    case "pow": {
      const a = evaluate(e.a);
      if (!a) return null;
      return safe(frac(a.n ** e.e, a.d ** e.e));
    }
    case "op": {
      const a = evaluate(e.a), b = evaluate(e.b);
      if (!a || !b) return null;
      switch (e.op) {
        case "+": return safe(frac(a.n * b.d + b.n * a.d, a.d * b.d));
        case "-": return safe(frac(a.n * b.d - b.n * a.d, a.d * b.d));
        case "*": return safe(frac(a.n * b.n, a.d * b.d));
        case "/": return b.n === 0 ? null : safe(frac(a.n * b.d, a.d * b.n));
      }
    }
  }
}
const safe = (f: Frac): Frac | null => (Number.isSafeInteger(f.n) && Number.isSafeInteger(f.d) ? f : null);

export interface EquationRules {
  /** "number": an equation whose right side is a plain number (Nerdle); "target": an expression equal to a given number (Mathler). */
  form: "number" | "target";
  /** Symbols allowed besides digits and = (operators, brackets, powers). */
  symbols: readonly string[];
}

/** Why `seq` isn't a valid guess, or null. `target`: the number a target-form expression must equal. */
export function equationError(seq: readonly string[], rules: EquationRules, target?: number): string | null {
  const allowed = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ...rules.symbols, ...(rules.form === "number" ? ["="] : [])]);
  const bad = seq.find((c) => !allowed.has(c));
  if (bad !== undefined) return `${bad} can't be used`;
  if (rules.form === "target") {
    const e = parse(seq);
    if (!e) return "not a calculation";
    const v = evaluate(e);
    if (!v) return "can't be worked out (division by zero?)";
    return v.d === 1 && v.n === target ? null : `it comes to ${v.d === 1 ? v.n : `${v.n}/${v.d}`}, not ${target}`;
  }
  const eq = seq.indexOf("=");
  if (eq < 0 || seq.indexOf("=", eq + 1) >= 0) return "an equation needs exactly one =";
  const left = parse(seq.slice(0, eq)), right = seq.slice(eq + 1);
  if (!left) return "the left side isn't a calculation";
  if (!/^(0|[1-9][0-9]*)$/.test(right.join(""))) return "the right side must be a number";
  const v = evaluate(left);
  if (!v) return "the left side can't be worked out (division by zero?)";
  const r = Number(right.join(""));
  return v.d === 1 && v.n === r ? null : `the left side comes to ${v.d === 1 ? v.n : `${v.n}/${v.d}`}, not ${r}`;
}

/**
 * A canonical form up to reordering + and * (and the terms being subtracted, and the factors
 * divided by), so 10+20=30 and 20+10=30 are one answer.
 */
export function canonical(seq: readonly string[]): string {
  const eq = seq.indexOf("=");
  const left = eq < 0 ? seq : seq.slice(0, eq);
  const e = parse(left);
  if (!e) return seq.join("");
  return canon(e) + (eq < 0 ? "" : `=${seq.slice(eq + 1).join("")}`);
}
function canon(e: Expr): string {
  if (e.t === "num") return String(e.v);
  if (e.t === "pow") return `(${canon(e.a)})^${e.e}`;
  if (e.op === "+" || e.op === "-") {
    const plus: string[] = [], minus: string[] = [];
    const walk = (x: Expr, neg: boolean) => {
      if (x.t === "op" && (x.op === "+" || x.op === "-")) { walk(x.a, neg); walk(x.b, x.op === "-" ? !neg : neg); }
      else (neg ? minus : plus).push(canon(x));
    };
    walk(e, false);
    return `S[${plus.sort().join(",")}|${minus.sort().join(",")}]`;
  }
  const times: string[] = [], over: string[] = [];
  const walk = (x: Expr, inv: boolean) => {
    if (x.t === "op" && (x.op === "*" || x.op === "/")) { walk(x.a, inv); walk(x.b, x.op === "/" ? !inv : inv); }
    else (inv ? over : times).push(canon(x));
  };
  walk(e, false);
  return `P[${times.sort().join(",")}|${over.sort().join(",")}]`;
}

/** A random number of `len` digits (no leading zero). */
const number = (rng: Rng, len: number) => String(rng.range(len === 1 ? 0 : 10 ** (len - 1), 10 ** len - 1)).split("");

/**
 * A random expression of exactly `len` symbols, or null when a try doesn't fit: operands of 1 to
 * 3 digits joined by operators; with brackets allowed, an operand may be a bracketed pair, and with
 * powers, an operand may carry ² or ³.
 */
function randomExpr(rng: Rng, len: number, rules: EquationRules): string[] | null {
  const ops = OPERATORS.filter((o) => rules.symbols.includes(o));
  const pows = (["²", "³"] as const).filter((x) => rules.symbols.includes(x));
  const brackets = rules.symbols.includes("(") && rules.symbols.includes(")");
  if (!ops.length) return null;
  const operand = (room: number): string[] | null => {
    if (brackets && room >= 5 && rng.bool(0.2)) {
      const inner = Math.min(room - 2, rng.range(3, 5));
      const l = rng.range(1, inner - 2), r = inner - 1 - l;
      if (r < 1) return null;
      return ["(", ...number(rng, l), rng.pick(ops), ...number(rng, r), ")"];
    }
    const pow = pows.length && room >= 2 && rng.bool(0.15) ? [rng.pick(pows)] : [];
    const d = Math.min(room - pow.length, rng.range(1, 3));
    return d < 1 ? null : [...number(rng, d), ...pow];
  };
  const out: string[] = [];
  let left = len;
  for (;;) {
    const x = operand(left);
    if (!x) return null;
    out.push(...x);
    left -= x.length;
    if (left === 0) return out;
    if (left < 2) return null;
    out.push(rng.pick(ops));
    left--;
  }
}

/** A random answer of `len` symbols under the rules (and its target, for the target form). Deterministic per rng. */
export function generateEquation(rng: Rng, len: number, rules: EquationRules): { seq: string[]; target?: number } {
  for (let tries = 0; tries < 200_000; tries++) {
    if (rules.form === "target") {
      const e = randomExpr(rng, len, rules);
      const p = e && parse(e);
      const v = p && evaluate(p);
      if (e && v && v.d === 1 && v.n >= 0 && e.some((c) => OPERATORS.includes(c as never))) return { seq: e, target: v.n };
      continue;
    }
    const rhs = rng.range(1, Math.max(1, Math.min(3, len - 4)));
    const lhsLen = len - rhs - 1;
    if (lhsLen < 3) continue;
    const e = randomExpr(rng, lhsLen, rules);
    const p = e && parse(e);
    const v = p && evaluate(p);
    if (!e || !v || v.d !== 1 || v.n < 0 || String(v.n).length !== rhs) continue;
    if (!e.some((c) => OPERATORS.includes(c as never))) continue;
    return { seq: [...e, "=", ...String(v.n).split("")] };
  }
  throw new Error(`no equation of ${len} symbols with those operators turned up; try another length`);
}
