import type { Format } from "../../core/types";
import { MAX_BRIDGES, normalize, validatePuzzle, type BridgesPuzzle, type Island } from "./graph";

function finish(p: BridgesPuzzle): BridgesPuzzle {
  const out = normalize(p);
  validatePuzzle(out);
  return out;
}

// --- simon tatham's portable puzzle collection game id ---

const SGT_RE = /^(?:bridges:)?\s*(\d+)(?:x(\d+))?((?:i\d+)?(?:e\d+)?(?:m\d+)?L?(?:d\d+)?):([0-9a-zA-Z]+)$/;

/**
 * `WxH[iN][eN][mN][L][dN]:desc`. Only m (max bridges, default 2) and L (no loops) affect play.
 * desc: '1'-'9' and 'A'-'G' (10-16) are islands, 'a'-'z' are runs of 1-26 empty cells.
 */
export const sgtFormat: Format<BridgesPuzzle> = {
  id: "sgt",
  label: "sgt game id (7x7m2:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const t = text.trim();
    if (/^(?:bridges:)?\s*\d+(?:x\d+)?[^:]*#/.test(t)) throw new Error("that's a random-seed id; paste the game id (the one with a colon) instead");
    const m = SGT_RE.exec(t);
    if (!m) throw new Error("expected an sgt game id like 7x7m2:a2b3...");
    const w = Number(m[1]), h = m[2] === undefined ? w : Number(m[2]);
    const flags = m[3]!;
    const mm = /m(\d+)/.exec(flags);
    const maxb = mm ? Number(mm[1]) : 2;
    const loops = !flags.includes("L");
    if (w < 1 || h < 1 || w > 60 || h > 60) throw new Error("size out of range");
    const islands: Island[] = [];
    let cell = 0;
    for (const ch of m[4]!) {
      if (ch >= "a" && ch <= "z") {
        cell += ch.charCodeAt(0) - 96;
        continue;
      }
      let n: number;
      if (ch >= "1" && ch <= "9") n = ch.charCodeAt(0) - 48;
      else if (ch >= "A" && ch <= "G") n = ch.charCodeAt(0) - 55;
      else throw new Error(`unexpected '${ch}' in the description`);
      if (cell >= w * h) throw new Error("description is longer than the grid");
      islands.push({ x: cell % w, y: Math.floor(cell / w), n });
      cell++;
    }
    if (cell !== w * h) throw new Error(cell < w * h ? "description is shorter than the grid" : "description is longer than the grid");
    return finish({ w, h, maxb, loops, islands });
  },
  serialize(p) {
    const at = new Map(p.islands.map((is) => [is.y * p.w + is.x, is.n]));
    let out = "", run = 0;
    const flush = () => {
      if (run) out += String.fromCharCode(96 + run);
      run = 0;
    };
    for (let c = 0; c < p.w * p.h; c++) {
      const n = at.get(c);
      if (n === undefined) {
        if (run === 26) flush();
        run++;
      } else {
        flush();
        out += n < 10 ? String(n) : String.fromCharCode(55 + n);
      }
    }
    flush();
    return `${p.w}x${p.h}m${p.maxb}${p.loops ? "" : "L"}:${out}`;
  },
};

// --- plain grid ---

const HEADER_RE = /^\s*(?:max|maxb|loops)\s*[=:]/i;
const EMPTY = new Set([".", "-", "_", "0"]);

/**
 * One line per row. Char mode: '1'-'9', 'A'-'G' (10-16), and . - _ 0 for empty.
 * If any row has inner whitespace, rows are whitespace-separated tokens instead (numbers or . - _ 0).
 * Optional first line: `max=N loops=no`.
 */
export const gridFormat: Format<BridgesPuzzle> = {
  id: "grid",
  label: "grid (rows of digits and dots)",
  detect(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length && HEADER_RE.test(lines[0]!)) lines.shift();
    return lines.length >= 2 && lines.every((l) => /^[\s.\-_0-9A-G]+$/.test(l));
  },
  parse(text) {
    const lines = text.replace(/\s+$/, "").split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
    while (lines.length && lines[0]!.trim() === "") lines.shift();
    let maxb = 2, loops = true;
    if (lines.length && HEADER_RE.test(lines[0]!)) {
      for (const [, k, v] of lines.shift()!.matchAll(/(\w+)\s*[=:]\s*(\w+)/g)) {
        const key = k!.toLowerCase();
        if (key === "max" || key === "maxb") maxb = Number(v);
        else if (key === "loops") loops = !/^(no|false|0|off)$/i.test(v!);
        else throw new Error(`unknown option '${k}'`);
      }
    }
    if (!lines.length) throw new Error("no rows");
    const tokenMode = lines.some((l) => /\S\s+\S/.test(l.trim()));
    const rows = lines.map((l) => (tokenMode ? l.trim().split(/\s+/) : [...l]));
    const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
    if (rows.some((r) => r.length !== w)) throw new Error(`rows have different lengths (expected ${w})`);
    const islands: Island[] = [];
    rows.forEach((r, y) => r.forEach((tok, x) => {
      if (EMPTY.has(tok)) return;
      let n: number;
      if (/^\d+$/.test(tok)) n = Number(tok);
      else if (!tokenMode && tok >= "A" && tok <= "G") n = tok.charCodeAt(0) - 55;
      else throw new Error(`unexpected '${tok}' at row ${y + 1}, column ${x + 1}`);
      islands.push({ x, y, n });
    }));
    if (!Number.isInteger(maxb) || maxb < 1 || maxb > MAX_BRIDGES) throw new Error(`max must be 1 to ${MAX_BRIDGES}`);
    return finish({ w, h, maxb, loops, islands });
  },
  serialize(p) {
    const rows = Array.from({ length: p.h }, () => Array.from({ length: p.w }, () => "."));
    for (const is of p.islands) rows[is.y]![is.x] = is.n < 10 ? String(is.n) : String.fromCharCode(55 + is.n);
    const header = p.maxb !== 2 || !p.loops ? `max=${p.maxb} loops=${p.loops ? "yes" : "no"}\n` : "";
    return header + rows.map((r) => r.join("")).join("\n");
  },
};

// --- puzz.link / pzprjs ---

const PZPR_RE = /(?:^|[?/&])(?:hashikake|hashi|bridges)\/(\d+)\/(\d+)\/([0-9a-zA-Z.\-+=%@*$]*)/;

function readNumber16(s: string, i: number): [number, number] | null {
  const ca = s[i]!;
  if (/[0-9a-f]/.test(ca)) return [parseInt(ca, 16), 1];
  if (ca === "-") return [parseInt(s.substr(i + 1, 2), 16), 3];
  if (ca === "+") return [parseInt(s.substr(i + 1, 3), 16), 4];
  if (ca === "=") return [parseInt(s.substr(i + 1, 3), 16) + 4096, 4];
  if (ca === "%" || ca === "@") return [parseInt(s.substr(i + 1, 3), 16) + 8192, 4];
  if (ca === "*") return [parseInt(s.substr(i + 1, 4), 16) + 12240, 5];
  if (ca === "$") return [parseInt(s.substr(i + 1, 5), 16) + 77776, 6];
  if (ca === ".") return [-2, 1];
  return null;
}

function writeNumber16(n: number): string {
  if (n < 16) return n.toString(16);
  if (n < 256) return "-" + n.toString(16);
  return "+" + n.toString(16);
}

/**
 * puzz.link hashikake URLs (`…/p?hashi/W/H/body`). Those rules fix max bridges at 2 with loops
 * allowed, so export from puzzles with other rules keeps only the islands.
 */
export const pzprFormat: Format<BridgesPuzzle> = {
  id: "puzzlink",
  label: "puzz.link url (max 2, loops allowed)",
  detect: (t) => PZPR_RE.test(t.trim()),
  parse(text) {
    const m = PZPR_RE.exec(text.trim());
    if (!m) throw new Error("expected a puzz.link url like https://puzz.link/p?hashi/5/5/4g2i3h23k3g1g3g4g3");
    const w = Number(m[1]), h = Number(m[2]), body = m[3]!;
    if (w < 1 || h < 1 || w > 60 || h > 60) throw new Error("size out of range");
    const islands: Island[] = [];
    let c = 0, i = 0;
    while (i < body.length && c < w * h) {
      const r = readNumber16(body, i);
      if (r) {
        if (r[0] === -2) throw new Error("islands without a number aren't supported");
        if (!Number.isFinite(r[0]) || r[0] < 1) throw new Error(`bad island value in the url at ${i + 1}`);
        islands.push({ x: c % w, y: Math.floor(c / w), n: r[0] });
        i += r[1];
        c++;
      } else if (body[i]! >= "g" && body[i]! <= "z") {
        c += parseInt(body[i]!, 36) - 15;
        i++;
      } else {
        i++;
      }
    }
    return finish({ w, h, maxb: 2, loops: true, islands });
  },
  serialize(p) {
    const at = new Map(p.islands.map((is) => [is.y * p.w + is.x, is.n]));
    let out = "", count = 0;
    for (let c = 0; c < p.w * p.h; c++) {
      const n = at.get(c);
      if (n === undefined) {
        count++;
        if (count === 20) {
          out += (15 + count).toString(36);
          count = 0;
        }
        continue;
      }
      if (count) out += (15 + count).toString(36);
      count = 0;
      out += writeNumber16(n);
    }
    if (count) out += (15 + count).toString(36);
    return `https://puzz.link/p?hashi/${p.w}/${p.h}/${out}`;
  },
};

/** Share links use the first entry, which must be lossless. */
export const formats: readonly Format<BridgesPuzzle>[] = [sgtFormat, gridFormat, pzprFormat];
