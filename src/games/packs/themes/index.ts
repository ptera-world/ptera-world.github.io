import type { GamesApi } from "../../api";

/** Built-in looks. The first dark and first light theme registered are what "follow system" picks. */
export default function themesPack(games: GamesApi): void {
  games.registry.theme({
    id: "dark", name: "dark", scheme: "dark",
    tokens: {
      bg: "#0a0a0a", surface: "#131313", "surface-2": "#1b1b1b", border: "#2a2a2a",
      text: "#ddd", "text-dim": "#888", accent: "#6a9", danger: "#e66", warn: "#db6",
      hint: "#c8f", cell: "#1a1a1a", "cell-lit": "#e8d27a", focus: "#8cf", "done-opacity": "0.35",
    },
  });
  games.registry.theme({
    id: "light", name: "light", scheme: "light",
    tokens: {
      bg: "#f6f5f2", surface: "#ffffff", "surface-2": "#efede8", border: "#d6d3cc",
      text: "#1d1d1f", "text-dim": "#6b6a66", accent: "#2f7d68", danger: "#c33", warn: "#a77400",
      hint: "#7a3fc4", cell: "#ffffff", "cell-lit": "#e7c64a", focus: "#2a6fd6", "done-opacity": "0.3",
    },
  });
  games.registry.theme({
    id: "contrast", name: "high contrast", scheme: "dark",
    tokens: {
      bg: "#000", surface: "#000", "surface-2": "#111", border: "#fff",
      text: "#fff", "text-dim": "#ddd", accent: "#3ff", danger: "#f55", warn: "#ff0",
      hint: "#f6f", cell: "#000", "cell-lit": "#ff0", focus: "#3cf", "done-opacity": "0.25",
    },
  });
  games.registry.theme({
    id: "paper", name: "paper", scheme: "light",
    tokens: {
      bg: "#efe6d2", surface: "#f7f0df", "surface-2": "#e6dcc4", border: "#bfae8c",
      text: "#2b2418", "text-dim": "#7a6a50", accent: "#8a4b2a", danger: "#b0302a", warn: "#9a6a00",
      hint: "#5b3f8f", cell: "#f7f0df", "cell-lit": "#d9a441", focus: "#2c5d8a", "done-opacity": "0.3",
    },
  });
}
