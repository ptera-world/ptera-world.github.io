/** Breadth-first search over states named by keys. */
export interface Search<S, M, K> {
  /** Moves from the nearest start, by key. */
  dist: Map<K, number>;
  /** How each non-start state was first reached (empty when parents weren't kept). */
  parent: Map<K, { from: K; move: M }>;
  state: Map<K, S>;
  /** Keys in the order they were reached. */
  order: K[];
  /** False if `limit` stopped the search before it saw everything reachable. */
  complete: boolean;
  /** Key of the first state `stop` accepted, if any (the search ends there). */
  found: K | null;
}

export interface SearchOptions<S, K> {
  /** Most states to keep. */
  limit?: number;
  /** End the search at the first state this accepts. */
  stop?: (s: S, k: K) => boolean;
  /** Keep `parent` (default true). */
  parents?: boolean;
}

/**
 * Every state reachable from `starts` (up to `limit` states), level by level. `next` lists the
 * moves from a state and where each leads. Deterministic in the order of `starts` and `next`.
 */
export function bfs<S, M, K = string>(
  starts: readonly S[],
  key: (s: S) => K,
  next: (s: S) => Iterable<readonly [M, S]>,
  opts: SearchOptions<S, K> = {},
): Search<S, M, K> {
  const limit = opts.limit ?? Infinity;
  const keep = opts.parents ?? true;
  const dist = new Map<K, number>(), parent = new Map<K, { from: K; move: M }>(), state = new Map<K, S>();
  const order: K[] = [];
  const done = (complete: boolean, found: K | null): Search<S, M, K> => ({ dist, parent, state, order, complete, found });
  for (const s of starts) {
    const k = key(s);
    if (dist.has(k)) continue;
    dist.set(k, 0);
    state.set(k, s);
    order.push(k);
    if (opts.stop?.(s, k)) return done(false, k);
  }
  for (let i = 0; i < order.length; i++) {
    const k = order[i]!, s = state.get(k)!, d = dist.get(k)! + 1;
    for (const [move, t] of next(s)) {
      const tk = key(t);
      if (dist.has(tk)) continue;
      if (order.length >= limit) return done(false, null);
      dist.set(tk, d);
      state.set(tk, t);
      order.push(tk);
      if (keep) parent.set(tk, { from: k, move });
      if (opts.stop?.(t, tk)) return done(false, tk);
    }
  }
  return done(true, null);
}

/** The moves from a start to `k`, in order. */
export function pathTo<S, M, K>(search: Search<S, M, K>, k: K): M[] {
  const out: M[] = [];
  for (let cur = search.parent.get(k); cur; cur = search.parent.get(cur.from)) out.push(cur.move);
  return out.reverse();
}
