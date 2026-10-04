/** A winning line from a position, or why there is none. */
export interface Plan<M> {
  path: M[] | null;
  /** No win exists (the search finished); false when it only ran out of budget. */
  impossible: boolean;
}

/**
 * Memoised search for a winning line. Every position along a found line is remembered with the
 * rest of that line, so following the plan move by move searches only once; a stored line from
 * the start (e.g. found while dealing) is used the same way.
 */
export function planner<Pz extends object, S, M>(o: {
  key(s: S): string;
  step(p: Pz, s: S, m: M): S;
  search(p: Pz, s: S): Plan<M>;
  init(p: Pz): S;
  known?(p: Pz): readonly M[] | undefined;
}): (p: Pz, s: S) => Plan<M> {
  const memo = new WeakMap<Pz, Map<string, Plan<M>>>();
  const remember = (m: Map<string, Plan<M>>, p: Pz, s: S, path: readonly M[]) => {
    let cur = s;
    for (let i = 0; i <= path.length; i++) {
      const k = o.key(cur);
      if (m.has(k) && m.get(k)!.path) break;
      m.set(k, { path: path.slice(i), impossible: false });
      if (i < path.length) cur = o.step(p, cur, path[i]!);
    }
  };
  return (p, s) => {
    let m = memo.get(p);
    if (!m) {
      m = new Map();
      memo.set(p, m);
      const known = o.known?.(p);
      if (known) remember(m, p, o.init(p), known);
    }
    const k = o.key(s);
    const hit = m.get(k);
    if (hit) return hit;
    const r = o.search(p, s);
    if (r.path) remember(m, p, s, r.path);
    else m.set(k, r);
    return m.get(k)!;
  };
}
