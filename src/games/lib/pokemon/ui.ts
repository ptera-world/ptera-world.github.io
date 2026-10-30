import { h, style } from "../../core/dom";
import { mediaUrl } from "./media";
import type { MediaKind, PokemonItem } from "./types";

/**
 * The usual colors for each type (as the games and most fan sites draw them), as tokens a theme
 * can override: --type-fire and so on.
 */
export const TYPE_COLORS: Readonly<Record<string, string>> = {
  normal: "#a8a77a", fire: "#ee8130", water: "#6390f0", electric: "#f7d02c", grass: "#7ac74c", ice: "#96d9d6",
  fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf65", flying: "#a98ff3", psychic: "#f95587", bug: "#a6b91a",
  rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc", dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
};

export const typeColor = (t: string): string => `var(--type-${t}, ${TYPE_COLORS[t] ?? "var(--surface-2)"})`;

const CSS = `
.pk-sprite { image-rendering: pixelated; object-fit: contain; }
.pk-sprite.missing { display: inline-flex; align-items: center; justify-content: center; color: var(--text-dim); font-size: 11px; border: 1px dashed var(--border); border-radius: 6px; box-sizing: border-box; }
.pk-type { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; color: #fff; text-shadow: 0 1px 1px rgb(0 0 0 / .5); white-space: nowrap; }
`;

/**
 * A pokémon's picture, loaded from PokeAPI's repository in cors mode so the service worker keeps
 * it for offline use. A pokémon with no such picture gets a labelled empty box of the same size.
 */
export function sprite(item: PokemonItem, opts: { kind?: Extract<MediaKind, "sprite" | "shiny" | "art">; size?: number; alt?: string } = {}): HTMLElement {
  style("pk-ui", CSS);
  const size = opts.size ?? 96;
  const url = mediaUrl(item, opts.kind ?? "sprite");
  if (!url) return h("span", { class: "pk-sprite missing", style: `width: ${size}px; height: ${size}px`, role: "img", "aria-label": opts.alt ?? item.name }, "no picture");
  const img = h("img", { class: "pk-sprite", src: url, crossorigin: "anonymous", alt: opts.alt ?? item.name, width: size, height: size, decoding: "async", draggable: "false" });
  return img;
}

/** A type as a colored chip. */
export function typeChip(type: string, label = type): HTMLElement {
  style("pk-ui", CSS);
  return h("span", { class: "pk-type", style: `background: ${typeColor(type)}` }, label);
}

/** Play a pokémon's cry; resolves false when it has none or the browser can't play it (Safari lacks ogg support in some versions). */
export async function playCry(item: PokemonItem, volume = 0.6): Promise<boolean> {
  const url = mediaUrl(item, "cry");
  if (!url) return false;
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.volume = volume;
  audio.src = url;
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

/** Default forms only, in dex order: the pool most games start from. */
export function standardForms(items: readonly PokemonItem[]): PokemonItem[] {
  return items.filter((i) => i.form === "default");
}
