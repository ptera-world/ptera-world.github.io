import type { OpeningItem, OpeningsDataFile } from "./types";

/** The family is the name before its variation ("Sicilian Defense: Najdorf Variation" → "Sicilian Defense"). */
export const familyOf = (name: string): string => name.split(":")[0]!.trim();

/** Attribute value for a label: ascii, lowercase, words joined by "-" ("Grünfeld Defense" → "grunfeld-defense"). */
export const slug = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Item id: the moves without check marks, joined by "." ("e4.c5.Nf3"); moves name a line uniquely. */
export const idOf = (moves: readonly string[]): string => moves.map((m) => m.replace(/[+#]/g, "")).join(".");

/** "1. e4 c5 2. Nf3" */
export const pgnOf = (moves: readonly string[]): string =>
  moves.map((m, i) => (i % 2 ? m : `${i / 2 + 1}. ${m}`)).join(" ");

/** Items from the file's lines; every attribute value derives from eco, name and moves. */
export function decode(file: OpeningsDataFile): OpeningItem[] {
  return file.lines.map(([eco, name, line]) => {
    const moves = line.split(" ");
    const plain = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return {
      id: idOf(moves),
      name,
      ...(plain !== name ? { aliases: [plain] } : {}),
      moves,
      values: {
        eco,
        volume: eco[0]!,
        family: slug(familyOf(name)),
        variation: name.includes(":"),
        plies: moves.length,
        first: moves[0]!.replace(/[+#]/g, ""),
        pgn: pgnOf(moves),
      },
    };
  });
}
