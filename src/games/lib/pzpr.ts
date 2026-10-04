import { pieces } from "./grid-kit/grid";

/**
 * puzz.link / pzv.jp URL body pieces. Borders: (w - 1) × h vertical walls row by row, then
 * w × (h - 1) horizontal ones, 5 bits per base-32 character, high bit first. Region ids come out
 * numbered in row-major order of each region's first cell.
 */
export function decodeBorders(w: number, h: number, body: string): { regions: number[]; rest: string } {
  const nv = (w - 1) * h, nh = w * (h - 1);
  const lenV = Math.ceil(nv / 5), lenH = Math.ceil(nh / 5);
  if (body.length < lenV + lenH) throw new Error("not enough border data for the grid");
  const bits = (s: string, count: number) => {
    const out: number[] = [];
    for (const ch of s) {
      const v = parseInt(ch, 32);
      if (Number.isNaN(v)) throw new Error(`unexpected character "${ch}" in the borders`);
      for (let b = 4; b >= 0 && out.length < count; b--) out.push((v >> b) & 1);
    }
    return out;
  };
  const vert = bits(body.slice(0, lenV), nv), horiz = bits(body.slice(lenV, lenV + lenH), nh);
  const joined: number[][] = Array.from({ length: w * h }, () => []);
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) if (!vert[y * (w - 1) + x]) {
    const c = y * w + x;
    joined[c]!.push(c + 1);
    joined[c + 1]!.push(c);
  }
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) if (!horiz[y * w + x]) {
    const c = y * w + x;
    joined[c]!.push(c + w);
    joined[c + w]!.push(c);
  }
  return { regions: Array.from(pieces(joined, () => true).id), rest: body.slice(lenV + lenH) };
}

export function encodeBorders(w: number, h: number, regions: readonly number[]): string {
  const pack = (bits: number[]) => {
    let out = "";
    for (let i = 0; i < bits.length; i += 5) {
      let v = 0;
      for (let b = 0; b < 5; b++) v = (v << 1) | (bits[i + b] ?? 0);
      out += v.toString(32);
    }
    return out;
  };
  const vert: number[] = [], horiz: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) vert.push(+(regions[y * w + x] !== regions[y * w + x + 1]));
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) horiz.push(+(regions[y * w + x] !== regions[(y + 1) * w + x]));
  return pack(vert) + pack(horiz);
}

/**
 * `count` numbers in pzpr's number16 code: a hex digit for 0–15, `-` and two hex digits up to
 * 255, `+` and three up to 4095, `.` for an unknown number (-2), and `g`–`z` for 1–20 blanks
 * (-1). Returns them and what follows.
 */
export function decodeNumber16(body: string, count: number): { values: number[]; rest: string } {
  const values: number[] = [];
  let i = 0;
  const hex = (len: number) => {
    const s = body.slice(i, i + len);
    if (s.length < len || !/^[0-9a-f]+$/.test(s)) throw new Error("bad number in the clue data");
    i += len;
    return parseInt(s, 16);
  };
  while (values.length < count && i < body.length) {
    const ch = body[i++]!;
    if (/[0-9a-f]/.test(ch)) values.push(parseInt(ch, 16));
    else if (ch === "-") values.push(hex(2));
    else if (ch === "+") values.push(hex(3));
    else if (ch === ".") values.push(-2);
    else if (ch >= "g" && ch <= "z") for (let k = parseInt(ch, 36) - 15; k > 0; k--) values.push(-1);
    else throw new Error(`unexpected character "${ch}" in the clue data`);
  }
  if (values.length > count) throw new Error("too much clue data for the grid");
  while (values.length < count) values.push(-1);
  return { values, rest: body.slice(i) };
}

/** Inverse of decodeNumber16 (-1 blank, -2 unknown). */
export function encodeNumber16(values: readonly number[]): string {
  let out = "", blanks = 0;
  const flush = () => {
    if (blanks) out += (blanks + 15).toString(36);
    blanks = 0;
  };
  for (const v of values) {
    if (v === -1) {
      if (++blanks === 20) flush();
      continue;
    }
    flush();
    if (v === -2) out += ".";
    else if (v < 16) out += v.toString(16);
    else if (v < 256) out += `-${v.toString(16).padStart(2, "0")}`;
    else out += `+${v.toString(16).padStart(3, "0")}`;
  }
  flush();
  return out;
}
