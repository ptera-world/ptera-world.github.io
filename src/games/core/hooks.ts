/**
 * Hook points. Every tap carries an owner id so a plugin's taps can be removed together,
 * and a priority (lower runs first, default 0, ties run in tap order).
 * A throwing tap is reported via `onHookError` and skipped; it never breaks the caller.
 */

export interface TapOptions {
  owner?: string;
  priority?: number;
}

interface Tap<F> {
  fn: F;
  owner: string;
  priority: number;
  order: number;
}

let tapCounter = 0;

export let onHookError: (hook: string, owner: string, error: unknown) => void = (hook, owner, error) => {
  console.error(`[games] hook "${hook}" tap from "${owner}" threw`, error);
};

export function setHookErrorHandler(fn: typeof onHookError): void {
  onHookError = fn;
}

abstract class HookBase<F> {
  protected taps: Tap<F>[] = [];
  constructor(readonly name: string) {}

  tap(fn: F, opts: TapOptions = {}): () => void {
    const t: Tap<F> = { fn, owner: opts.owner ?? "anonymous", priority: opts.priority ?? 0, order: tapCounter++ };
    this.taps.push(t);
    this.taps.sort((a, b) => a.priority - b.priority || a.order - b.order);
    return () => {
      const i = this.taps.indexOf(t);
      if (i >= 0) this.taps.splice(i, 1);
    };
  }

  untapOwner(owner: string): void {
    this.taps = this.taps.filter((t) => t.owner !== owner);
  }

  get size(): number {
    return this.taps.length;
  }

  protected guard<R>(t: Tap<F>, run: () => R): R | undefined {
    try {
      return run();
    } catch (e) {
      onHookError(this.name, t.owner, e);
      return undefined;
    }
  }
}

/** Each tap may return a replacement value; returning undefined keeps the current one. */
export class Waterfall<T, C = void> extends HookBase<(value: T, ctx: C) => T | void> {
  /** With `owner`, only that owner's taps run. */
  call(value: T, ctx: C, owner?: string): T {
    let v = value;
    for (const t of this.taps.slice()) {
      if (owner !== undefined && t.owner !== owner) continue;
      const r = this.guard(t, () => t.fn(v, ctx));
      if (r !== undefined) v = r as T;
    }
    return v;
  }
}

/** First tap to return a non-undefined value wins; later taps don't run. */
export class Bail<C, R> extends HookBase<(ctx: C) => R | void> {
  call(ctx: C): R | undefined {
    for (const t of this.taps.slice()) {
      const r = this.guard(t, () => t.fn(ctx));
      if (r !== undefined) return r as R;
    }
    return undefined;
  }
}

/** Every tap runs; return values ignored. */
export class Event<C> extends HookBase<(ctx: C) => void> {
  call(ctx: C): void {
    for (const t of this.taps.slice()) this.guard(t, () => t.fn(ctx));
  }
}

/** Remove every tap belonging to `owner` from every hook in a hook record. */
export function untapAll(hooks: object, owner: string): void {
  for (const h of Object.values(hooks)) if (h instanceof HookBase) h.untapOwner(owner);
}
