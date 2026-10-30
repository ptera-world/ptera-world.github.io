import { resolve } from "../../core/schema";
import type { Format } from "../../core/types";
import { obfuscateBitmap } from "../../lib/sha1";
import type { WordlePuzzle } from "./engine";
import type { Params } from "./params";

const SGT_RE = /^([cpgbBmMfF\d]*):([0-9a-fA-F]+)$/;

/**
 * Simon Tatham's Guess game ids (`c6p4g10Bm:hex`, an `f` after the m/M for marks on each peg), the
 * code hidden the way the original hides it, so ids can be shared without giving it away.
 */
export function sgtFormat(params: Params): Format<WordlePuzzle> {
  return {
    id: "sgt",
    label: "Guess game id (c6p4g10Bm:…)",
    detect: (t) => SGT_RE.test(t.trim()),
    parse(t) {
      const m = SGT_RE.exec(t.trim());
      if (!m) throw new Error("expected params:hex, e.g. c6p4g10Bm:1a2b3c4d");
      let colours = 6, pegs = 4, guesses = 10, blanks = false, duplicates = true, perPeg = false;
      for (const [, key, v] of m[1]!.matchAll(/([cpgbBmMfF])(\d*)/g)) {
        if (key === "c") colours = Number(v);
        else if (key === "p") pegs = Number(v);
        else if (key === "g") guesses = Number(v);
        else if (key === "b" || key === "B") blanks = key === "b";
        else if (key === "m" || key === "M") duplicates = key === "m";
        else if (key === "f") perPeg = true;
      }
      if (!(colours >= 2 && colours <= 10)) throw new Error("colors must be between 2 and 10");
      if (!(pegs >= 2 && pegs <= 10)) throw new Error("pegs must be between 2 and 10");
      if (!(guesses >= 1)) throw new Error("there must be at least one guess");
      if (m[2]!.length !== pegs * 2) throw new Error(`expected ${pegs * 2} hex digits`);
      const bmp = Uint8Array.from({ length: pegs }, (_, i) => parseInt(m[2]!.slice(2 * i, 2 * i + 2), 16));
      obfuscateBitmap(bmp, pegs * 8, true);
      const code = Array.from(bmp);
      if (code.some((v) => v < 1 || v > colours)) throw new Error("the game id is corrupted");
      const s = resolve(params, { secret: "codes", symbols: "colors", alphabet: colours, minLen: pegs, maxLen: pegs, limit: guesses, blanks, distinct: !duplicates, marks: perPeg ? "positions" : "counts" });
      return { s, length: pegs, split: [], boards: [{ answers: [{ seq: code.map(String) }] }], starters: [], seed: m[2]! };
    },
    serialize(p) {
      if (p.s.secret !== "codes" || p.s.symbols !== "colors" || p.boards.length !== 1 || p.boards[0]!.answers.length !== 1) throw new Error("only a single color code has a Guess game id");
      const code = p.boards[0]!.answers[0]!.seq!.map(Number);
      const bmp = Uint8Array.from(code);
      obfuscateBitmap(bmp, p.length * 8, false);
      const hex = Array.from(bmp, (v) => v.toString(16).padStart(2, "0")).join("");
      return `c${p.s.alphabet}p${p.length}g${p.s.limit}${p.s.blanks ? "b" : "B"}${p.s.distinct ? "M" : "m"}${p.s.marks === "positions" ? "f" : ""}:${hex}`;
    },
  };
}
