import { effective, resolve, type Values } from "../../core/schema";
import type { Format } from "../../core/types";
import { cardCode, cardName, face, msDeal, parseCard, parseCards, rankOf, suitOf } from "../../lib/cards/deck";
import { foundationSuits, type Rules } from "./engine";
import { checkFaces, dealOrder, foundationSlots, makePuzzle, type SolitairePuzzle } from "./deal";
import { params } from "./params";
import { presets } from "./presets";
import type { Scoring } from "./score";

type V = Values<typeof params>;

const presetValues = (label: string): V => effective(params, resolve(params, presets.find((p) => p.label === label)!.params));

/** The parts of a puzzle a format has to reproduce, by face (card ids may differ; the solution and the deal number aren't part of the table). */
function essence(p: SolitairePuzzle): string {
  const f = (ids: readonly number[]) => ids.map((id) => (id < 0 ? -1 : p.faces[id]!));
  return JSON.stringify([p.rules, p.cols.map(f), p.down, f(p.cells), p.found.map(f), f(p.stock), p.scoring, p.timed]);
}

/** Writes with `write`, and refuses unless reading the text back gives the same deal. */
function exact(write: (p: SolitairePuzzle) => string, read: (text: string) => SolitairePuzzle, what: string): (p: SolitairePuzzle) => string {
  return (p) => {
    let text: string;
    try {
      text = write(p);
      if (essence(read(text)) === essence(p)) return text;
    } catch { /* falls through to the refusal */ }
    throw new Error(`this deal isn't ${what}`);
  };
}

// --- the whole table ---

const SCORINGS: readonly Scoring[] = ["none", "standard", "vegas", "vegas-keep", "spider"];
const KEYS = { build: ["alternate", "suit", "any", "color", "other"], runs: ["built", "suit", "any", "space", "one"], empty: ["any", "kings", "none"], home: ["cards", "runs"], stock: ["waste", "row"] } as const;

const LINE_RE = /^\s*(rules|stock|cells|foundations)\s*:(.*)$/i;

/**
 * Any deal of any setup. A "rules:" line (build, runs, empty, home, stock, draw, passes, scoring
 * and the flags take back, up and down, fill first, timed), "stock:" (first card dealt first),
 * "cells:" (- for an empty one), "foundations:" (the top card of each, - for none), then one
 * line per column, bottom card first, its face-down cards before a "|".
 */
export const tableFormat: Format<SolitairePuzzle> = {
  id: "table",
  label: "table (rules, then every pile)",
  detect: (t) => /^\s*rules\s*:/im.test(t),
  parse(text) {
    const r: Rules = { build: "alternate", updown: false, runs: "built", empty: "kings", home: "cards", takeBack: false, stock: "waste", draw: 1, passes: 0, fillFirst: false };
    let scoring: Scoring = "none", timed = false;
    let stockCodes: number[] = [], cellCodes: number[] = [], tops: number[] = [];
    const colCodes: { down: number[]; up: number[] }[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = LINE_RE.exec(line);
      if (!m) {
        const [a, b] = line.split("|");
        colCodes.push(b === undefined ? { down: [], up: parseCards(a!) } : { down: parseCards(a!), up: parseCards(b) });
        continue;
      }
      const body = m[2]!.trim();
      const key = m[1]!.toLowerCase();
      if (key === "rules") {
        for (const item of body.split(/[;,]/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
          const [k, val = ""] = item.split(/\s+/, 2) as [string, string?];
          if (item === "take back") r.takeBack = true;
          else if (item === "up and down") r.updown = true;
          else if (item === "fill first") r.fillFirst = true;
          else if (item === "timed") timed = true;
          else if (k === "draw" || k === "passes") r[k] = Number(val);
          else if (k === "scoring" && (SCORINGS as readonly string[]).includes(val)) scoring = val as Scoring;
          else if (k in KEYS && (KEYS[k as keyof typeof KEYS] as readonly string[]).includes(val)) (r as unknown as Record<string, string>)[k] = val;
          else throw new Error(`"${item}" is not a rule`);
        }
      } else if (key === "stock") stockCodes = parseCards(body);
      else if (key === "cells") cellCodes = body.split(/\s+/).filter(Boolean).map((x) => (x === "-" ? -1 : parseCard(x)));
      else tops = body.split(/\s+/).filter(Boolean).map((x) => (x === "-" ? -1 : parseCard(x)));
    }
    if (!colCodes.length) throw new Error("expected at least one column");
    if (!Number.isInteger(r.draw) || r.draw < 1 || r.draw > 5) throw new Error("draw runs from 1 to 5");
    if (!Number.isInteger(r.passes) || r.passes < 0 || r.passes > 10) throw new Error("passes run from 0 (no limit) to 10");
    if (r.home !== "cards") r.takeBack = false;
    const faces: number[] = [];
    const add = (f: number) => faces.push(f) - 1;
    const cols = colCodes.map((c) => [...c.down, ...c.up].map(add));
    const cells = cellCodes.map((f) => (f < 0 ? -1 : add(f)));
    const homeCards = tops.filter((t) => t >= 0).map((t) => Array.from({ length: rankOf(t) }, (_, i) => add(face(suitOf(t), i + 1))));
    const stock = stockCodes.map(add).reverse();
    checkFaces(faces);
    const fsuit = foundationSuits(faces);
    const found = foundationSlots(faces);
    for (const pile of homeCards) {
      const f = fsuit.findIndex((s, i) => s === suitOf(faces[pile[0]!]!) && !found[i]!.length);
      if (f < 0) throw new Error("more foundations than the deck has");
      found[f] = pile;
    }
    if (scoring === "spider" ? r.home !== "runs" : scoring !== "none" && r.home !== "cards") throw new Error(`${scoring} scoring doesn't go with these foundations`);
    return { rules: r, faces, cols, down: colCodes.map((c) => c.down.length), cells, found, stock, scoring, timed: timed && scoring === "standard" };
  },
  serialize(p) {
    const r = p.rules;
    const code = (id: number) => cardCode(p.faces[id]!);
    const flags = [r.takeBack && "take back", r.updown && "up and down", r.fillFirst && "fill first", p.timed && "timed"].filter(Boolean);
    const lines = [`rules: build ${r.build}; runs ${r.runs}; empty ${r.empty}; home ${r.home}; stock ${r.stock}; draw ${r.draw}; passes ${r.passes}; scoring ${p.scoring}${flags.map((f) => `; ${f}`).join("")}`];
    if (p.stock.length) lines.push(`stock: ${p.stock.slice().reverse().map(code).join(" ")}`);
    if (p.cells.length) lines.push(`cells: ${p.cells.map((x) => (x < 0 ? "-" : code(x))).join(" ")}`);
    if (p.found.some((f) => f.length)) lines.push(`foundations: ${p.found.map((f) => (f.length ? code(f[f.length - 1]!) : "-")).join(" ")}`);
    p.cols.forEach((col, j) => {
      const d = p.down[j]!;
      lines.push(d ? `${col.slice(0, d).map(code).join(" ")} | ${col.slice(d).map(code).join(" ")}` : col.map(code).join(" ") || "|");
    });
    return lines.join("\n");
  },
};

// --- Klondike: a draw line and 52 cards ---

const KLONDIKE_HEAD = /^\s*draw\s*([1-5])(?:\s*[,;]?\s*passes\s*(\d+))?(?:\s*[,;]?\s*scoring\s*(none|standard|vegas|vegas-keep))?(\s*[,;]?\s*timed)?\s*$/im;

function parseKlondike(text: string): SolitairePuzzle {
  const head = KLONDIKE_HEAD.exec(text);
  const deck = parseCards(text.replace(KLONDIKE_HEAD, ""));
  if (deck.length !== 52) throw new Error(`expected 52 cards, got ${deck.length}`);
  if (new Set(deck).size !== 52) throw new Error(`${cardName(deck.find((c, i) => deck.indexOf(c) !== i)!)} appears twice`);
  const passes = Number(head?.[2] ?? 0);
  if (passes < 0 || passes > 10) throw new Error("passes run from 0 (no limit) to 10");
  const scoring = (head?.[3] ?? "standard") as Scoring;
  return makePuzzle({ ...presetValues("Klondike"), draw: Number(head?.[1] ?? 1), passes, scoring, timed: !!head?.[4] && scoring === "standard" }, deck);
}

/**
 * Klondike deals: an optional "draw 3, passes 1, scoring vegas" line, then the 52 cards as codes
 * (like TH or 5c) in dealing order: 28 to the columns, row by row (row 1 across all seven columns,
 * row 2 across columns 2–7, …, each column's last card face up), then the stock, first card drawn first.
 */
export const klondikeFormat: Format<SolitairePuzzle> = {
  id: "klondike",
  label: "Klondike deal (draw line, then 52 cards in dealing order)",
  detect: (t) => /^(?:\s*draw\s*[1-5].*\n)?(?:\s*(?:10|[A2-9TJQK])[CDHS♣♦♥♠]\s*,?){52}\s*$/i.test(t),
  parse: parseKlondike,
  serialize: exact((p) => {
    const deck = dealOrder(p).map((id) => cardCode(p.faces[id]!));
    return `draw ${p.rules.draw}, passes ${p.rules.passes}, scoring ${p.scoring}${p.timed ? ", timed" : ""}\n${deck.slice(0, 28).join(" ")}\n${deck.slice(28).join(" ")}`;
  }, parseKlondike, "a Klondike deal"),
};

// --- Spider: whole decks in dealing order ---

const SPIDER_HEAD = /^\s*(?:(?:suits?|columns?|deals?)\s*\d+\s*[,;]?\s*)+$/gim;
const headNumber = (head: string, key: string): number | undefined => {
  const m = new RegExp(`${key}s?\\s*(\\d+)`, "i").exec(head);
  return m ? Number(m[1]) : undefined;
};

/** Most stock deals a deck can pay for while every column still starts with a card. */
const maxDeals = (cards: number, columns: number): number => Math.max(0, Math.floor(cards / columns) - 1);

function parseSpider(text: string): SolitairePuzzle {
  const head = (text.match(SPIDER_HEAD) ?? []).join(" ");
  const faces = parseCards(text.replace(SPIDER_HEAD, ""));
  if (faces.length % 52 || faces.length < 52 || faces.length > 208) throw new Error(`expected 52, 104, 156 or 208 cards, got ${faces.length}`);
  const used = new Set(faces.map(suitOf)).size;
  if (![1, 2, 4].includes(used)) throw new Error("use 1, 2 or 4 suits");
  checkFaces(faces);
  const columns = headNumber(head, "column") ?? 10;
  if (columns < 2 || columns > 16) throw new Error("columns run from 2 to 16");
  const deals = headNumber(head, "deal") ?? Math.min(5, maxDeals(faces.length, columns));
  if (deals < 1 || deals > maxDeals(faces.length, columns)) throw new Error(`with ${columns} columns this deck pays for 1 to ${maxDeals(faces.length, columns)} stock deals`);
  const v: V = { ...presetValues("Spider"), decks: faces.length / 52, suits: String(used), columns, stock: deals * columns };
  return makePuzzle(v, faces.map((_, i) => i), undefined, faces);
}

/**
 * Spider deals: optional "suits 2, columns 10, deals 5" lines, then the cards as codes (like TH)
 * in dealing order: all but the stock round the columns, then the stock, first deal first.
 */
export const spiderFormat: Format<SolitairePuzzle> = {
  id: "spider",
  label: "Spider deal (cards in dealing order)",
  detect: (t) => {
    const n = (t.replace(SPIDER_HEAD, "").match(/(?:10|[A2-9TJQK])[CDHS]/gi) ?? []).length;
    return n % 52 === 0 && n >= 52 && n <= 208 && (n > 52 || new RegExp(SPIDER_HEAD.source, "im").test(t));
  },
  parse: parseSpider,
  serialize: exact((p) => {
    const c = p.cols.length;
    const deck = dealOrder(p).map((id) => cardCode(p.faces[id]!));
    return `suits ${new Set(p.faces.map(suitOf)).size}, columns ${c}, deals ${p.stock.length / c}\n${Array.from({ length: Math.ceil(deck.length / c) }, (_, r) => deck.slice(r * c, r * c + c).join(" ")).join("\n")}`;
  }, parseSpider, "a Spider deal"),
};

// --- FreeCell ---

const FC_RE = /^\s*(?:fc|freecells)\s*:/i;
const FOUND_RE = /^\s*(?:founds|foundations)\s*:/i;
const SUIT_INDEX: Record<string, number> = { C: 0, D: 1, H: 2, S: 3 };
const RANK_INDEX = "0A23456789TJQK";

/** A FreeCell table from faces (one deck, so ids are faces). */
function freecellTable(cols: number[][], cells: number[], tops: number[]): SolitairePuzzle {
  const v = presetValues("FreeCell");
  const base = makePuzzle({ ...v, cells: cells.length }, Array.from({ length: 52 }, (_, i) => i));
  const seen = new Set<number>();
  const add = (c: number) => {
    if (seen.has(c)) throw new Error(`${cardName(c)} appears twice`);
    seen.add(c);
  };
  cols.flat().forEach(add);
  cells.filter((c) => c >= 0).forEach(add);
  tops.forEach((r, s) => { for (let i = 1; i <= r; i++) add(s * 13 + i - 1); });
  if (seen.size !== 52) {
    const missing = Array.from({ length: 52 }, (_, i) => i).filter((c) => !seen.has(c)).map(cardName);
    throw new Error(`missing ${missing.slice(0, 6).join(" ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""}`);
  }
  if (cols.length < 1 || cols.length > 16) throw new Error("expected 1 to 16 columns");
  if (cells.length < 1 || cells.length > 10) throw new Error("expected 1 to 10 free cells");
  return {
    ...base, cols: cols.map((c) => c.slice()), down: cols.map(() => 0), cells: cells.slice(), stock: [],
    found: tops.map((r, s) => Array.from({ length: r }, (_, i) => s * 13 + i)),
  };
}

function parseFcs(text: string): SolitairePuzzle {
  const cols: number[][] = [];
  let cells: number[] = [-1, -1, -1, -1];
  const tops = [0, 0, 0, 0];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    if (FC_RE.test(line)) {
      cells = line.replace(FC_RE, "").trim().split(/\s+/).filter(Boolean).map((x) => (x === "-" ? -1 : parseCard(x)));
      continue;
    }
    if (FOUND_RE.test(line)) {
      for (const item of line.replace(FOUND_RE, "").trim().split(/\s+/).filter(Boolean)) {
        const m = /^([CDHS])-(0|10|[A2-9TJQK])$/i.exec(item);
        if (!m) throw new Error(`"${item}" is not a foundation (expected like H-5 or S-0)`);
        tops[SUIT_INDEX[m[1]!.toUpperCase()]!] = m[2] === "10" ? 10 : RANK_INDEX.indexOf(m[2]!.toUpperCase());
      }
      continue;
    }
    cols.push(line.replace(/^:/, "").trim().split(/\s+/).filter(Boolean).map(parseCard));
  }
  return freecellTable(cols, cells, tops);
}

/**
 * Freecell Solver's board text: one line per column, cards from the bottom of the column (the one
 * on the table) to the top, e.g. "4C 2C 9C 8C QS 4S 2H"; an optional "Freecells: 8H - -" line
 * and "Foundations: H-5 C-A S-0 D-K" line. A column line may start with ":".
 */
export const fcsFormat: Format<SolitairePuzzle> = {
  id: "fcs",
  label: "FreeCell board (Freecell Solver layout: a line of cards per column)",
  detect: (t) => t.trim().split(/\r?\n/).filter((l) => l.trim()).length >= 4 && /^[\s:]*(?:10|[A2-9TJQK])[CDHS]\b/i.test(t.trim().split(/\r?\n/).find((l) => !FC_RE.test(l) && !FOUND_RE.test(l)) ?? ""),
  parse: parseFcs,
  serialize: exact((p) => {
    const code = (id: number) => cardCode(p.faces[id]!);
    const lines = p.cols.map((c) => `: ${c.map(code).join(" ")}`.trimEnd());
    const head: string[] = [];
    if (p.found.some((f) => f.length)) head.push(`Foundations: ${p.found.map((f, s) => `${"CDHS"[s]}-${f.length ? RANK_INDEX[f.length] : "0"}`).join(" ")}`);
    head.push(`Freecells: ${p.cells.map((c) => (c < 0 ? "-" : code(c))).join(" ")}`);
    return [...head, ...lines].join("\n");
  }, parseFcs, "a FreeCell board"),
};

/** Microsoft FreeCell deal numbers: "#617", "617". */
export const msFormat: Format<SolitairePuzzle> = {
  id: "ms",
  label: "FreeCell deal number (Microsoft FreeCell, 1 to 2147483647)",
  detect: (t) => /^\s*(?:#|game\s*|deal\s*)?\d+\s*$/i.test(t),
  parse(text) {
    const n = Number(/\d+/.exec(text)?.[0]);
    if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new Error("deal numbers run from 1 to 2147483647");
    return makePuzzle(presetValues("FreeCell"), msDeal(n), n);
  },
};

export const formats = [tableFormat, klondikeFormat, spiderFormat, fcsFormat, msFormat];
