/**
 * Builds data.json for the openings-data pack from lichess-org/chess-openings (CC0): one item per
 * named line. Every line is played through lib/chess from the starting position, so a move that
 * isn't legal, or SAN written differently from how lib/chess writes it, stops the build. Run with
 * `bun run src/cli.ts data openings [--cache <dir>] [--refresh]`; the downloads are kept in the
 * cache directory and reused unless --refresh.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { DataAttribute } from "../../core/types";
import { legalMoves, parseSan, play, startPosition, toSan } from "../../lib/chess/chess";
import { decode, familyOf, idOf, slug } from "./codec";
import type { OpeningsDataFile } from "./types";

const UPSTREAM = "https://raw.githubusercontent.com/lichess-org/chess-openings/master";
const VOLUMES = [
  { value: "A", label: "A: flank openings" },
  { value: "B", label: "B: semi-open games" },
  { value: "C", label: "C: open games and the French" },
  { value: "D", label: "D: closed and semi-closed games" },
  { value: "E", label: "E: Indian defenses" },
];

async function download(url: string, to: string, refresh: boolean): Promise<string> {
  if (!refresh && existsSync(to)) return readFileSync(to, "utf8");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  writeFileSync(to, text);
  return text;
}

/** The SAN moves of a PGN movetext ("1. e4 c5 2. Nf3" → ["e4", "c5", "Nf3"]), each checked legal and written the way lib/chess writes it. */
export function validLine(pgn: string): string[] {
  const tokens = pgn.trim().split(/\s+/).filter((t) => !/^\d+\.+$/.test(t));
  let p = startPosition();
  return tokens.map((t, i) => {
    const m = parseSan(p, t);
    if (!m) throw new Error(`"${pgn}": move ${i + 1} "${t}" isn't legal`);
    const san = toSan(p, m, legalMoves(p));
    if (san !== t) throw new Error(`"${pgn}": move ${i + 1} is written "${t}", lib/chess writes "${san}"`);
    p = play(p, m);
    return san;
  });
}

export async function buildOpeningsData(opts: { cache: string; out: string; refresh?: boolean }): Promise<OpeningsDataFile> {
  mkdirSync(opts.cache, { recursive: true });
  const lines: OpeningsDataFile["lines"] = [];
  for (const v of VOLUMES) {
    const tsv = await download(`${UPSTREAM}/${v.value.toLowerCase()}.tsv`, join(opts.cache, `${v.value.toLowerCase()}.tsv`), !!opts.refresh);
    const [head, ...rows] = tsv.split("\n").filter((l) => l.trim() !== "");
    if (head !== "eco\tname\tpgn") throw new Error(`${v.value}.tsv: unexpected header "${head}"`);
    for (const row of rows) {
      const [eco, name, pgn, ...extra] = row.split("\t");
      if (!eco || !name || !pgn || extra.length || !/^[A-E]\d\d$/.test(eco) || eco[0] !== v.value) throw new Error(`${v.value}.tsv: bad row "${row}"`);
      lines.push([eco, name.trim(), validLine(pgn).join(" ")]);
    }
  }
  const ids = new Map<string, string>();
  for (const [, name, moves] of lines) {
    const id = idOf(moves.split(" "));
    if (ids.has(id)) throw new Error(`"${name}" and "${ids.get(id)}" have the same moves ${moves}`);
    ids.set(id, name);
  }

  const families = [...new Set(lines.map(([, name]) => familyOf(name)))].sort((a, b) => a.localeCompare(b));
  if (new Set(families.map(slug)).size !== families.length) throw new Error("two families have the same slug");
  const firsts = [...new Set(lines.map(([, , moves]) => moves.split(" ")[0]!.replace(/[+#]/g, "")))].sort();
  const eco = VOLUMES.flatMap((v) => Array.from({ length: 100 }, (_, i) => `${v.value}${String(i).padStart(2, "0")}`));
  const attributes: DataAttribute[] = [
    { id: "eco", label: "ECO code", kind: "ordinal", near: { abs: 5 }, values: eco.map((c) => ({ value: c, label: c })), description: "its code in the Encyclopaedia of Chess Openings, A00 to E99; nearby codes are related lines" },
    { id: "volume", label: "ECO volume", kind: "category", values: VOLUMES, description: "the letter of its ECO code" },
    { id: "family", label: "opening", kind: "category", values: families.map((f) => ({ value: slug(f), label: f })), description: "the opening it is a line of: its name before any variation" },
    { id: "variation", label: "variation", kind: "bool", description: "named as a variation of an opening, not as the opening itself" },
    { id: "plies", label: "length", kind: "number", unit: "plies", near: { abs: 2 }, description: "how many moves the line has, white's and black's counted separately" },
    { id: "first", label: "first move", kind: "category", values: firsts.map((m) => ({ value: m, label: `1. ${m}` })) },
    { id: "pgn", label: "moves", kind: "text", description: "the line's moves, e.g. 1. e4 c5 2. Nf3" },
  ];

  const body = { credits: CREDITS, attributes, lines };
  const version = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  const file: OpeningsDataFile = { version, ...body };
  decode(file); // every line decodes
  writeFileSync(opts.out, JSON.stringify(file));
  return file;
}

const CREDITS = "named openings from lichess-org/chess-openings (github.com/lichess-org/chess-openings), CC0 1.0.";
