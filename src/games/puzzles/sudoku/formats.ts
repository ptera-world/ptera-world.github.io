import type { Format } from "../../core/types";
import { boxDims } from "./engine/geometry";
import { compile } from "./engine/model";
import { solve } from "./engine/solver";
import type { ConstraintSpec, LatinPuzzle } from "./engine/types";

const MAX_N = 9;

export function defaultConstraints(n: number): ConstraintSpec[] {
  const dims = boxDims(n);
  return dims ? [{ type: "latin" }, { type: "boxes", w: dims[0], h: dims[1] }] : [{ type: "latin" }];
}

function isClassic(p: LatinPuzzle): boolean {
  const def = JSON.stringify(defaultConstraints(p.n));
  return JSON.stringify(p.constraints) === def && !p.title && !p.author;
}

const givensText = (g: readonly number[]) => g.map((v) => (v ? String(v) : ".")).join("");

/** Compile and solve once so bad imports fail with a readable message. */
function checked(p: LatinPuzzle): LatinPuzzle {
  if (!Number.isInteger(p.n) || p.n < 2 || p.n > MAX_N) throw new Error(`grid size must be 2–${MAX_N}`);
  if (p.givens.length !== p.n * p.n) throw new Error(`expected ${p.n * p.n} cells, got ${p.givens.length}`);
  if (p.givens.some((v) => !Number.isInteger(v) || v < 0 || v > p.n)) throw new Error(`digits must be 1–${p.n}`);
  const m = compile(p.n, p.constraints);
  const r = solve(m, p.givens, { limit: 1, budget: 300_000 });
  if (r.complete && !r.solutions.length) throw new Error("this puzzle has no solution");
  return p;
}

function parseGrid(text: string): LatinPuzzle {
  const cells = text.replace(/[\s|+-]/g, "").replace(/[_*]/g, ".");
  if (!/^[0-9.]+$/.test(cells)) throw new Error("expected digits, with . or 0 for empty cells");
  const n = Math.round(Math.sqrt(cells.length));
  if (n * n !== cells.length) throw new Error(`${cells.length} cells isn't a square grid`);
  return checked({ n, givens: [...cells].map((ch) => (ch === "." ? 0 : Number(ch))), constraints: defaultConstraints(n) });
}

interface JsonPuzzle {
  n?: number;
  givens?: string | number[];
  constraints?: ConstraintSpec[];
  title?: string;
  author?: string;
}

function parseJson(text: string): LatinPuzzle {
  let raw: JsonPuzzle;
  try {
    raw = JSON.parse(text) as JsonPuzzle;
  } catch {
    throw new Error("not valid JSON");
  }
  const givens = typeof raw.givens === "string"
    ? [...raw.givens].map((ch) => (ch === "." || ch === "0" ? 0 : Number(ch)))
    : Array.isArray(raw.givens) ? raw.givens.map(Number) : null;
  const n = Number(raw.n ?? (givens ? Math.round(Math.sqrt(givens.length)) : NaN));
  if (!Number.isInteger(n)) throw new Error("missing grid size n");
  const constraints = Array.isArray(raw.constraints) ? raw.constraints : defaultConstraints(n);
  if (!constraints.every((c) => c && typeof c === "object" && typeof c.type === "string")) throw new Error("every constraint needs a type");
  const p: LatinPuzzle = { n, givens: givens ?? Array.from({ length: n * n }, () => 0), constraints };
  if (typeof raw.title === "string") p.title = raw.title;
  if (typeof raw.author === "string") p.author = raw.author;
  return checked(p);
}

function toJson(p: LatinPuzzle, pretty: boolean): string {
  const out: JsonPuzzle = { n: p.n, givens: givensText(p.givens), constraints: p.constraints };
  if (p.title) out.title = p.title;
  if (p.author) out.author = p.author;
  if (!pretty) return JSON.stringify(out);
  return `{\n  "n": ${p.n},\n  "givens": ${JSON.stringify(out.givens)},\n  "constraints": [\n${p.constraints.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ]${p.title ? `,\n  "title": ${JSON.stringify(p.title)}` : ""}${p.author ? `,\n  "author": ${JSON.stringify(p.author)}` : ""}\n}`;
}

// --- f-puzzles (lz-string base64 JSON) ---

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

/** lz-string's decompressFromBase64. Returns null on malformed input. */
export function lzDecompressBase64(input: string): string | null {
  const rev = new Map([...B64].map((ch, i) => [ch, i]));
  const length = input.length;
  const at = (i: number) => rev.get(input.charAt(i)) ?? 0;
  const dict: (string | number)[] = [0, 1, 2];
  let enlargeIn = 4, dictSize = 4, numBits = 3;
  const data = { val: at(0), position: 32, index: 1 };
  const read = (count: number): number => {
    let bits = 0, power = 1;
    const max = 1 << count;
    while (power !== max) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = 32;
        data.val = at(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return bits;
  };
  let c: string;
  switch (read(2)) {
    case 0: c = String.fromCharCode(read(8)); break;
    case 1: c = String.fromCharCode(read(16)); break;
    default: return "";
  }
  dict[3] = c;
  let w = c;
  const result = [c];
  for (;;) {
    if (data.index > length) return "";
    let code = read(numBits);
    switch (code) {
      case 0:
        dict[dictSize++] = String.fromCharCode(read(8));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dict[dictSize++] = String.fromCharCode(read(16));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join("");
    }
    if (enlargeIn === 0) {
      enlargeIn = 1 << numBits;
      numBits++;
    }
    let entry: string;
    const known = dict[code];
    if (typeof known === "string") entry = known;
    else if (code === dictSize) entry = w + w.charAt(0);
    else return null;
    result.push(entry);
    dict[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 1 << numBits;
      numBits++;
    }
  }
}

interface FCell { value?: number | string; given?: boolean; region?: number }
interface FLine { lines?: string[][]; cells?: string[]; value?: string | number; cell?: string; direction?: string }

/** f-puzzles keys this importer understands; anything else non-empty is reported as unsupported. */
const F_HANDLED = new Set([
  "size", "title", "author", "ruleset", "grid", "solution", "highlightConflicts", "disabledlogic", "truecandidatesoptions",
  "diagonal+", "diagonal-", "antiknight", "antiking", "nonconsecutive", "killercage", "thermometer", "arrow",
  "littlekillersum", "difference", "ratio", "xv",
]);

function fromFpuzzles(json: Record<string, unknown>): LatinPuzzle {
  const n = Number(json.size);
  if (!Number.isInteger(n) || n < 2 || n > MAX_N) throw new Error(`grid size must be 2–${MAX_N}`);
  const unsupported = Object.keys(json).filter((k) => !F_HANDLED.has(k) && json[k] !== false && !(Array.isArray(json[k]) && (json[k] as unknown[]).length === 0));
  if (unsupported.length) throw new Error(`unsupported f-puzzles features: ${unsupported.join(", ")}`);
  const cell = (ref: string): number => {
    const m = /^R(\d+)C(\d+)$/i.exec(ref);
    if (!m) throw new Error(`bad cell "${ref}"`);
    return (Number(m[1]) - 1) * n + Number(m[2]) - 1;
  };
  const grid = (json.grid as FCell[][] | undefined) ?? [];
  const givens = Array.from({ length: n * n }, () => 0);
  const regions: number[] = [];
  let customRegions = false;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const g = grid[r]?.[c] ?? {};
    if (g.given && g.value) givens[r * n + c] = Number(g.value);
    if (typeof g.region === "number") customRegions = true;
    regions.push(typeof g.region === "number" ? g.region : -1);
  }
  const constraints: ConstraintSpec[] = [{ type: "latin" }];
  if (customRegions) {
    const dims = boxDims(n);
    const fallback = dims ? { w: dims[0], h: dims[1] } : null;
    const ids = regions.map((id, i) => {
      if (id >= 0) return id;
      if (!fallback) throw new Error("missing region for some cells");
      const r = Math.floor(i / n), c = i % n;
      return Math.floor(r / fallback.h) * (n / fallback.w) + Math.floor(c / fallback.w);
    });
    constraints.push({ type: "regions", ids });
  } else {
    constraints.push(...defaultConstraints(n).slice(1));
  }
  if (json["diagonal+"]) constraints.push({ type: "diagonal", anti: true });
  if (json["diagonal-"]) constraints.push({ type: "diagonal" });
  for (const k of ["antiknight", "antiking", "nonconsecutive"]) if (json[k]) constraints.push({ type: k });
  const list = (k: string) => (Array.isArray(json[k]) ? json[k] as FLine[] : []);
  for (const cage of list("killercage")) {
    const cells = (cage.cells ?? []).map(cell);
    const sum = cage.value === undefined || cage.value === "" ? undefined : Number(cage.value);
    constraints.push(sum === undefined ? { type: "killer", cells } : { type: "killer", cells, sum });
  }
  for (const t of list("thermometer")) for (const line of t.lines ?? []) constraints.push({ type: "thermo", cells: line.map(cell) });
  for (const a of list("arrow")) {
    const bulb = (a.cells ?? []).map(cell);
    if (bulb.length !== 1) throw new Error("only single-cell arrow circles are supported");
    for (const line of a.lines ?? []) {
      const cells = line.map(cell).filter((c) => c !== bulb[0]);
      constraints.push({ type: "arrow", circle: bulb[0]!, cells });
    }
  }
  const DIRS: Record<string, [number, number]> = { UL: [-1, -1], UR: [-1, 1], DL: [1, -1], DR: [1, 1] };
  for (const lk of list("littlekillersum")) {
    const m = /^R(\d+)C(\d+)$/i.exec(lk.cell ?? "");
    const dir = DIRS[String(lk.direction).toUpperCase()];
    if (!m || !dir) throw new Error("bad little killer clue");
    if (lk.value === undefined || lk.value === "") continue;
    constraints.push({ type: "littlekiller", r: Number(m[1]) - 1, c: Number(m[2]) - 1, dr: dir[0], dc: dir[1], sum: Number(lk.value) });
  }
  for (const [k, color, plain] of [["difference", "white", 1], ["ratio", "black", 2]] as const) {
    for (const d of list(k)) {
      const v = d.value === undefined || d.value === "" ? plain : Number(d.value);
      if (v !== plain) throw new Error(`${k} dots with value ${v} aren't supported`);
      const [a, b] = (d.cells ?? []).map(cell);
      constraints.push({ type: "kropki", a: a!, b: b!, color });
    }
  }
  for (const x of list("xv")) {
    const [a, b] = (x.cells ?? []).map(cell);
    const v = String(x.value ?? "").toUpperCase();
    if (v !== "X" && v !== "V") throw new Error("xv clue needs X or V");
    constraints.push({ type: "xv", a: a!, b: b!, sum: v === "X" ? 10 : 5 });
  }
  const p: LatinPuzzle = { n, givens, constraints };
  if (typeof json.title === "string" && json.title) p.title = json.title;
  if (typeof json.author === "string" && json.author) p.author = json.author;
  return checked(p);
}

function extractFpuzzles(text: string): string {
  const t = text.trim();
  const m = /(?:[?&]load=|fpuzzles)([A-Za-z0-9+/=%]+)/.exec(t);
  return decodeURIComponent(m ? m[1]! : t);
}

const fpuzzles: Format<LatinPuzzle> = {
  id: "fpuzzles",
  label: "f-puzzles / sudokupad link",
  detect: (t) => /fpuzzles|[?&]load=/.test(t) || /^N4Ig[A-Za-z0-9+/=]+$/.test(t.trim()),
  parse(text) {
    const json = lzDecompressBase64(extractFpuzzles(text));
    if (!json) throw new Error("couldn't decompress the f-puzzles data");
    let obj: unknown;
    try {
      obj = JSON.parse(json);
    } catch {
      throw new Error("f-puzzles data isn't valid JSON");
    }
    return fromFpuzzles(obj as Record<string, unknown>);
  },
};

/** Formats shared by every puzzle on the engine; the first one is used in share links. */
export function latinFormats(): Format<LatinPuzzle>[] {
  return [
    {
      id: "text",
      label: "text (digits, or JSON for variants)",
      detect: (t) => /^[\s0-9.|+\-_*]+$/.test(t) || t.trim().startsWith("{"),
      parse: (t) => (t.trim().startsWith("{") ? parseJson(t) : parseGrid(t)),
      serialize: (p) => (isClassic(p) ? givensText(p.givens) : toJson(p, false)),
    },
    {
      id: "json",
      label: "JSON",
      detect: (t) => t.trim().startsWith("{"),
      parse: parseJson,
      serialize: (p) => toJson(p, true),
    },
    fpuzzles,
  ];
}
