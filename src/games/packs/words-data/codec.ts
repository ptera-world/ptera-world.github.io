import type { DataAttribute, DataItem, DataValue } from "../../core/types";

/**
 * The words-data pack's file. Words are grouped by everything stored about them except their
 * letters (how common, which spellings list them); within a group they are sorted and
 * front-coded: each word is one character saying how many leading letters it shares with the
 * word before it (0-9 then A-Z, at most 35), then the rest of its letters. Words are a-z only, so
 * that character also marks where each word starts. Length is read off the word itself.
 */
export interface WordsDataFile {
  version: string;
  credits: string;
  attributes: DataAttribute[];
  groups: { common: string; spelling: string[]; words: string }[];
  /** Words whose `offensive` value is true. */
  offensive: string[];
}

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function frontCode(sorted: readonly string[]): string {
  let out = "", prev = "";
  for (const w of sorted) {
    let n = 0;
    while (n < DIGITS.length - 1 && n < w.length && n < prev.length && w[n] === prev[n]) n++;
    out += DIGITS[n] + w.slice(n);
    prev = w;
  }
  return out;
}

export function frontDecode(text: string): string[] {
  const out: string[] = [];
  let prev = "";
  for (let i = 0; i < text.length;) {
    const n = DIGITS.indexOf(text[i]!);
    if (n < 0) throw new Error(`front-coded words: "${text[i]}" at ${i} isn't a count`);
    let j = i + 1;
    while (j < text.length && text.charCodeAt(j) >= 97 && text.charCodeAt(j) <= 122) j++;
    prev = prev.slice(0, n) + text.slice(i + 1, j);
    out.push(prev);
    i = j;
  }
  return out;
}

export function decode(file: WordsDataFile): DataItem[] {
  const offensive = new Set(file.offensive);
  const items: DataItem[] = [];
  for (const g of file.groups) {
    for (const word of frontDecode(g.words)) {
      const values: Record<string, DataValue> = { length: word.length, common: g.common, spelling: g.spelling, offensive: offensive.has(word) };
      items.push({ id: word, name: word, values });
    }
  }
  return items;
}
