/**
 * Groupings define alternative spatial arrangements of the graph.
 * Each grouping has its own regions (top-level containers) and
 * positions for project nodes.
 */

export interface Region {
  id: string;
  label: string;
  description: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface NodePosition {
  x: number;
  y: number;
  regionId?: string;
  color?: string;
}

export interface Grouping {
  id: string;
  label: string;
  regions: Region[];
  /** Position overrides for nodes. If not specified, node uses default position. */
  positions: Record<string, NodePosition>;
}

/** Place items evenly on a circle, starting from the top and going clockwise. */
function ringPositions(
  cx: number,
  cy: number,
  r: number,
  ids: string[],
  regionId: string,
  color?: string,
): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  ids.forEach((id, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / ids.length;
    positions[id] = {
      x: Math.round(cx + r * Math.cos(angle)),
      y: Math.round(cy + r * Math.sin(angle)),
      regionId,
      ...(color && { color }),
    };
  });
  return positions;
}

// =============================================================================
// Default grouping: by ecosystem (rhi, exo, standalone)
// =============================================================================

const ecosystemGrouping: Grouping = {
  id: "ecosystem",
  label: "Ecosystems",
  regions: [
    {
      id: "ecosystem/rhi",
      label: "rhi",
      description: "glue layer for computers",
      x: -370,
      y: 0,
      radius: 200,
      color: "oklch(0.7 0.12 155)",
    },
    {
      id: "ecosystem/exo",
      label: "exo",
      description: "places to exist",
      x: 370,
      y: 0,
      radius: 140,
      color: "oklch(0.7 0.12 320)",
    },
  ],
  positions: {}, // Use default positions from graph.ts
};

// =============================================================================
// Domain grouping: by problem domain
// =============================================================================

// Viewport at 1.5x zoom on 1920x1080: visible area ≈ ±640 x ±360 world units
const domainGrouping: Grouping = {
  id: "domain",
  label: "Domains",
  regions: [
    {
      // bbox: x[-480, -120], y[-120, 240]
      id: "domain/infrastructure",
      label: "infrastructure",
      description: "tools that connect other tools",
      x: -300,
      y: 60,
      radius: 180,
      color: "oklch(0.7 0.12 200)",
    },
    {
      // bbox: x[150, 450], y[-130, 170]
      id: "domain/creative",
      label: "creative",
      description: "making things that didn't exist",
      x: 300,
      y: 20,
      radius: 150,
      color: "oklch(0.7 0.12 50)",
    },
    {
      // bbox: x[-140, 140], y[100, 380]
      id: "domain/games",
      label: "games",
      description: "worlds to play in",
      x: 0,
      y: 240,
      radius: 140,
      color: "oklch(0.7 0.12 280)",
    },
    {
      // bbox: x[-270, -30], y[-320, -80]
      id: "domain/ai",
      label: "ai",
      description: "working with language models",
      x: -150,
      y: -200,
      radius: 120,
      color: "oklch(0.7 0.12 100)",
    },
    {
      // bbox: x[30, 270], y[-320, -80]
      id: "domain/social",
      label: "social",
      description: "how people connect",
      x: 150,
      y: -200,
      radius: 120,
      color: "oklch(0.7 0.12 320)",
    },
  ],
  positions: {
    // Infrastructure cluster (ring r=140) - center (-300, 60)
    ...ringPositions(-300, 60, 140, [
      "project/server-less",
      "project/portals",
      "project/myenv",
      "project/concord",
      "project/paraphase",
      "project/rescribe",
      "project/normalize",
      "project/zone",
      "project/moonlet",
      "project/ooxml",
      "project/pad",
      "project/lua",
      "project/motif",
    ], "domain/infrastructure", "oklch(0.75 0.12 200)"),

    // Creative cluster (ring r=110) - center (300, 20)
    ...ringPositions(300, 20, 110, [
      "project/unshape",
      "project/wick",
      "project/dusklight",
      "project/keybinds",
    ], "domain/creative", "oklch(0.75 0.12 50)"),

    // Games cluster (ring r=100) - center (0, 240)
    ...ringPositions(0, 240, 100, [
      "project/playmate",
      "project/interconnect",
      "project/reincarnate",
    ], "domain/games", "oklch(0.75 0.12 280)"),

    // AI cluster (ring r=80) - center (-150, -200)
    ...ringPositions(-150, -200, 80, [
      "project/hologram",
      "project/claude-code-hub",
      "project/gels",
    ], "domain/ai", "oklch(0.75 0.12 100)"),

    // Social cluster (ring r=80) - center (150, -200)
    ...ringPositions(150, -200, 80, [
      "project/aspect",
    ], "domain/social", "oklch(0.75 0.12 320)"),

    // Essays - ring at bottom-right
    ...ringPositions(420, 200, 90, [
      "prose/whats-actually-wrong",
      "prose/how-do-i-do-things",
      "prose/what-can-i-change",
      "prose/what-do-we-keep-losing",
      "prose/what-will-agi-actually-want",
      "prose/why-is-software-hard",
      "prose/what-are-labels-anyway",
    ], ""),

    // Landing - top center
    "meta/pteraworld": { x: 0, y: -300 },
  },
};

// =============================================================================
// Tech grouping: by primary technology
// =============================================================================

const techGrouping: Grouping = {
  id: "tech",
  label: "Technologies",
  regions: [
    {
      id: "technology/rust",
      label: "rust",
      description: "systems programming",
      x: -350,
      y: 0,
      radius: 260,
      color: "oklch(0.7 0.12 30)",
    },
    {
      id: "technology/lua",
      label: "lua",
      description: "scripting and glue",
      x: 330,
      y: -150,
      radius: 150,
      color: "oklch(0.7 0.12 250)",
    },
    {
      id: "technology/typescript",
      label: "typescript",
      description: "web and applications",
      x: 330,
      y: 150,
      radius: 150,
      color: "oklch(0.7 0.12 210)",
    },
  ],
  positions: {
    // Rust cluster - orange/rust (shifted further left)
    ...ringPositions(-350, 0, 210, [
      "project/normalize",
      "project/gels",
      "project/unshape",
      "project/wick",
      "project/server-less",
      "project/concord",
      "project/rescribe",
      "project/paraphase",
      "project/playmate",
      "project/interconnect",
      "project/reincarnate",
      "project/myenv",
      "project/portals",
      "project/ooxml",
      "project/motif",
    ], "technology/rust", "oklch(0.75 0.12 30)"),

    // Lua cluster - blue (shifted right)
    ...ringPositions(330, -150, 110, [
      "project/moonlet",
      "project/zone",
      "project/pad",
      "project/lua",
    ], "technology/lua", "oklch(0.75 0.12 250)"),

    // TypeScript cluster - cyan (shifted right)
    ...ringPositions(330, 150, 110, [
      "project/dusklight",
      "project/hologram",
      "project/aspect",
      "project/keybinds",
      "project/claude-code-hub",
    ], "technology/typescript", "oklch(0.75 0.12 210)"),

    // Essays - ring at center-bottom
    ...ringPositions(0, 130, 90, [
      "prose/whats-actually-wrong",
      "prose/how-do-i-do-things",
      "prose/what-can-i-change",
      "prose/what-do-we-keep-losing",
      "prose/what-will-agi-actually-want",
      "prose/why-is-software-hard",
      "prose/what-are-labels-anyway",
    ], ""),

    // Landing
    "meta/pteraworld": { x: 0, y: -330 },
  },
};

// =============================================================================
// Status grouping: by maturity
// =============================================================================

const statusGrouping: Grouping = {
  id: "status",
  label: "Status",
  regions: [
    {
      id: "status/mature",
      label: "mature",
      description: "stable and actively maintained",
      x: -380,
      y: -100,
      radius: 130,
      color: "oklch(0.7 0.15 140)",
    },
    {
      id: "status/fleshed-out",
      label: "fleshed out",
      description: "solid foundation, expanding",
      x: 100,
      y: -150,
      radius: 180,
      color: "oklch(0.7 0.12 200)",
    },
    {
      id: "status/early",
      label: "early",
      description: "work in progress",
      x: 350,
      y: 150,
      radius: 150,
      color: "oklch(0.7 0.10 60)",
    },
    {
      id: "status/planned",
      label: "planned",
      description: "not yet started",
      x: -150,
      y: 200,
      radius: 130,
      color: "oklch(0.7 0.08 0)",
    },
  ],
  positions: {
    // Mature cluster - green (top-left)
    ...ringPositions(-380, -100, 80, [
      "project/unshape",
      "project/wick",
    ], "status/mature", "oklch(0.75 0.15 145)"),

    // Fleshed out cluster - blue (top-right)
    ...ringPositions(100, -150, 140, [
      "project/normalize",
      "project/moonlet",
      "project/paraphase",
      "project/rescribe",
      "project/server-less",
      "project/myenv",
      "project/portals",
      "project/hologram",
      "project/keybinds",
    ], "status/fleshed-out", "oklch(0.75 0.12 220)"),

    // Early cluster - orange (bottom-right)
    ...ringPositions(350, 150, 110, [
      "project/playmate",
      "project/concord",
      "project/zone",
      "project/aspect",
      "project/claude-code-hub",
      "project/ooxml",
      "project/pad",
      "project/lua",
    ], "status/early", "oklch(0.75 0.12 70)"),

    // Planned cluster - gray (bottom-left)
    ...ringPositions(-150, 200, 90, [
      "project/gels",
      "project/interconnect",
      "project/reincarnate",
      "project/dusklight",
      "project/motif",
    ], "status/planned", "oklch(0.65 0.03 0)"),

    // Essays - ring at center
    ...ringPositions(-50, 30, 90, [
      "prose/whats-actually-wrong",
      "prose/how-do-i-do-things",
      "prose/what-can-i-change",
      "prose/what-do-we-keep-losing",
      "prose/what-will-agi-actually-want",
      "prose/why-is-software-hard",
      "prose/what-are-labels-anyway",
    ], ""),

    // Landing - top center
    "meta/pteraworld": { x: 0, y: -400 },
  },
};

// =============================================================================
// Export all groupings
// =============================================================================

export const groupings: Grouping[] = [
  ecosystemGrouping,
  domainGrouping,
  techGrouping,
  statusGrouping,
];

export const defaultGrouping = ecosystemGrouping;

export function getGrouping(id: string): Grouping | undefined {
  return groupings.find((g) => g.id === id);
}
