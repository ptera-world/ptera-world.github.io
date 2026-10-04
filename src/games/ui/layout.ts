import { namespace } from "../core/storage";
import type { SlotId, WidgetDef } from "../core/types";

const store = namespace("layout");

export interface Placement {
  slot: SlotId;
  order: number;
}

export type LayoutConfig = Record<string, Placement>;

export const SLOTS: readonly { id: SlotId; label: string }[] = [
  { id: "top", label: "above the board" },
  { id: "side", label: "beside the board" },
  { id: "bottom", label: "below the board" },
  { id: "panel", label: "sidebar tab" },
  { id: "overlay", label: "over the board" },
  { id: "off", label: "hidden" },
];

/** Stored placements override defaults; widgets added later get their default. Scope "*" applies to every puzzle. */
export function loadLayout(scope: string, widgets: readonly WidgetDef[]): LayoutConfig {
  const shared = store.get<LayoutConfig>("*", {});
  const own = store.get<LayoutConfig>(scope, {});
  const out: LayoutConfig = {};
  for (const w of widgets) out[w.id] = own[w.id] ?? shared[w.id] ?? { slot: w.defaultSlot, order: w.order ?? 50 };
  return out;
}

export function saveLayout(scope: string, cfg: LayoutConfig): void {
  store.set(scope, cfg);
}

export function resetLayout(scope: string): void {
  store.remove(scope);
}

export interface Measures {
  /** Width and height available to the whole stage (below the header). */
  width: number;
  height: number;
  /** Natural sizes of slot contents. */
  topH: number;
  bottomH: number;
  sideW: number;
  /** Side slot height when stacked under the board at full width. */
  sideBelowH: number;
  panelW: number;
  hasSide: boolean;
  hasPanel: boolean;
  /** Board width / height. */
  aspect: number;
  gap: number;
}

export interface Arrangement {
  panel: "right" | "below";
  side: "right" | "below";
  boardW: number;
  boardH: number;
  /** Everything below the board scrolls instead of sharing the screen with it. */
  scroll: boolean;
}

/** A no-scroll board smaller than this share of the best possible board is unusable, so the page scrolls instead. */
const MIN_FIT_SHARE = 0.6;

/**
 * Pick where the side slot and panel go so the board is as large as possible. Ties (within 3%)
 * prefer keeping things beside the board, so wide screens don't stack needlessly.
 */
export function arrange(m: Measures): Arrangement {
  const options: Arrangement[] = [];
  for (const panel of m.hasPanel ? (["right", "below"] as const) : (["below"] as const)) {
    for (const side of m.hasSide ? (["right", "below"] as const) : (["right"] as const)) {
      let w = m.width - 2 * m.gap - (panel === "right" ? m.panelW : 0);
      let hgt = m.height - 2 * m.gap - m.topH - m.bottomH;
      if (m.hasSide && side === "right") w -= m.sideW + m.gap;
      if (m.hasSide && side === "below") hgt -= m.sideBelowH + m.gap;
      if (w <= 0 || hgt <= 0) {
        options.push({ panel, side, boardW: 0, boardH: 0, scroll: false });
        continue;
      }
      const bw = Math.min(w, hgt * m.aspect);
      options.push({ panel, side, boardW: Math.floor(bw), boardH: Math.floor(bw / m.aspect), scroll: false });
    }
  }
  const area = (a: Arrangement) => a.boardW * a.boardH;
  const best = Math.max(...options.map(area));
  const fit = options.find((a) => area(a) >= best * 0.97)!;

  // the largest the board can be while staying fully visible, with everything else scrolling below it
  const sw = m.width - 2 * m.gap;
  const sh = m.height - 2 * m.gap - m.topH;
  const sbw = Math.max(0, Math.min(sw, sh * m.aspect));
  if (fit.boardW >= sbw * MIN_FIT_SHARE) return fit;
  return { panel: "below", side: "below", boardW: Math.floor(sbw), boardH: Math.floor(sbw / m.aspect), scroll: true };
}
