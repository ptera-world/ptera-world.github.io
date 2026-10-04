import type { Format } from "../../core/types";
import { D, L, R, U, centre, degree, neighbour, normalizeBarriers, type NetPuzzle } from "./grid";

const MAX_SIDE = 60;
const HEX = "0123456789abcdef";

function checkSize(w: number, h: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) {
    throw new Error(`size must be between 1 and ${MAX_SIDE} on each side`);
  }
  if (w * h < 2) throw new Error("need at least 2 tiles");
}

/** Shared sanity checks; a tree on n cells has exactly 2(n-1) tile ends. */
function finish(p: NetPuzzle): NetPuzzle {
  const n = p.w * p.h;
  const ends = p.tiles.reduce((a, m) => a + degree(m), 0);
  if (ends !== 2 * (n - 1)) {
    throw new Error(`the tiles have ${ends} ends in total, but a single connected network of ${n} tiles needs exactly ${2 * (n - 1)}`);
  }
  if (p.source < 0 || p.source >= n) throw new Error("source is outside the grid");
  return { ...p, barriers: normalizeBarriers(p, p.barriers) };
}

/** Tile hex digits, each followed by `v` (wall on its right) and/or `h` (wall below). */
function parseDesc(w: number, h: number, desc: string): { tiles: number[]; barriers: number[] } {
  const tiles: number[] = [];
  const barriers: number[] = [];
  let at = 0;
  for (let i = 0; i < w * h; i++) {
    const t = HEX.indexOf(desc[at]?.toLowerCase() ?? "");
    if (t < 0) throw new Error(at >= desc.length ? `expected ${w * h} tiles, got ${i}` : `unexpected "${desc[at]}" at position ${at + 1}`);
    at++;
    let b = 0;
    while (desc[at] === "v" || desc[at] === "h") b |= desc[at++] === "v" ? R : D;
    tiles.push(t);
    barriers.push(b);
  }
  if (at !== desc.length) throw new Error(`more than ${w * h} tiles`);
  return { tiles, barriers };
}

function writeDesc(p: NetPuzzle): string {
  let out = "";
  for (let i = 0; i < p.w * p.h; i++) {
    out += HEX[p.tiles[i]!];
    if (p.barriers[i]! & R && neighbour(p, i, R) >= 0) out += "v";
    if (p.barriers[i]! & D && neighbour(p, i, D) >= 0) out += "h";
  }
  return out;
}

const SGT_RE = /^(\d+)(?:x(\d+))?([^:]*):([0-9a-fA-Fhv]+)$/;

/** Simon Tatham's Portable Puzzle Collection game id, e.g. `5x5w:a3c...`. The source is not part of it (sgt starts at the center). */
export const sgtFormat: Format<NetPuzzle> = {
  id: "sgt",
  label: "sgt game id (WxH[w]:tiles)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected an sgt net game id like 5x5w:9a3c...");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    checkSize(w, h);
    const wrap = m[3]!.includes("w");
    const g = { w, h, wrap };
    return finish({ ...g, ...parseDesc(w, h, m[4]!), source: centre(g) });
  },
  serialize: (p) => `${p.w}x${p.h}${p.wrap ? "w" : ""}:${writeDesc(p)}`,
};

const NATIVE_RE = /^net:(\d+)x(\d+)(w?):([0-9a-fA-Fhv]+)(?::s(\d+),(\d+))?$/;

/** Compact single line: `net:WxH[w]:tiles[:sX,Y]`, tiles as in the sgt id, source 1-based. */
export const compactFormat: Format<NetPuzzle> = {
  id: "net",
  label: "compact (net:WxH[w]:tiles:sX,Y)",
  detect: (t) => t.trim().startsWith("net:"),
  parse(text) {
    const m = NATIVE_RE.exec(text.trim());
    if (!m) throw new Error("expected net:WxH[w]:tiles[:sX,Y]");
    const w = Number(m[1]), h = Number(m[2]);
    checkSize(w, h);
    const g = { w, h, wrap: m[3] === "w" };
    const source = m[5] ? (Number(m[6]) - 1) * w + (Number(m[5]) - 1) : centre(g);
    if (m[5] && (Number(m[5]) < 1 || Number(m[5]) > w || Number(m[6]) < 1 || Number(m[6]) > h)) {
      throw new Error("source is outside the grid");
    }
    return finish({ ...g, ...parseDesc(w, h, m[4]!), source });
  },
  serialize(p) {
    const base = `net:${p.w}x${p.h}${p.wrap ? "w" : ""}:${writeDesc(p)}`;
    return p.source === centre(p) ? base : `${base}:s${(p.source % p.w) + 1},${Math.floor(p.source / p.w) + 1}`;
  },
};

/** Box-drawing glyph per tile mask (R=1, U=2, L=4, D=8). */
export const GLYPHS = " ╶╵└╴─┘┴╷┌│├┐┬┤┼";
const SIDE_NAMES: Record<string, number> = { right: R, up: U, left: L, down: D };

/**
 * Readable grid for hand-authoring:
 * ```
 * net 3x3 wrap source=2,2
 * ╶┬┐
 * ...
 * barrier 1,2 right
 * ```
 * Coordinates are 1-based column,row. Blank lines and lines starting with # are ignored.
 */
export const gridFormat: Format<NetPuzzle> = {
  id: "grid",
  label: "grid (box drawing)",
  detect: (t) => /^\s*net\s+\d+x\d+/.test(t),
  parse(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));
    const head = /^\s*net\s+(\d+)x(\d+)((?:\s+\S+)*)\s*$/.exec(lines[0] ?? "");
    if (!head) throw new Error("first line should look like: net 7x7 [wrap] [source=4,4]");
    const w = Number(head[1]), h = Number(head[2]);
    checkSize(w, h);
    let wrap = false;
    let src: [number, number] | null = null;
    for (const tok of head[3]!.trim().split(/\s+/).filter(Boolean)) {
      const s = /^source=(\d+),(\d+)$/.exec(tok);
      if (tok === "wrap") wrap = true;
      else if (s) src = [Number(s[1]), Number(s[2])];
      else throw new Error(`unknown option "${tok}" on the first line`);
    }
    const g = { w, h, wrap };
    const tiles: number[] = [];
    for (let y = 0; y < h; y++) {
      const row = [...(lines[1 + y] ?? "")];
      if (row.length < w) throw new Error(`row ${y + 1} should have ${w} tiles`);
      for (let x = 0; x < w; x++) {
        const c = row[x]!;
        const t = c === "." || c === "·" ? 0 : GLYPHS.indexOf(c);
        if (t < 0) throw new Error(`row ${y + 1}: "${c}" isn't a pipe piece`);
        tiles.push(t);
      }
      if (row.slice(w).join("").trim() !== "") throw new Error(`row ${y + 1} has more than ${w} tiles`);
    }
    const barriers = tiles.map(() => 0);
    for (const line of lines.slice(1 + h)) {
      const b = /^\s*barrier\s+(\d+),(\d+)\s+(right|up|left|down)\s*$/.exec(line);
      if (!b) throw new Error(`can't read "${line.trim()}" (expected: barrier X,Y right|down|left|up)`);
      const x = Number(b[1]) - 1, y = Number(b[2]) - 1;
      if (x < 0 || y < 0 || x >= w || y >= h) throw new Error(`barrier ${b[1]},${b[2]} is outside the grid`);
      barriers[y * w + x]! |= SIDE_NAMES[b[3]!]!;
    }
    if (src && (src[0] < 1 || src[1] < 1 || src[0] > w || src[1] > h)) throw new Error("source is outside the grid");
    const source = src ? (src[1] - 1) * w + (src[0] - 1) : centre(g);
    return finish({ ...g, tiles, barriers, source });
  },
  serialize(p) {
    const head = [`net ${p.w}x${p.h}`];
    if (p.wrap) head.push("wrap");
    if (p.source !== centre(p)) head.push(`source=${(p.source % p.w) + 1},${Math.floor(p.source / p.w) + 1}`);
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.tiles.slice(y * p.w, (y + 1) * p.w).map((m) => (m ? GLYPHS[m] : "·")).join(""));
    const bars: string[] = [];
    p.barriers.forEach((b, i) => {
      for (const d of [R, D]) {
        if (b & d && neighbour(p, i, d) >= 0) bars.push(`barrier ${(i % p.w) + 1},${Math.floor(i / p.w) + 1} ${d === R ? "right" : "down"}`);
      }
    });
    return [head.join(" "), ...rows, ...bars].join("\n");
  },
};

export const formats = [compactFormat, sgtFormat, gridFormat] as const;
