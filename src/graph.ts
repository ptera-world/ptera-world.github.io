import { relatedEdges } from "./generated-edges";

/** Node in the world graph. */
export interface Node {
  id: string;
  label: string;
  description: string;
  url?: string;
  tier: "ecosystem" | "project" | "detail" | "meta";
  /** Parent ecosystem id, if any. */
  parent?: string;
  /** Current position (mutated by layout). */
  x: number;
  y: number;
  /** Original position - reset target after layout changes. */
  baseX: number;
  baseY: number;
  /** Visual radius at native zoom. */
  radius: number;
  color: string;
  tags: string[];
}

/** Edge connecting two nodes. */
export interface Edge {
  from: string;
  to: string;
  strength: number; // 0–1
}

export interface Graph {
  nodes: Node[];
  edges: Edge[];
}

/** Place nodes evenly on a circle, starting from the top and going clockwise. */
function ringLayout(
  cx: number,
  cy: number,
  r: number,
  nodes: Omit<Node, "x" | "y" | "baseX" | "baseY">[],
): Omit<Node, "baseX" | "baseY">[] {
  return nodes.map((n, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
    return {
      ...n,
      x: Math.round(cx + r * Math.cos(angle)),
      y: Math.round(cy + r * Math.sin(angle)),
    };
  });
}

export function createGraph(): Graph {
  const rhiProjects = ringLayout(-370, 0, 220, [
    {
      id: "normalize",
      label: "normalize",
      description: "Understands the shape of code across languages",
      url: "https://docs.rhi.zone/normalize",
      tier: "project",
      parent: "rhi",
      radius: 30,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "cli"],
    },
    {
      id: "gels",
      label: "gels",
      description: "Detects the shape of languages",
      url: "https://docs.rhi.zone/gels",
      tier: "project",
      parent: "rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "cli"],
    },
    {
      id: "unshape",
      label: "unshape",
      description: "Describing media into existence",
      url: "https://docs.rhi.zone/unshape",
      tier: "project",
      parent: "rhi",
      radius: 28,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "creative"],
    },
    {
      id: "wick",
      label: "wick",
      description: "Minimal expression language",
      url: "https://docs.rhi.zone/wick",
      tier: "project",
      parent: "rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "lua"],
    },
    {
      id: "moonlet",
      label: "moonlet",
      description: "A small Lua engine that grows with plugins",
      url: "https://docs.rhi.zone/moonlet",
      tier: "project",
      parent: "rhi",
      radius: 26,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "lua"],
    },
    {
      id: "paraphase",
      label: "paraphase",
      description: "Turns data from one shape into another",
      url: "https://docs.rhi.zone/paraphase",
      tier: "project",
      parent: "rhi",
      radius: 24,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "data"],
    },
    {
      id: "dusklight",
      label: "dusklight",
      description: "One interface that connects to anything",
      url: "https://docs.rhi.zone/dusklight",
      tier: "project",
      parent: "rhi",
      radius: 25,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "typescript", "ui"],
    },
    {
      id: "server-less",
      label: "server-less",
      description: "Write it once, speak every protocol",
      url: "https://docs.rhi.zone/server-less",
      tier: "project",
      parent: "rhi",
      radius: 23,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "infrastructure"],
    },
    {
      id: "concord",
      label: "concord",
      description: "Generates the glue between languages",
      url: "https://docs.rhi.zone/concord",
      tier: "project",
      parent: "rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "infrastructure"],
    },
    {
      id: "rescribe",
      label: "rescribe",
      description: "Converts documents without losing anything",
      url: "https://docs.rhi.zone/rescribe",
      tier: "project",
      parent: "rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "data"],
    },
    {
      id: "playmate",
      label: "playmate",
      description: "Building blocks for making games",
      url: "https://docs.rhi.zone/playmate",
      tier: "project",
      parent: "rhi",
      radius: 24,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "creative", "games"],
    },
    {
      id: "interconnect",
      label: "interconnect",
      description: "How game worlds stay connected",
      url: "https://docs.rhi.zone/interconnect",
      tier: "project",
      parent: "rhi",
      radius: 23,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "infrastructure", "games"],
    },
    {
      id: "reincarnate",
      label: "reincarnate",
      description: "Bringing old software back to life",
      url: "https://docs.rhi.zone/reincarnate",
      tier: "project",
      parent: "rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "games"],
    },
    {
      id: "myenv",
      label: "myenv",
      description: "Keeps all the pieces running together",
      url: "https://docs.rhi.zone/myenv",
      tier: "project",
      parent: "rhi",
      radius: 20,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "rust", "cli", "infrastructure"],
    },
    {
      id: "portals",
      label: "portals",
      description: "Common ground between different tools",
      url: "https://docs.rhi.zone/portals",
      tier: "project",
      parent: "rhi",
      radius: 20,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "infrastructure"],
    },
    {
      id: "zone",
      label: "zone",
      description: "Lua scripts that wire things together",
      url: "https://docs.rhi.zone/zone",
      tier: "project",
      parent: "rhi",
      radius: 20,
      color: "oklch(0.78 0.09 155)",
      tags: ["project", "lua", "cli"],
    },
  ]);

  const defs: Omit<Node, "baseX" | "baseY">[] = [
    // Meta (landing)
    {
      id: "pteraworld",
      label: "ptera",
      description: "i think about how software and people shape each other.",
      tier: "meta",
      x: 0,
      y: -120,
      radius: 0,
      color: "#fff",
      tags: ["meta"],
    },

    // Ecosystems
    {
      id: "rhi",
      label: "rhi",
      description: "Glue layer for computers",
      url: "https://docs.rhi.zone",
      tier: "ecosystem",
      x: -370,
      y: 0,
      radius: 200,
      color: "oklch(0.7 0.12 155)",
      tags: ["ecosystem"],
    },
    {
      id: "exo",
      label: "exo",
      description: "Places to exist",
      url: "https://docs.exo.place",
      tier: "ecosystem",
      x: 370,
      y: 0,
      radius: 140,
      color: "oklch(0.7 0.12 320)",
      tags: ["ecosystem"],
    },

    // rhi projects - computed ring layout
    ...rhiProjects,

    // exo projects
    {
      id: "hologram",
      label: "hologram",
      description: "A Discord bot where you describe things into existence",
      url: "https://docs.exo.place/hologram",
      tier: "project",
      parent: "exo",
      x: 420,
      y: -87,
      radius: 30,
      color: "oklch(0.78 0.09 320)",
      tags: ["project", "typescript", "ai", "social"],
    },
    {
      id: "aspect",
      label: "aspect",
      description: "Exploring who you are through cards",
      url: "https://docs.exo.place/aspect",
      tier: "project",
      parent: "exo",
      x: 320,
      y: 87,
      radius: 28,
      color: "oklch(0.78 0.09 320)",
      tags: ["project", "typescript", "social"],
    },

    // Standalone projects
    {
      id: "claude-code-hub",
      label: "claude-code-hub",
      description: "Coordinates multiple Claude Code agents",
      url: "https://github.com/pterror/claude-code-hub",
      tier: "project",
      x: -80,
      y: -280,
      radius: 26,
      color: "oklch(0.78 0.09 85)",
      tags: ["project", "ai"],
    },
    {
      id: "keybinds",
      label: "keybinds",
      description: "Declarative keybindings for the web",
      url: "https://pterror.github.io/keybinds",
      tier: "project",
      x: 80,
      y: -280,
      radius: 24,
      color: "oklch(0.78 0.09 85)",
      tags: ["project", "javascript", "ui"],
    },
    {
      id: "ooxml",
      label: "ooxml",
      description: "Office Open XML library for Rust",
      url: "https://pterror.github.io/ooxml",
      tier: "project",
      x: -70,
      y: 220,
      radius: 24,
      color: "oklch(0.78 0.09 85)",
      tags: ["project", "rust", "data"],
    },
    {
      id: "pad",
      label: "pad",
      description: "Catches and organizes data from the terminal",
      url: "https://pterror.github.io/pad",
      tier: "project",
      x: 170,
      y: 220,
      radius: 22,
      color: "oklch(0.78 0.09 85)",
      tags: ["project", "lua", "cli"],
    },
    {
      id: "lua",
      label: "lua",
      description: "A playground for Lua experiments",
      url: "https://github.com/pterror/lua",
      tier: "project",
      x: 50,
      y: 270,
      radius: 22,
      color: "oklch(0.78 0.09 85)",
      tags: ["project", "lua"],
    },

    // Essays
    {
      id: "whats-actually-wrong",
      label: "what's actually wrong?",
      description: "Before solutions. Before tools. What's actually wrong?",
      tier: "project",
      x: 50,
      y: 30,
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "design", "social"],
    },
    {
      id: "why-is-software-hard",
      label: "why is software hard?",
      description: "You're not bad at computers.\nSoftware is actually hard to use.",
      tier: "project",
      x: -80,
      y: 140,
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "design"],
    },
    {
      id: "what-do-we-keep-losing",
      label: "what do we keep losing?",
      description: "Technology isn't preserved by existence.\nIt's preserved by continuous practice.",
      tier: "project",
      x: 180,
      y: 140,
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "infrastructure", "games"],
    },
  ];

  const nodes: Node[] = defs.map((n) => ({ ...n, baseX: n.x, baseY: n.y }));

  const containmentEdges: Edge[] = nodes
    .filter((n) => n.parent)
    .map((n) => ({ from: n.parent!, to: n.id, strength: 0.7 }));

  const edges: Edge[] = [...containmentEdges, ...relatedEdges];

  return { nodes, edges };
}
