import type { Session } from "../../core/session";
import type { Plugin } from "../../core/types";
import { D, DIRS, R, connectedFrom, coord, isTree, link, opp, type NetPuzzle } from "./grid";
import { analyse, net, type NetAction, type NetHintFocus, type NetInteraction, type NetState } from "./logic";
import { solveLogic } from "./solver";

/**
 * Derived-annotation keys shared by the assists and the view.
 * Cell sets are Uint8Array(n) of 0/1; side sets are Uint8Array(n) of direction masks.
 */
export const KEYS = {
  /** Cells joined to the source. */
  powered: "net.powered",
  /** Sides that are part of a closed loop. */
  loops: "net.loops",
  /** Pipe ends that don't meet a pipe. */
  loose: "net.loose",
  /** Sides where locked tiles disagree with each other or point into a wall. */
  conflicts: "net.conflicts",
  /** Locked tiles that don't match the solution. */
  wrong: "net.wrong",
} as const;

type NetPlugin = Plugin<NetPuzzle, NetState, NetAction, NetInteraction>;
type NetSession = Session<NetPuzzle, NetState, NetAction, NetInteraction>;

/** Sides of matched connections that lie on a cycle (i.e. are not bridges). */
export function loopSides(p: NetPuzzle, tiles: readonly number[]): Uint8Array {
  const n = p.w * p.h;
  const out = new Uint8Array(n);
  const ends: [number, number, number][] = [];
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (const d of [R, D]) {
      if (!(tiles[i]! & d)) continue;
      const j = link(p, i, d);
      if (j < 0 || !(tiles[j]! & opp(d))) continue;
      const id = ends.length;
      ends.push([i, d, j]);
      adj[i]!.push(id);
      adj[j]!.push(id);
    }
  }
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const bridge = new Uint8Array(ends.length);
  let time = 0;
  for (let s = 0; s < n; s++) {
    if (disc[s]! >= 0) continue;
    // frames: [vertex, edge used to enter it, next adjacency index]
    const stack: [number, number, number][] = [[s, -1, 0]];
    disc[s] = low[s] = time++;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const [v, via] = top;
      if (top[2] < adj[v]!.length) {
        const id = adj[v]![top[2]++]!;
        if (id === via) continue;
        const [a, , b] = ends[id]!;
        const u = a === v ? b : a;
        if (disc[u]! < 0) {
          disc[u] = low[u] = time++;
          stack.push([u, id, 0]);
        } else low[v] = Math.min(low[v]!, disc[u]!);
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
          const pv = parent[0];
          low[pv] = Math.min(low[pv]!, low[v]!);
          if (low[v]! > disc[pv]!) bridge[via] = 1;
        }
      }
    }
  }
  ends.forEach(([i, d, j], id) => {
    if (bridge[id]) return;
    out[i]! |= d;
    out[j]! |= opp(d);
  });
  return out;
}

export function looseSides(p: NetPuzzle, tiles: readonly number[]): Uint8Array {
  const out = new Uint8Array(tiles.length);
  tiles.forEach((m, i) => {
    for (const d of DIRS) {
      if (!(m & d)) continue;
      const j = link(p, i, d);
      if (j < 0 || !(tiles[j]! & opp(d))) out[i]! |= d;
    }
  });
  return out;
}

export function lockConflicts(p: NetPuzzle, s: NetState): Uint8Array {
  const out = new Uint8Array(s.tiles.length);
  s.tiles.forEach((m, i) => {
    if (!s.locked[i]) return;
    for (const d of DIRS) {
      const j = link(p, i, d);
      if (j < 0) {
        if (m & d) out[i]! |= d;
      } else if (s.locked[j] && !(m & d) !== !(s.tiles[j]! & opp(d))) {
        out[i]! |= d;
        out[j]! |= opp(d);
      }
    }
  });
  return out;
}

const powered: NetPlugin = {
  id: "net.powered",
  name: "light up the connected network",
  description: "pipes joined to the source are lit",
  category: "assists",
  appliesTo: [net],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state, interaction }) => ({
      ...d,
      [KEYS.powered]: connectedFrom(puzzle, state.tiles, interaction.source).cells,
    }), { owner });
  },
};

const loops: NetPlugin = {
  id: "net.loops",
  name: "show loops",
  description: "pipes that go round in a circle are marked",
  category: "assists",
  appliesTo: [net],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => ({ ...d, [KEYS.loops]: loopSides(puzzle, state.tiles) }), { owner });
  },
};

const loose: NetPlugin = {
  id: "net.loose",
  name: "show loose ends",
  description: "pipe ends that don't meet another pipe are marked",
  category: "assists",
  appliesTo: [net],
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => ({ ...d, [KEYS.loose]: looseSides(puzzle, state.tiles) }), { owner });
  },
};

/** Cells set in `now` but not in `before`. */
function fresh(before: Uint8Array, now: Uint8Array): number[] {
  const out: number[] = [];
  now.forEach((v, i) => { if (v && !before[i]) out.push(i); });
  return out;
}

/** Fires a mistake effect whenever a move adds cells to `marks`. */
function flagNew(session: NetSession, owner: string, marks: (p: NetPuzzle, s: NetState) => Uint8Array | null): void {
  session.hooks.change.tap(({ prev, state, cause }) => {
    if (cause !== "action") return;
    const now = marks(session.puzzle, state);
    const before = now && marks(session.puzzle, prev);
    if (!now || !before) return;
    const added = fresh(before, now);
    if (added.length) session.hooks.fx.call({ kind: "mistake", focus: { cell: added[0]!, cells: added } satisfies NetHintFocus });
  }, { owner });
}

function wrongLocks(p: NetPuzzle, s: NetState): Uint8Array | null {
  const a = analyse(p);
  if (!a.solution || !a.unique) return null;
  const sol = a.solution;
  return Uint8Array.from(s.tiles, (m, i) => (s.locked[i] && m !== sol[i] ? 1 : 0));
}

const conflicts: NetPlugin = {
  id: "net.conflicts",
  name: "flag clashing locked tiles",
  description: "locked tiles that can't both be right (or that point into a wall) are marked",
  category: "assists",
  appliesTo: [net],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => ({ ...d, [KEYS.conflicts]: lockConflicts(puzzle, state) }), { owner });
    flagNew(session, owner, lockConflicts);
  },
};

const check: NetPlugin = {
  id: "net.check",
  name: "check locked tiles against the solution",
  description: "locked tiles that are turned wrong are marked (spoiler)",
  category: "assists",
  appliesTo: [net],
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const wrong = wrongLocks(puzzle, state);
      return wrong ? { ...d, [KEYS.wrong]: wrong } : d;
    }, { owner });
    flagNew(session, owner, wrongLocks);
  },
};

/** Runs before technique hints, so a wrong lock is pointed out before anything is built on it. */
const mistakes: NetPlugin = {
  id: "net.mistakes",
  name: "hints point out wrong locks first",
  description: "before suggesting a move, a hint checks your locked tiles against the solution",
  category: "assists",
  appliesTo: [net],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle: p, state: s }) => {
      if (isTree(p, s.tiles)) return undefined;
      const a = analyse(p);
      if (!a.solution) return { message: "this puzzle has no solution" };
      const wrong = wrongLocks(p, s);
      const bad = wrong ? fresh(new Uint8Array(wrong.length), wrong) : [];
      if (bad.length) {
        return {
          message: `${coord(p, bad[0]!)} is locked the wrong way round`,
          focus: { cell: bad[0]!, cells: bad } satisfies NetHintFocus,
          actions: [{ type: "lock", cells: [bad[0]!], on: false }],
        };
      }
      if (!s.locked.some(Boolean)) return undefined;
      const givens = s.tiles.map((m, i) => (s.locked[i] ? m : -1));
      if (solveLogic(p, { tier: 2, givens }).status !== "contradiction") return undefined;
      const locked = s.locked.flatMap((l, i) => (l ? [i] : []));
      return { message: "the locked tiles can't all be right", focus: { cell: -1, cells: locked } satisfies NetHintFocus };
    }, { owner, priority: 50 });
  },
};

export const assists: NetPlugin[] = [powered, loops, loose, conflicts, check, mistakes];
