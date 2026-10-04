import { bit, fullMask, lowDigit, maxDigit } from "./bits";
import type { Rule } from "./types";

export interface PredicateOptions {
  label: string;
  difficulty?: number;
  /** Values in the rule's cells must all differ (lets propagation prune harder). */
  distinct?: boolean;
  /** Is a complete assignment acceptable? */
  accept(values: readonly number[]): boolean;
  /**
   * Can a partial assignment still be completed? values[i] = 0 means unassigned, and masks[i]
   * then bounds what it may become. Must never reject a completable assignment; omit if unsure.
   */
  feasible?(values: readonly number[], masks: readonly number[]): boolean;
}

const MEMO_LIMIT = 4096;

/**
 * A rule from a predicate: propagation (generalized arc consistency by support search),
 * conflict checks and enumeration all come from `accept`/`feasible`. The fastest way to add a
 * constraint type; hand-written propagators are an optimization, not a requirement.
 */
export function predicateRule(n: number, cells: readonly number[], o: PredicateOptions): Rule {
  const k = cells.length;
  const memo = new Map<string, number[] | null>();
  const vals = Array.from({ length: k }, () => 0);

  // Depth-first search for one completion; on success ORs every value used into `sup`.
  const search = (masks: number[], i: number, used: number, sup: number[] | null, out: number[][] | null, limit: number): boolean => {
    if (i === k) {
      if (!o.accept(vals)) return false;
      if (sup) for (let j = 0; j < k; j++) sup[j]! |= bit(vals[j]!);
      if (out) out.push(vals.slice());
      return !out || out.length >= limit;
    }
    let m = masks[i]!;
    if (o.distinct) m &= ~used;
    while (m) {
      const b = m & -m;
      m ^= b;
      vals[i] = lowDigit(b);
      if ((!o.feasible || o.feasible(vals, masks)) && search(masks, i + 1, used | b, sup, out, limit)) {
        vals[i] = 0;
        return true;
      }
    }
    vals[i] = 0;
    return false;
  };

  const solveMasks = (masks: number[]): number[] | null => {
    const sup = Array.from({ length: k }, () => 0);
    const work = masks.slice();
    for (let i = 0; i < k; i++) {
      let todo = masks[i]! & ~sup[i]!;
      while (todo) {
        const b = todo & -todo;
        todo ^= b;
        if (sup[i]! & b) continue;
        work[i] = b;
        search(work, 0, 0, sup, null, 0);
        work[i] = masks[i]!;
        todo &= ~sup[i]!;
      }
      if (!sup[i]) return null;
    }
    return sup;
  };

  return {
    cells,
    label: o.label,
    difficulty: o.difficulty,
    propagate(masks) {
      const key = masks.join(",");
      let res = memo.get(key);
      if (res === undefined) {
        res = solveMasks(masks);
        if (memo.size >= MEMO_LIMIT) memo.clear();
        memo.set(key, res);
      }
      if (!res) return false;
      for (let i = 0; i < k; i++) masks[i] = res[i]!;
      return true;
    },
    broken(values) {
      const filled = values.every((v) => v > 0);
      if (filled) return o.accept(values) ? [] : cells.map((_, i) => i);
      if (!o.feasible) return [];
      const all = fullMask(n);
      const masks = values.map((v) => (v > 0 ? bit(v) : all));
      return o.feasible(values, masks) ? [] : values.flatMap((v, i) => (v > 0 ? [i] : []));
    },
    enumerate(masks, limit) {
      const out: number[][] = [];
      search(masks.slice(), 0, 0, null, out, limit);
      return out;
    },
  };
}

/** Binary relation between two cells, propagated through a precomputed compatibility table. */
export function pairRule(n: number, a: number, b: number, label: string, ok: (x: number, y: number) => boolean, difficulty?: number): Rule {
  const fwd: number[] = [0];
  const back: number[] = [0];
  for (let x = 1; x <= n; x++) {
    let f = 0, r = 0;
    for (let y = 1; y <= n; y++) {
      if (ok(x, y)) f |= bit(y);
      if (ok(y, x)) r |= bit(y);
    }
    fwd.push(f);
    back.push(r);
  }
  return {
    cells: [a, b],
    label,
    difficulty,
    propagate(masks) {
      const ma = masks[0]!, mb = masks[1]!;
      let na = 0, nb = 0;
      for (let x = 1, m = ma; m; x++, m >>= 1) if (m & 1 && fwd[x]! & mb) na |= bit(x);
      for (let y = 1, m = mb; m; y++, m >>= 1) if (m & 1 && back[y]! & ma) nb |= bit(y);
      masks[0] = na;
      masks[1] = nb;
      return na !== 0 && nb !== 0;
    },
    broken(values) {
      const x = values[0]!, y = values[1]!;
      return x > 0 && y > 0 && !ok(x, y) ? [0, 1] : [];
    },
    enumerate(masks, limit) {
      const out: number[][] = [];
      for (let x = 1; x <= n; x++) {
        if (!(masks[0]! & bit(x))) continue;
        for (let y = 1; y <= n; y++) if (masks[1]! & bit(y) && ok(x, y) && out.push([x, y]) >= limit) return out;
      }
      return out;
    },
  };
}

/** Bounds check for "sum of values + coefficient-weighted remainder hits target", shared by sum-like rules. */
export function sumFeasible(target: number, values: readonly number[], masks: readonly number[], weights?: readonly number[]): boolean {
  let lo = 0, hi = 0;
  for (let i = 0; i < values.length; i++) {
    const w = weights?.[i] ?? 1;
    const v = values[i]!;
    if (v > 0) {
      lo += w * v;
      hi += w * v;
    } else {
      const a = w * lowDigit(masks[i]!), b = w * maxDigit(masks[i]!);
      lo += Math.min(a, b);
      hi += Math.max(a, b);
    }
  }
  return lo <= target && target <= hi;
}

/**
 * Σ weights[i]·value[i] = target, propagated by bounds only (cheap for long lines; weaker than
 * full support search). Digits may repeat.
 */
export function linearRule(n: number, cells: readonly number[], weights: readonly number[], target: number, label: string, difficulty?: number): Rule {
  const k = cells.length;
  const lo = (w: number, m: number) => Math.min(w * lowDigit(m), w * maxDigit(m));
  const hi = (w: number, m: number) => Math.max(w * lowDigit(m), w * maxDigit(m));
  const exact = predicateRule(n, cells, {
    label,
    accept: (v) => v.reduce((a, x, i) => a + weights[i]! * x, 0) === target,
    feasible: (v, m) => sumFeasible(target, v, m, weights),
  });
  return {
    cells,
    label,
    difficulty,
    propagate(masks) {
      for (let changed = true; changed;) {
        changed = false;
        let tlo = 0, thi = 0;
        for (let i = 0; i < k; i++) {
          if (!masks[i]) return false;
          tlo += lo(weights[i]!, masks[i]!);
          thi += hi(weights[i]!, masks[i]!);
        }
        if (tlo > target || thi < target) return false;
        for (let i = 0; i < k; i++) {
          const w = weights[i]!, m = masks[i]!;
          const rlo = tlo - lo(w, m), rhi = thi - hi(w, m);
          let nm = 0;
          for (let x = 1, b = m; b; x++, b >>= 1) {
            if (b & 1 && w * x + rlo <= target && target <= w * x + rhi) nm |= bit(x);
          }
          if (nm !== m) {
            if (!nm) return false;
            masks[i] = nm;
            changed = true;
            break;
          }
        }
      }
      return true;
    },
    broken: (v) => exact.broken(v),
    enumerate: (m, limit) => exact.enumerate!(m, limit),
  };
}

export function sumRule(n: number, cells: readonly number[], target: number, label: string, distinct: boolean, difficulty?: number): Rule {
  return predicateRule(n, cells, {
    label,
    distinct,
    difficulty,
    accept: (v) => v.reduce((a, b) => a + b, 0) === target,
    feasible: (v, m) => sumFeasible(target, v, m),
  });
}
