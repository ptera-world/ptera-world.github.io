import type { GamesApi } from "../../api";

/** Piece colours that read on dark backgrounds. */
const BRIGHT = {
  "palette-1": "#7ab0ff", "palette-2": "#7fcf8a", "palette-3": "#ff7b7b", "palette-4": "#c8a2ff",
  "palette-5": "#e8a25a", "palette-6": "#5fd3d3", "palette-7": "#f0d264", "palette-8": "#e88ac8",
};

/** Built-in looks. The first dark and first light theme registered are what "follow system" picks. */
export default function themesPack(games: GamesApi): void {
  games.registry.theme({
    id: "dark", name: "dark", scheme: "dark",
    tokens: {
      bg: "#0a0a0a", surface: "#131313", "surface-2": "#1b1b1b", border: "#2a2a2a",
      text: "#ddd", "text-dim": "#888", accent: "#6a9", danger: "#e66", warn: "#db6",
      hint: "#c8f", cell: "#1a1a1a", "cell-lit": "#e8d27a", focus: "#8cf", "done-opacity": "0.35",
      ...BRIGHT,
      font: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif", mono: "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace",
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
      "palette-1": "#4af", "palette-2": "#3f6", "palette-3": "#f44", "palette-4": "#c6f", "palette-5": "#fa0", "palette-6": "#0ff", "palette-7": "#ff0", "palette-8": "#f6c",
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
  games.registry.theme({
    id: "ember", name: "ember (warm dark)", scheme: "dark",
    tokens: {
      bg: "#16100c", surface: "#1f1712", "surface-2": "#2a1f18", border: "#46352a",
      text: "#f1e3d3", "text-dim": "#a8907a", accent: "#e8894a", danger: "#ff6b5a", warn: "#f2c14e",
      hint: "#e6a2ff", cell: "#241a14", "cell-lit": "#f2b84e", focus: "#ffb27a", "done-opacity": "0.35",
      ...BRIGHT,
    },
  });
  games.registry.theme({
    id: "midnight", name: "midnight (cool dark)", scheme: "dark",
    tokens: {
      bg: "#0b1020", surface: "#111830", "surface-2": "#18213d", border: "#2a3558",
      text: "#dbe4ff", "text-dim": "#8592b8", accent: "#5fb3ff", danger: "#ff6b81", warn: "#ffd166",
      hint: "#b48cff", cell: "#141c36", "cell-lit": "#7fdbff", focus: "#9fd0ff", "done-opacity": "0.35",
      ...BRIGHT,
    },
  });
  games.registry.theme({
    id: "sand", name: "sand (warm light)", scheme: "light",
    tokens: {
      bg: "#faf3e7", surface: "#fffaf1", "surface-2": "#f1e6d2", border: "#dcc9a8",
      text: "#3a2a1a", "text-dim": "#8a7357", accent: "#c0622b", danger: "#c0392b", warn: "#a86a00",
      hint: "#8e44ad", cell: "#fffaf1", "cell-lit": "#f0b44a", focus: "#d9772f", "done-opacity": "0.3",
    },
  });
  games.registry.theme({
    id: "frost", name: "frost (cool light)", scheme: "light",
    tokens: {
      bg: "#eef3f8", surface: "#f8fbfe", "surface-2": "#e1e9f2", border: "#c3d0de",
      text: "#16202c", "text-dim": "#5f6f82", accent: "#2b6cb0", danger: "#c53030", warn: "#b7791f",
      hint: "#6b46c1", cell: "#f8fbfe", "cell-lit": "#90cdf4", focus: "#3182ce", "done-opacity": "0.3",
    },
  });
  games.registry.theme({
    id: "terminal", name: "terminal", scheme: "dark",
    tokens: {
      bg: "#020a02", surface: "#041004", "surface-2": "#072007", border: "#0f4f0f",
      text: "#7dff7d", "text-dim": "#2fa82f", accent: "#4dff4d", danger: "#ff5f3f", warn: "#e6ff4d",
      hint: "#4dffd2", cell: "#031203", "cell-lit": "#4dff4d", focus: "#b6ff4d", "done-opacity": "0.3",
      font: "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace",
      "palette-1": "#4dff4d", "palette-2": "#b6ff4d", "palette-3": "#ff5f3f", "palette-4": "#4dffd2",
      "palette-5": "#e6ff4d", "palette-6": "#2fd62f", "palette-7": "#d2ffa8", "palette-8": "#7dffb0",
    },
    css: "#games { text-shadow: 0 0 4px color-mix(in srgb, var(--text) 45%, transparent); }",
  });
  games.registry.theme({
    id: "synthwave", name: "synthwave", scheme: "dark",
    tokens: {
      bg: "#1a0b2e", surface: "#24103f", "surface-2": "#311656", border: "#5b2a86",
      text: "#fbe9ff", "text-dim": "#b48ad6", accent: "#ff4fd8", danger: "#ff3864", warn: "#ffd319",
      hint: "#2de2e6", cell: "#2a1248", "cell-lit": "#ff9e2c", focus: "#2de2e6", "done-opacity": "0.35",
      "palette-1": "#2de2e6", "palette-2": "#7cff6b", "palette-3": "#ff3864", "palette-4": "#b967ff",
      "palette-5": "#ff9e2c", "palette-6": "#00c2ff", "palette-7": "#ffd319", "palette-8": "#ff4fd8",
    },
    css: "#games .bar { box-shadow: 0 1px 12px color-mix(in srgb, var(--accent) 40%, transparent); }",
  });
  games.registry.theme({
    id: "blueprint", name: "blueprint", scheme: "dark",
    tokens: {
      bg: "#123a73", surface: "#16448a", "surface-2": "#1b4f9c", border: "#8fb4e8",
      text: "#f2f7ff", "text-dim": "#b9cff0", accent: "#ffffff", danger: "#ffb3b3", warn: "#ffe08a",
      hint: "#bfe3ff", cell: "#16448a", "cell-lit": "#ffffff", focus: "#ffe08a", "done-opacity": "0.35",
      font: "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace",
      "palette-1": "#ffffff", "palette-2": "#bfe3ff", "palette-3": "#ffb3b3", "palette-4": "#d7c4ff",
      "palette-5": "#ffd29a", "palette-6": "#9ff0e6", "palette-7": "#ffe08a", "palette-8": "#ffc2e6",
    },
  });
}
