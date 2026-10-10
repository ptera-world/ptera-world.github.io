/**
 * Aborted when this copy of the page script stops. Every listener, loop and timer it starts that
 * can outlive the call that started it ends with this signal.
 */
export const life = new AbortController();
export const { signal } = life;
