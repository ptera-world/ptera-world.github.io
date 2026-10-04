import type { Snapshot } from "../../core/session";
import { namespace } from "../../core/storage";

/**
 * Saved games as first-class records: any number per puzzle, each with its own id, listed in an
 * index so they can be browsed, switched between and closed. Storage is shared across tabs; the
 * `storage` event tells other tabs when a game or the index changed.
 */

export interface SessionMeta {
  id: string;
  puzzleId: string;
  /** Identity of the puzzle source, so opening the same link finds the same game. */
  key: string;
  title: string;
  detail: string;
  updatedAt: number;
  solved: boolean;
  elapsedMs: number;
  practice: boolean;
}

const games = namespace("game");
const meta = namespace("games-index");
const KEEP = 40;

export const SAVE_PREFIX = "games:game:";
export const INDEX_KEY = "games:games-index:list";

export function listSessions(): SessionMeta[] {
  return meta.get<SessionMeta[]>("list", []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): Snapshot | null {
  return games.get<Snapshot | null>(id, null);
}

export function saveSession(m: SessionMeta, snap: Snapshot): void {
  games.set(m.id, snap);
  const list = listSessions().filter((x) => x.id !== m.id);
  list.unshift(m);
  // drop the oldest finished games first, then the oldest of anything, beyond KEEP
  while (list.length > KEEP) {
    const i = list.map((x) => x.solved).lastIndexOf(true);
    const [gone] = list.splice(i >= 0 ? i : list.length - 1, 1);
    if (gone) games.remove(gone.id);
  }
  meta.set("list", list);
}

export function removeSession(id: string): void {
  games.remove(id);
  meta.set("list", listSessions().filter((x) => x.id !== id));
}

/** Most recent game for a puzzle matching `key` (or any non-practice game when key is null). */
export function findSession(puzzleId: string, key: string | null, practice = false): SessionMeta | undefined {
  return listSessions().find((m) => m.puzzleId === puzzleId && m.practice === practice && (key === null ? !m.solved : m.key === key));
}

export function newSessionId(): string {
  return crypto.randomUUID().slice(0, 8);
}
