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
}

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
        options.push({ panel, side, boardW: 0, boardH: 0 });
        continue;
      }
      const bw = Math.min(w, hgt * m.aspect);
      options.push({ panel, side, boardW: Math.floor(bw), boardH: Math.floor(bw / m.aspect) });
    }
  }
  const area = (a: Arrangement) => a.boardW * a.boardH;
  const best = Math.max(...options.map(area));
  return options.find((a) => area(a) >= best * 0.97)!;
}
