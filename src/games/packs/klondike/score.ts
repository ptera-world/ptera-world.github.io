import { namespace } from "../../core/storage";
import type { Plugin, PuzzleRef } from "../../core/types";
import { COLS, FOUND, WASTE, type Pos } from "./solver";

export type Scoring = "none" | "standard" | "vegas" | "vegas-keep";

/** Dealing costs this much in the vegas modes. */
export const VEGAS_STAKE = 52;

export const isVegas = (m: Scoring): boolean => m === "vegas" || m === "vegas-keep";

/** Standard: a second look at the deck costs 100 when drawing one, 20 after the third pass when drawing three. */
const recycleCost = (draw: number, recycles: number): number => (draw === 1 ? 100 : recycles >= 3 ? 20 : 0);

/**
 * What a stock click or move scores, from the position before it. Standard: 5 for a waste card
 * onto a column, 10 for any card home, 5 for turning a card over, −15 for a card back from home.
 * Vegas: 5 for each card home and −5 for each taken back. Never negative in standard.
 */
export function gain(mode: Scoring, draw: number, before: Pos, after: Pos, m: { from: number; to: number; n: number } | null): number {
  if (mode === "none") return 0;
  if (!m) return mode === "standard" && !before.stock.length && recycleCost(draw, after.recycles) ? -recycleCost(draw, after.recycles) : 0;
  const vegas = isVegas(mode);
  let g = 0;
  if (m.to < COLS) g += vegas ? 5 : 10;
  else if (m.from === WASTE && !vegas) g += 5;
  if (m.from >= FOUND && m.from < COLS) g -= vegas ? 5 : 15;
  if (!vegas && m.from >= COLS && after.down[m.from - COLS]! < before.down[m.from - COLS]!) g += 5;
  return g;
}

export const startScore = (mode: Scoring): number => (isVegas(mode) ? -VEGAS_STAKE : 0);

/** Standard scores stop at zero; vegas keeps going below. */
export const settle = (mode: Scoring, score: number): number => (mode === "standard" ? Math.max(0, score) : score);

const TIME_STEP_S = 10;

/** Timed standard game: 2 off per ten seconds played, and on a win a bonus of 700000 over the seconds if it took over half a minute. */
export function timeAdjust(elapsedMs: number, won: boolean): number {
  const s = Math.floor(elapsedMs / 1000);
  return -2 * Math.floor(s / TIME_STEP_S) + (won && s > 30 ? Math.floor(700000 / s) : 0);
}

export const money = (n: number): string => (n < 0 ? `-$${-n}` : `$${n}`);

interface Bank {
  /** Total of the games dropped from `games`. */
  base: number;
  /** Latest score of recent games by deal. */
  games: Record<string, number>;
  order: string[];
}

const KEEP = 60;
const store = namespace("klondike");
const readBank = (): Bank => store.get<Bank>("bank", { base: 0, games: {}, order: [] });

/** The running total with this deal's current score in place of its stored one. */
export function bankTotal(key: string, current: number): number {
  const b = readBank();
  let sum = b.base + current;
  for (const k of b.order) if (k !== key) sum += b.games[k]!;
  return sum;
}

/** A deal's identity for the running total: replaying or resuming a deal never pays the stake twice. */
export const dealKey = (deck: readonly number[], draw: number): string => `${draw}:${deck.join(",")}`;

function record(key: string, score: number): void {
  const b = readBank();
  if (!(key in b.games)) b.order.push(key);
  b.games[key] = score;
  while (b.order.length > KEEP) {
    const old = b.order.shift()!;
    b.base += b.games[old]!;
    delete b.games[old];
  }
  store.set("bank", b);
}

/** Keeps the running vegas total: each deal's current score is stored as it changes. */
export function bankPlugin(puzzle: PuzzleRef): Plugin {
  return {
    id: "klondike.bank",
    name: "vegas running total",
    description: "adds each vegas deal's winnings and stake to a total kept in this browser",
    category: "scoring",
    appliesTo: [puzzle],
    enabledByDefault: true,
    setup({ session, owner }) {
      const p = session.puzzle as { deck: number[]; draw: number; scoring?: Scoring };
      if (p.scoring !== "vegas-keep") return;
      const key = dealKey(p.deck, p.draw);
      const save = () => record(key, (session.state as { score?: number }).score ?? 0);
      save();
      session.hooks.change.tap(save, { owner });
    },
  };
}

