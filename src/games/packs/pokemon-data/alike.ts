/**
 * Where the weights come from: what a player would call alike first, in this order. Same family and
 * type are what people mean by "close" (Charmander and Charizard, Charmander and Cyndaquil); then
 * the look (color, body shape, size) and the generation; then the battle numbers, which players
 * know roughly, as a profile spread over six stats plus the total; then the details few know by
 * heart (egg groups, catch rate, growth), each worth little alone but they cluster sensibly
 * (legendaries share catch rate 3, slow growth, no gender, undiscovered eggs).
 */
export const ALIKE: readonly { id: string; label: string; weights: Readonly<Record<string, number>> }[] = [
  { id: "balanced",
    label: "balanced",
    weights: {
      family: 3, type: 3, gen: 1.5, color: 1.5, shape: 1.5, class: 1.5, bst: 1.5,
      height: 1, weight: 1, egg: 1, form: 1, ability: 0.75, stage: 0.75,
      hp: 0.5, atk: 0.5, def: 0.5, spa: 0.5, spd: 0.5, spe: 0.5,
      final: 0.5, habitat: 0.5, capture: 0.5, growth: 0.5, gender: 0.5, eggcycles: 0.5, dex: 0.5,
      hidden: 0.25, happiness: 0.25,
    },
  },
  { id: "looks",
    label: "looks (color, shape, size, type)",
    weights: { color: 3, shape: 3, type: 2, height: 2, weight: 1.5, family: 1, egg: 0.5 },
  },
  { id: "battle",
    label: "battle (stats, type, abilities)",
    weights: { type: 3, bst: 2, hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1, ability: 1.5, hidden: 0.5, final: 0.5, class: 0.5 },
  },
  { id: "lore",
    label: "lore (family, generation, class, habitat, eggs)",
    weights: { family: 3, gen: 2, class: 2, habitat: 1.5, egg: 1.5, dex: 1, stage: 1, growth: 1, gender: 1, capture: 0.5 },
  },
];
