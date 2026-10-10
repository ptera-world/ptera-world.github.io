/**
 * Aborted when this copy of the page script stops. Every listener, loop and timer it starts that
 * can outlive the call that started it ends with this signal.
 */
export const life = new AbortController();
export const { signal } = life;

const frames = new Set<number>();

/** requestAnimationFrame whose callback is skipped once this copy has stopped. */
export function onFrame(cb: FrameRequestCallback): number {
  const id = requestAnimationFrame((t) => {
    frames.delete(id);
    if (!signal.aborted) cb(t);
  });
  frames.add(id);
  return id;
}

export function cancelFrame(id: number): void {
  frames.delete(id);
  cancelAnimationFrame(id);
}

/** True while a frame callback is pending: something on the page is animating. */
export function animating(): boolean {
  return frames.size > 0;
}
