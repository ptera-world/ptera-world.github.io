import type { KeyValue } from "../../../core/types";
import { embed } from "./mds";
import type { Space } from "./similarity";
import { tsne } from "./tsne";

/** Maps kept in storage, newest first; each is ~20 kB for a thousand items. */
const KEEP = 3;
const memo = new Map<string, Promise<Float64Array>>();

/** Wait a tick when this frame's budget is spent, so the page keeps drawing while the map is computed. */
function pacer(): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < 12) return;
    await new Promise((r) => setTimeout(r, 0));
    last = performance.now();
  };
}

/**
 * A pool's map (x, y per item, in [0, 1]): from memory, else from `storage` (computed once per
 * dataset version, pool and weights, then kept), else computed (MDS, refined by t-SNE).
 */
export function mapFor(sc: { space: Space; mapKey: string; items: readonly unknown[] }, storage: KeyValue): Promise<Float64Array> {
  let m = memo.get(sc.mapKey);
  if (m) return m;
  m = (async () => {
    const kept = storage.get<{ key: string; xy: number[] }[]>("maps", []);
    const hit = kept.find((k) => k.key === sc.mapKey && k.xy.length === 2 * sc.items.length);
    if (hit) return Float64Array.from(hit.xy);
    const pause = pacer();
    await pause();
    const xy = await tsne(sc.space, embed(sc.space), { pause });
    try {
      storage.set("maps", [{ key: sc.mapKey, xy: Array.from(xy, (v) => Math.round(v * 1e4) / 1e4) }, ...kept.filter((k) => k.key !== sc.mapKey)].slice(0, KEEP));
    } catch {
      // storage full: the map is recomputed next time
    }
    return xy;
  })();
  memo.set(sc.mapKey, m);
  m.catch(() => memo.delete(sc.mapKey));
  return m;
}
