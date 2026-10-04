/**
 * Frame-driven animation for views (rolling a cube, sliding a tile, dealing a card). Stateless:
 * every call owns its own frames. With reduced motion requested, every animation jumps straight
 * to its end.
 */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  in: (t: number) => t * t * t,
  out: (t: number) => 1 - (1 - t) ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  /** Slight overshoot, for things that land. */
  back: (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
} satisfies Record<string, Ease>;

export const reducedMotion = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface Animation extends Promise<boolean> {
  /** Stop where it is; the promise resolves false. */
  cancel(): void;
}

/**
 * Call `frame(p)` with progress 0→1 (eased) every animation frame for `ms`, ending exactly at 1.
 * Resolves true when finished, false when canceled.
 */
export function animate(ms: number, frame: (p: number) => void, curve: Ease = ease.inOut): Animation {
  let raf = 0;
  let settle: (done: boolean) => void = () => {};
  const p = new Promise<boolean>((resolve) => {
    settle = resolve;
    if (ms <= 0 || reducedMotion() || typeof requestAnimationFrame === "undefined") {
      frame(1);
      resolve(true);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      frame(curve(t));
      if (t < 1) raf = requestAnimationFrame(step);
      else resolve(true);
    };
    raf = requestAnimationFrame(step);
  }) as Animation;
  p.cancel = () => {
    cancelAnimationFrame(raf);
    settle(false);
  };
  return p;
}

export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

/** Run animations one after another; stops at the first canceled one. */
export async function sequence(steps: readonly (() => Animation | Promise<boolean>)[]): Promise<boolean> {
  for (const s of steps) if (!(await s())) return false;
  return true;
}
