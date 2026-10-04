import { s } from "../../core/dom";
import { SIZE, type Frame } from "./view";

/**
 * The other half of a preview: marks the board has now but the previewed state doesn't are
 * dimmed by covering them, on a layer just under the ghost layer (which only adds marks).
 */
export interface Fades {
  clear(): void;
  /** Dim whatever is drawn in cell c. */
  cell(c: number): void;
  /** Dim a stroke from (x1, y1) to (x2, y2), `width` wide, in board units. */
  line(x1: number, y1: number, x2: number, y2: number, width: number): void;
}

export function fades(f: Frame): Fades {
  const layer = s("g", { opacity: 0.7, "pointer-events": "none" });
  f.ghost.before(layer);
  return {
    clear: () => layer.replaceChildren(),
    cell: (c) => {
      layer.append(s("rect", { x: f.cx(c) + 0.3, y: f.cy(c) + 0.3, width: SIZE - 0.6, height: SIZE - 0.6, fill: "var(--cell)" }));
    },
    line: (x1, y1, x2, y2, width) => {
      layer.append(s("line", { x1, y1, x2, y2, stroke: "var(--cell)", "stroke-width": width, "stroke-linecap": "round" }));
    },
  };
}
