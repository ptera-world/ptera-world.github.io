import type { Format } from "../../core/types";
import { getGrid, getTiling, listTilings } from "./grid";

/** Clues are -1 for blank, else the number of loop edges around that face. */
export interface LoopyPuzzle {
  tiling: string;
  w: number;
  h: number;
  clues: number[];
}

const MAX_SIDE = 60;

function checked(tiling: string, w: number, h: number, clues: number[]): LoopyPuzzle {
  const t = getTiling(tiling);
  if (!t) throw new Error(`unknown tiling "${tiling}"`);
  if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE)) throw new Error(`size ${w}×${h} is out of range`);
  const g = getGrid(tiling, w, h);
  if (clues.length !== g.nf) throw new Error(`a ${w}×${h} ${t.label} grid has ${g.nf} cells, but ${clues.length} were given`);
  clues.forEach((c, f) => {
    if (c > g.fe[f]!.length) throw new Error(`clue ${c} can't fit in a cell with ${g.fe[f]!.length} edges`);
  });
  return { tiling, w, h, clues };
}

/** sgt's clue run-length code: digits/capitals are clues, a..z are 1..26 blanks. */
export function encodeRle(clues: readonly number[]): string {
  let out = "", run = 0;
  const flush = () => {
    if (run) out += String.fromCharCode(96 + run);
    run = 0;
  };
  for (const c of clues) {
    if (c < 0) {
      if (run === 26) flush();
      run++;
    } else {
      flush();
      out += c < 10 ? String(c) : String.fromCharCode(55 + c);
    }
  }
  flush();
  return out;
}

export function decodeRle(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") out.push(Number(ch));
    else if (ch >= "A" && ch <= "Z") out.push(ch.charCodeAt(0) - 55);
    else if (ch >= "a" && ch <= "z") for (let i = 0; i < ch.charCodeAt(0) - 96; i++) out.push(-1);
    else throw new Error(`unexpected "${ch}" in the clue string`);
  }
  return out;
}

const NATIVE = /^([a-z][a-z0-9-]*):(\d+)x(\d+):([0-9A-Za-z]*)$/;

export const nativeFormat: Format<LoopyPuzzle> = {
  id: "loopy",
  label: "loopy (tiling:WxH:clues)",
  detect: (t) => NATIVE.test(t.trim()),
  parse(text) {
    const m = NATIVE.exec(text.trim());
    if (!m) throw new Error("expected tiling:WxH:clues, e.g. square:5x5:a2b3...");
    return checked(m[1]!, Number(m[2]), Number(m[3]), decodeRle(m[4]!));
  },
  serialize: (p) => `${p.tiling}:${p.w}x${p.h}:${encodeRle(p.clues)}`,
};

const SGT = /^(\d+)(?:x(\d+))?(?:t(\d+))?(?:d[a-z])?:(?:([^_:]*)_)?([0-9A-Za-z]*)$/;

export const sgtFormat: Format<LoopyPuzzle> = {
  id: "sgt",
  label: "Simon Tatham's Loopy game id",
  detect: (t) => SGT.test(t.trim()),
  parse(text) {
    const s = text.trim();
    if (/^\d+(x\d+)?(t\d+)?(d[a-z])?#/.test(s)) throw new Error("that's a random seed, not a game id; use the game id (the one with a colon)");
    const m = SGT.exec(s);
    if (!m) throw new Error("expected an sgt loopy game id like 7x7t0:a2b3...");
    const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
    const type = m[3] ? Number(m[3]) : 0;
    const desc = m[4];
    const matches = listTilings().filter((t) => t.sgtType === type);
    const tiling = matches.find((t) => (t.sgtDesc ?? null) === (desc ?? null));
    if (!tiling) {
      if (!matches.length) throw new Error(`sgt grid type ${type} isn't supported here yet`);
      throw new Error(`unrecognized grid description "${desc ?? ""}" for grid type ${type}`);
    }
    return checked(tiling.id, w, h, decodeRle(m[5]!));
  },
  serialize(p) {
    const t = getTiling(p.tiling);
    if (t?.sgtType === undefined) return `(${t?.label ?? p.tiling} grids have no sgt game id)`;
    return `${p.w}x${p.h}t${t.sgtType}:${t.sgtDesc !== undefined ? `${t.sgtDesc}_` : ""}${encodeRle(p.clues)}`;
  },
};

/** puzz.link / pzv.jp URL body for slither: 0-4 clue, 5-9 clue + 1 blank, a-e clue + 2 blanks, g-z 1-20 blanks. */
export function decodePzpr(body: string, n: number): number[] {
  const out: number[] = Array.from({ length: n }, () => -1);
  let c = 0;
  for (const ch of body) {
    if (c >= n) break;
    const v = parseInt(ch, 36);
    if (ch === ".") c++;
    else if (v >= 0 && v <= 4) out[c++] = v;
    else if (v >= 5 && v <= 9) { out[c] = v - 5; c += 2; }
    else if (v >= 10 && v <= 14) { out[c] = v - 10; c += 3; }
    else if (v >= 16 && v <= 35) c += v - 15;
    else c++;
  }
  return out;
}

export function encodePzpr(clues: readonly number[]): string {
  let out = "", count = 0;
  for (let c = 0; c < clues.length; c++) {
    const q = clues[c]!;
    let p = "";
    if (q >= 0) {
      if (c + 1 < clues.length && clues[c + 1]! >= 0) p = q.toString(16);
      else if (c + 2 < clues.length && clues[c + 2]! >= 0) { p = (5 + q).toString(16); c++; }
      else { p = (10 + q).toString(16); c += 2; }
    } else count++;
    if (count === 0) out += p;
    else if (p || count === 20) {
      out += (count + 15).toString(36) + p;
      count = 0;
    }
  }
  if (count > 0) out += (count + 15).toString(36);
  return out;
}

const PZPR = /(?:^|[?/])slither\/((?:[^/?#\s]+\/)*?)(\d+)\/(\d+)\/([0-9a-z.]*)/;

export const pzprFormat: Format<LoopyPuzzle> = {
  id: "puzzlink",
  label: "puzz.link url (squares only)",
  detect: (t) => PZPR.test(t.trim()),
  parse(text) {
    const m = PZPR.exec(text.trim());
    if (!m) throw new Error("expected a puzz.link slither url like https://puzz.link/p?slither/10/10/...");
    const w = Number(m[2]), h = Number(m[3]);
    if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE)) throw new Error(`size ${w}×${h} is out of range`);
    return checked("square", w, h, decodePzpr(m[4]!, w * h));
  },
  serialize(p) {
    if (p.tiling !== "square") return "(puzz.link only has square slitherlink)";
    if (p.clues.some((c) => c > 4)) return "(clues above 4 can't be written as a puzz.link url)";
    return `https://puzz.link/p?slither/${p.w}/${p.h}/${encodePzpr(p.clues)}`;
  },
};

const BLANKS = new Set([".", "-", "_", "?", "x"]);

export const gridFormat: Format<LoopyPuzzle> = {
  id: "grid",
  label: "plain grid (squares; rows of 0-4 and .)",
  detect: (t) => t.trim().includes("\n") && /^[0-4.\-_?x \t\r\n]+$/.test(t.trim()),
  parse(text) {
    const rows = text.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
    const cells = rows.map((r) => (/\s/.test(r) ? r.split(/\s+/) : [...r]));
    const w = cells[0]?.length ?? 0, h = cells.length;
    if (!w || cells.some((r) => r.length !== w)) throw new Error("every row needs the same number of cells");
    const clues = cells.flat().map((c) => {
      if (BLANKS.has(c)) return -1;
      if (/^[0-4]$/.test(c)) return Number(c);
      throw new Error(`unexpected "${c}"; use 0-4 for clues and . for blanks`);
    });
    return checked("square", w, h, clues);
  },
  serialize(p) {
    if (p.tiling !== "square") return "(the plain grid format only covers square grids)";
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      rows.push(p.clues.slice(y * p.w, (y + 1) * p.w).map((c) => (c < 0 ? "." : String(c))).join(""));
    }
    return rows.join("\n");
  },
};

/** pzprv3 save files (puzz.link "file" export); import only. */
export const pzprFileFormat: Format<LoopyPuzzle> = {
  id: "pzprv3",
  label: "puzz.link file (pzprv3, import only)",
  detect: (t) => t.trim().startsWith("pzprv3") && /\n\s*slither/.test(t),
  parse(text) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.trim());
    if (!(lines[0] ?? "").startsWith("pzprv3") || !(lines[1] ?? "").startsWith("slither")) throw new Error("not a pzprv3 slither file");
    const h = Number(lines[2]), w = Number(lines[3]);
    if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE)) throw new Error("bad size in file header");
    const rows: string[][] = [];
    for (let i = 4; i < lines.length && rows.length < h; i++) {
      const toks = lines[i]!.split(/\s+/);
      if (toks.length === w && toks.every((t) => /^([0-9]|\.|-)$/.test(t))) rows.push(toks);
    }
    if (rows.length < h) throw new Error("the file has fewer clue rows than its size says");
    return checked("square", w, h, rows.flat().map((t) => (t === "." || t === "-" ? -1 : Number(t))));
  },
};

export const formats = [nativeFormat, sgtFormat, pzprFormat, gridFormat, pzprFileFormat];
