import { namespace } from "../../core/storage";
import type { Plugin, PuzzleRef } from "../../core/types";
import type { Ctx, Pos } from "./engine";

export type Scoring = "none" | "standard" | "vegas" | "vegas-keep" | "spider";

/** Dealing costs this much per deck in the vegas modes. */
export const VEGAS_STAKE = 52;

export const isVegas = (m: Scoring): boolean => m === "vegas" || m === "vegas-keep";

/** Standard: a second look at the deck costs 100 when turning one card, 20 after the third pass when turning more. */
const recycleCost = (draw: number, recycles: number): number => (draw === 1 ? 100 : recycles >= 3 ? 20 : 0);

/**
 * What a stock click or move scores, from the positions before and after it (spider scoring is
 * worked out from the state instead, see spiderScore). Standard: 5 for a waste card onto a
 * column, 10 for any card home, 5 for turning a card over, −15 for a card back from home. Vegas:
 * 5 for each card home and −5 for each taken back.
 */
export function gain(c: Ctx, mode: Scoring, before: Pos, after: Pos, m: { from: number; to: number; n: number } | null): number {
  if (mode === "none" || mode === "spider") return 0;
  const I = c.idx;
  if (!m) return mode === "standard" && !before.stock.length && I.waste >= 0 && recycleCost(c.rules.draw, after.recycles) ? -recycleCost(c.rules.draw, after.recycles) : 0;
  const vegas = isVegas(mode);
  const home = (pile: number) => pile >= I.found && pile < I.cols;
  let g = 0;
  if (home(m.to)) g += vegas ? 5 : 10;
  else if (m.from === I.waste && m.to >= I.cols && !vegas) g += 5;
  if (home(m.from)) g -= vegas ? 5 : 15;
  if (!vegas && m.from >= I.cols && after.down[m.from - I.cols]! < before.down[m.from - I.cols]!) g += 5;
  return g;
}

export const startScore = (mode: Scoring, decks: number): number => (isVegas(mode) ? -VEGAS_STAKE * decks : mode === "spider" ? 500 : 0);

/** Standard scores stop at zero; vegas keeps going below. */
export const settle = (mode: Scoring, score: number): number => (mode === "standard" ? Math.max(0, score) : score);

/** Microsoft Spider: 500 to start, a point off per move, 100 per finished run, never below zero. */
export const spiderScore = (moves: number, runsHome: number): number => Math.max(0, 500 - moves + 100 * runsHome);

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
/** Named for the game it was first kept for, so a running total kept before survives. */
const store = namespace("klondike");
const readBank = (): Bank => store.get<Bank>("bank", { base: 0, games: {}, order: [] });

/** The running total with this deal's current score in place of its stored one. */
export function bankTotal(key: string, current: number): number {
  const b = readBank();
  let sum = b.base + current;
  for (const k of b.order) if (k !== key) sum += b.games[k]!;
  return sum;
}

/** A deal's identity for the running total: the faces in dealing order and the cards turned at a time. Replaying or resuming never pays the stake twice. */
export const dealKey = (faces: readonly number[], draw: number): string => `${draw}:${faces.join(",")}`;

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
export function bankPlugin<Pz extends { scoring: Scoring }>(puzzle: PuzzleRef, keyOf: (p: Pz) => string): Plugin {
  return {
    id: "solitaire.bank",
    name: "vegas running total",
    description: "adds each vegas deal's winnings and stake to a total kept in this browser",
    category: "scoring",
    appliesTo: [puzzle],
    enabledByDefault: true,
    setup({ session, owner }) {
      const p = session.puzzle as Pz;
      if (p.scoring !== "vegas-keep") return;
      const key = keyOf(p);
      const save = () => record(key, (session.state as { score?: number }).score ?? 0);
      save();
      session.hooks.change.tap(save, { owner });
    },
  };
}
