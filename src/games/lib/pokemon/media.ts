import type { MediaKind, PokemonItem } from "./types";

/**
 * Where each kind of pokémon media lives: PokeAPI's sprites and cries repositories, served with
 * `Access-Control-Allow-Origin: *`, so a page can request them in cors mode and the service worker
 * can keep them (see src/sw/worker.ts). They are © The Pokémon Company and are never copied into
 * this site.
 */
const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const CRIES = "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest";

const PATHS: Record<MediaKind, (pid: number) => string> = {
  sprite: (pid) => `${SPRITES}/${pid}.png`,
  shiny: (pid) => `${SPRITES}/shiny/${pid}.png`,
  art: (pid) => `${SPRITES}/other/official-artwork/${pid}.png`,
  cry: (pid) => `${CRIES}/${pid}.ogg`,
};

/** URL of an item's media, or null when the repositories have none for it. */
export function mediaUrl(item: Pick<PokemonItem, "pid" | "media">, kind: MediaKind): string | null {
  return item.media.includes(kind) ? PATHS[kind](item.pid) : null;
}
