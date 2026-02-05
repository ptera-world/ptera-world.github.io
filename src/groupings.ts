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

const domainGrouping: Grouping = {
  id: "domain",
  label: "Domains",
  regions: [
    {
      id: "domain/infrastructure",
      label: "infrastructure",
      description: "tools that connect other tools",
      x: -300,
      y: -100,
      radius: 180,
      color: "oklch(0.7 0.12 200)",
    },
    {
      id: "domain/creative",
      label: "creative",
      description: "making things that didn't exist",
      x: 300,
      y: -100,
      radius: 150,
      color: "oklch(0.7 0.12 50)",
    },
    {
      id: "domain/games",
      label: "games",
      description: "worlds to play in",
      x: 0,
      y: 200,
      radius: 140,
      color: "oklch(0.7 0.12 280)",
    },
    {
      id: "domain/ai",
      label: "ai",
      description: "working with language models",
      x: -150,
      y: -280,
      radius: 100,
      color: "oklch(0.7 0.12 100)",
    },
    {
      id: "domain/social",
      label: "social",
      description: "how people connect",
      x: 150,
      y: -280,
      radius: 100,
      color: "oklch(0.7 0.12 320)",
    },
  ],
  positions: {
    // Infrastructure cluster - blue
    ...ringPositions(-300, -100, 140, [
      "project/server-less",
      "project/portals",
      "project/myenv",
      "project/concord",
      "project/paraphase",
      "project/rescribe",
      "project/normalize",
      "project/zone",
    ], "domain/infrastructure", "oklch(0.75 0.12 200)"),

    // Creative cluster - orange
    ...ringPositions(300, -100, 110, [
      "project/unshape",
      "project/wick",
      "project/dusklight",
      "project/keybinds",
    ], "domain/creative", "oklch(0.75 0.12 50)"),

    // Games cluster - purple
    ...ringPositions(0, 200, 100, [
      "project/playmate",
      "project/interconnect",
      "project/reincarnate",
    ], "domain/games", "oklch(0.75 0.12 280)"),

    // AI cluster - yellow-green
    ...ringPositions(-150, -280, 60, [
      "project/hologram",
      "project/claude-code-hub",
      "project/gels",
    ], "domain/ai", "oklch(0.75 0.12 100)"),

    // Social cluster - pink
    ...ringPositions(150, -280, 60, [
      "project/aspect",
    ], "domain/social", "oklch(0.75 0.12 320)"),

    // Projects that span multiple domains - place between (infrastructure color)
    "project/moonlet": { x: -100, y: 50, regionId: "domain/infrastructure", color: "oklch(0.75 0.12 200)" },
    "project/ooxml": { x: -200, y: 100, regionId: "domain/infrastructure", color: "oklch(0.75 0.12 200)" },
    "project/pad": { x: -350, y: 100, regionId: "domain/infrastructure", color: "oklch(0.75 0.12 200)" },
    "project/lua": { x: -400, y: -50, regionId: "domain/infrastructure", color: "oklch(0.75 0.12 200)" },

    // Essays - place in center area (tighter triangle)
    "prose/whats-actually-wrong": { x: 0, y: 80 },
    "prose/why-is-software-hard": { x: -80, y: 120 },
    "prose/what-do-we-keep-losing": { x: 80, y: 120 },

    // Landing
    "meta/pteraworld": { x: 0, y: -380 },
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
      x: -300,
      y: 0,
      radius: 230,
      color: "oklch(0.7 0.12 30)",
    },
    {
      id: "technology/lua",
      label: "lua",
      description: "scripting and glue",
      x: 300,
      y: -150,
      radius: 140,
      color: "oklch(0.7 0.12 250)",
    },
    {
      id: "technology/typescript",
      label: "typescript",
      description: "web and applications",
      x: 300,
      y: 150,
      radius: 140,
      color: "oklch(0.7 0.12 210)",
    },
  ],
  positions: {
    // Rust cluster - orange/rust (shifted left)
    ...ringPositions(-300, 0, 180, [
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
    ], "technology/rust", "oklch(0.75 0.12 30)"),

    // Lua cluster - blue (shifted right)
    ...ringPositions(300, -150, 100, [
      "project/moonlet",
      "project/zone",
      "project/pad",
      "project/lua",
    ], "technology/lua", "oklch(0.75 0.12 250)"),

    // TypeScript cluster - cyan (shifted right)
    ...ringPositions(300, 150, 100, [
      "project/dusklight",
      "project/hologram",
      "project/aspect",
      "project/keybinds",
      "project/claude-code-hub",
    ], "technology/typescript", "oklch(0.75 0.12 210)"),

    // Essays - lowered and spread out vertically
    "prose/whats-actually-wrong": { x: 0, y: 100 },
    "prose/why-is-software-hard": { x: -70, y: 170 },
    "prose/what-do-we-keep-losing": { x: 70, y: 170 },

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
      x: -300,
      y: -150,
      radius: 130,
      color: "oklch(0.7 0.15 140)",
    },
    {
      id: "status/fleshed-out",
      label: "fleshed out",
      description: "solid foundation, expanding",
      x: 0,
      y: -100,
      radius: 180,
      color: "oklch(0.7 0.12 200)",
    },
    {
      id: "status/early",
      label: "early",
      description: "work in progress",
      x: 300,
      y: -100,
      radius: 140,
      color: "oklch(0.7 0.10 60)",
    },
    {
      id: "status/planned",
      label: "planned",
      description: "not yet started",
      x: 0,
      y: 200,
      radius: 120,
      color: "oklch(0.7 0.08 0)",
    },
  ],
  positions: {
    // Mature cluster - green
    ...ringPositions(-300, -150, 80, [
      "project/unshape",
      "project/wick",
    ], "status/mature", "oklch(0.75 0.15 145)"),

    // Fleshed out cluster - blue
    ...ringPositions(0, -100, 140, [
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

    // Early cluster - orange
    ...ringPositions(300, -100, 100, [
      "project/playmate",
      "project/concord",
      "project/zone",
      "project/aspect",
      "project/claude-code-hub",
      "project/ooxml",
      "project/pad",
      "project/lua",
    ], "status/early", "oklch(0.75 0.12 70)"),

    // Planned cluster - gray
    ...ringPositions(0, 200, 80, [
      "project/gels",
      "project/interconnect",
      "project/reincarnate",
      "project/dusklight",
    ], "status/planned", "oklch(0.65 0.03 0)"),

    // Essays - place on the left side (spread out more)
    "prose/whats-actually-wrong": { x: -350, y: 30 },
    "prose/why-is-software-hard": { x: -420, y: 130 },
    "prose/what-do-we-keep-losing": { x: -280, y: 130 },

    // Landing - moved up to avoid overlap
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
