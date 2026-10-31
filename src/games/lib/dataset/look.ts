import { style } from "../../core/dom";
import type { Dataset } from "../../core/types";

/**
 * Give `el` (a game's board) the look of the dataset it is played on: its tokens as custom
 * properties, its backdrop, its stylesheet. Returns a function that takes it off.
 */
export function applyLook(d: Dataset | undefined, el: HTMLElement): () => void {
  const look = d?.look;
  if (!look) return () => {};
  if (look.css) style(`look-${d.id}`, look.css);
  const names = Object.keys(look.tokens).map((k) => `--${k}`);
  for (const k of Object.keys(look.tokens)) el.style.setProperty(`--${k}`, look.tokens[k]!);
  if (look.backdrop) el.style.background = look.backdrop;
  el.classList.add("has-look");
  return () => {
    for (const n of names) el.style.removeProperty(n);
    el.style.background = "";
    el.classList.remove("has-look");
  };
}
