/**
 * Builds data.json for the words-data pack from SCOWL 2020.12.07 (Kevin Atkinson's Spell Checker
 * Oriented Word Lists, wordlist.aspell.net). Run with
 * `bun run src/cli.ts data words [--cache <dir>] [--refresh]`; the release tarball is kept in the
 * cache directory and reused unless --refresh.
 *
 * Why this release: it is the latest SCOWL release with its word lists already split by size. Its
 * successor (the English Speller Database, en-wl/wordlist's v2 branch) has made only a
 * speller-dictionary release so far (rel-2026.02.25); its sized lists exist only after running its
 * Python and SQLite tooling, which this repository doesn't have.
 */
import { createHash } from "crypto";
import { gunzipSync } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { DataAttribute } from "../../core/types";
import { frontCode, type WordsDataFile } from "./codec";

const RELEASE = "2020.12.07";
const URL = `https://downloads.sourceforge.net/project/wordlist/SCOWL/${RELEASE}/scowl-${RELEASE}.tar.gz`;
const SHA256 = "5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc";

/**
 * SCOWL sizes up to 80. The README calls 80 "all the strange and unusual words people like to use
 * in word games such as Scrabble", generally valid; 95 "will probably not be considered valid
 * English words by most people", so it is left out.
 */
const SIZES = ["10", "20", "35", "40", "50", "55", "60", "70", "80"] as const;

/** SCOWL spelling categories → `spelling` values. "english" is spelled the same everywhere. */
const SPELLINGS = [
  { value: "us", label: "american", category: "american" },
  { value: "gb", label: "british (-ise)", category: "british" },
  { value: "gbz", label: "british (-ize, oxford)", category: "british_z" },
  { value: "ca", label: "canadian", category: "canadian" },
  { value: "au", label: "australian", category: "australian" },
] as const;

/** SCOWL's misc/ taboo lists counted as offensive: slurs (offensive.1, .2) and swear words (profane.1), not the milder profane.3. */
const OFFENSIVE = ["offensive.1", "offensive.2", "profane.1"];

/** Files of a .tar.gz, by path. Plain ustar: name, prefix, size; nothing else is needed here. */
export function untar(gz: Uint8Array<ArrayBuffer>): Map<string, Uint8Array> {
  const tar = gunzipSync(gz);
  const out = new Map<string, Uint8Array>();
  // header fields end at their first NUL byte
  const text = (from: number, len: number) => {
    const field = tar.subarray(from, from + len);
    const end = field.indexOf(0);
    return new TextDecoder("latin1").decode(end < 0 ? field : field.subarray(0, end));
  };
  for (let at = 0; at + 512 <= tar.length;) {
    const name = text(at, 100);
    if (!name) break;
    const size = parseInt(text(at + 124, 12).trim() || "0", 8);
    const type = text(at + 156, 1);
    const prefix = text(at + 257, 6).startsWith("ustar") ? text(at + 345, 155) : "";
    if (type === "0" || type === "") out.set(prefix ? `${prefix}/${name}` : name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

async function download(url: string, to: string, refresh: boolean): Promise<Uint8Array<ArrayBuffer>> {
  if (!refresh && existsSync(to)) return new Uint8Array(readFileSync(to));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(to, bytes);
  return bytes;
}

export async function buildWordsData(opts: { cache: string; out: string; refresh?: boolean }): Promise<WordsDataFile> {
  mkdirSync(opts.cache, { recursive: true });
  const gz = await download(URL, join(opts.cache, `scowl-${RELEASE}.tar.gz`), !!opts.refresh);
  const sum = createHash("sha256").update(gz).digest("hex");
  if (sum !== SHA256) throw new Error(`scowl-${RELEASE}.tar.gz: sha256 ${sum}, expected ${SHA256}; delete it from the cache to download it again`);
  const files = untar(gz);
  const root = `scowl-${RELEASE}`;
  // the word lists are latin-1 (accented words); only plain a-z words are kept
  const read = (path: string): string => {
    const f = files.get(`${root}/${path}`);
    if (!f) throw new Error(`${root}/${path}: not in the tarball`);
    return new TextDecoder("latin1").decode(f);
  };
  const lines = (path: string) => read(path).split("\n").map((l) => l.trim()).filter(Boolean);

  const size = new Map<string, number>(); // word → index into SIZES of its smallest size
  const spelling = new Map<string, Set<string>>();
  let skipped = 0;
  for (const category of ["english", ...SPELLINGS.map((s) => s.category)]) {
    const regions = category === "english" ? SPELLINGS.map((s) => s.value) : [SPELLINGS.find((s) => s.category === category)!.value];
    for (const [i, s] of SIZES.entries()) {
      for (const w of lines(`final/${category}-words.${s}`)) {
        if (!/^[a-z]+$/.test(w)) { skipped++; continue; }
        size.set(w, Math.min(size.get(w) ?? i, i));
        const set = spelling.get(w) ?? new Set<string>();
        for (const r of regions) set.add(r);
        spelling.set(w, set);
      }
    }
  }
  const taboo = new Set(OFFENSIVE.flatMap((f) => lines(`misc/${f}`)));
  const offensive = [...size.keys()].filter((w) => taboo.has(w)).sort();

  const order = SPELLINGS.map((s) => s.value as string);
  const groups = new Map<string, { common: string; spelling: string[]; words: string[] }>();
  for (const [w, i] of size) {
    const sp = [...spelling.get(w)!].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const key = `${i}|${sp.join()}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { common: SIZES[i]!, spelling: sp, words: [] }));
    g.words.push(w);
  }
  const grouped = [...groups.values()]
    .sort((a, b) => Number(a.common) - Number(b.common) || b.spelling.length - a.spelling.length || a.spelling.join().localeCompare(b.spelling.join()))
    .map((g) => ({ common: g.common, spelling: g.spelling, words: frontCode(g.words.sort()) }));

  const attributes: DataAttribute[] = [
    { id: "length", label: "length", kind: "number", unit: "letters", description: "how many letters it has" },
    {
      id: "common", label: "how common", kind: "ordinal",
      description: "the smallest SCOWL size listing it: lower is more common. SCOWL calls 35 small, 50 medium, 70 large and 80 the unusual words word games use",
      values: SIZES.map((s) => ({ value: s, label: `size ${s}` })),
    },
    { id: "spelling", label: "spelling", kind: "set", values: SPELLINGS.map((s) => ({ value: s.value, label: s.label })), description: "the spellings whose SCOWL word lists have it; words spelled the same everywhere have all of them" },
    { id: "offensive", label: "offensive", kind: "bool", description: `in SCOWL's lists of slurs or swear words (misc/${OFFENSIVE.join(", misc/")})` },
  ];
  const credits = `english words from SCOWL ${RELEASE} (wordlist.aspell.net) by Kevin Atkinson: lowercase a-z words of sizes 10 to 80, with their size and spelling. SCOWL's copyright notice, covering it and the lists it is made from:\n\n${read("Copyright").trim()}`;

  const body = { credits, attributes, groups: grouped, offensive };
  const version = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  const file: WordsDataFile = { version, ...body };
  writeFileSync(opts.out, JSON.stringify(file));
  console.log(`skipped ${skipped} entries that aren't plain a-z (capitals, apostrophes, accents)`);
  console.log(`by size: ${SIZES.map((s, i) => `${s}: ${[...size.values()].filter((x) => x === i).length}`).join(", ")}`);
  return file;
}
