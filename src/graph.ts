import { relatedEdges } from "./generated-edges";

/** Node in the world graph. */
export interface Node {
  id: string;
  label: string;
  description: string;
  url?: string;
  tier: "region" | "project" | "detail" | "meta";
  /** Parent region id, if any. */
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
  status?: "production" | "fleshed-out" | "early" | "planned";
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
      id: "project/normalize",
      label: "normalize",
      description: "understands the shape of code across languages",
      url: "https://docs.rhi.zone/normalize",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 30,
      color: "oklch(0.78 0.09 155)",
      status: "fleshed-out",
      tags: ["project", "rust", "cli"],
    },
    {
      id: "project/gels",
      label: "gels",
      description: "detects the shape of languages",
      url: "https://docs.rhi.zone/gels",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      status: "planned",
      tags: ["project", "rust", "cli"],
    },
    {
      id: "project/unshape",
      label: "unshape",
      description: "describing media into existence",
      url: "https://docs.rhi.zone/unshape",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 28,
      color: "oklch(0.78 0.09 155)",
      status: "production",
      tags: ["project", "creative"],
    },
    {
      id: "project/wick",
      label: "wick",
      description: "minimal expression language",
      url: "https://docs.rhi.zone/wick",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      status: "production",
      tags: ["project", "rust", "lua"],
    },
    {
      id: "project/moonlet",
      label: "moonlet",
      description: "a small Lua engine that grows with plugins",
      url: "https://docs.rhi.zone/moonlet",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 26,
      color: "oklch(0.78 0.09 155)",
      status: "fleshed-out",
      tags: ["project", "rust", "lua"],
    },
    {
      id: "project/paraphase",
      label: "paraphase",
      description: "turns data from one shape into another",
      url: "https://docs.rhi.zone/paraphase",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 24,
      color: "oklch(0.78 0.09 155)",
      status: "fleshed-out",
      tags: ["project", "rust", "data"],
    },
    {
      id: "project/dusklight",
      label: "dusklight",
      description: "one interface that connects to anything",
      url: "https://docs.rhi.zone/dusklight",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 25,
      color: "oklch(0.78 0.09 155)",
      status: "planned",
      tags: ["project", "typescript", "ui"],
    },
    {
      id: "project/server-less",
      label: "server-less",
      description: "write it once, speak every protocol",
      url: "https://docs.rhi.zone/server-less",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 23,
      color: "oklch(0.78 0.09 155)",
      status: "fleshed-out",
      tags: ["project", "rust", "infrastructure"],
    },
    {
      id: "project/concord",
      label: "concord",
      description: "generates the glue between languages",
      url: "https://docs.rhi.zone/concord",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      status: "early",
      tags: ["project", "rust", "infrastructure"],
    },
    {
      id: "project/rescribe",
      label: "rescribe",
      description: "converts documents without losing anything",
      url: "https://docs.rhi.zone/rescribe",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      status: "fleshed-out",
      tags: ["project", "rust", "data"],
    },
    {
      id: "project/playmate",
      label: "playmate",
      description: "building blocks for making games",
      url: "https://docs.rhi.zone/playmate",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 24,
      color: "oklch(0.78 0.09 155)",
      status: "early",
      tags: ["project", "creative", "games"],
    },
    {
      id: "project/interconnect",
      label: "interconnect",
      description: "how game worlds stay connected",
      url: "https://docs.rhi.zone/interconnect",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 23,
      color: "oklch(0.78 0.09 155)",
      status: "planned",
      tags: ["project", "rust", "infrastructure", "games"],
    },
    {
      id: "project/reincarnate",
      label: "reincarnate",
      description: "bringing old software back to life",
      url: "https://docs.rhi.zone/reincarnate",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      status: "planned",
      tags: ["project", "rust", "games"],
    },
    {
      id: "project/myenv",
      label: "myenv",
      description: "keeps all the pieces running together",
      url: "https://docs.rhi.zone/myenv",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 20,
      color: "oklch(0.78 0.09 155)",
      status: "fleshed-out",
      tags: ["project", "rust", "cli", "infrastructure"],
    },
    {
      id: "project/portals",
      label: "portals",
      description: "common ground between different tools",
      url: "https://docs.rhi.zone/portals",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 20,
      color: "oklch(0.78 0.09 155)",
      status: "fleshed-out",
      tags: ["project", "infrastructure"],
    },
    {
      id: "project/zone",
      label: "zone",
      description: "Lua scripts that wire things together",
      url: "https://docs.rhi.zone/zone",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 20,
      color: "oklch(0.78 0.09 155)",
      status: "early",
      tags: ["project", "lua", "cli"],
    },
    {
      id: "project/motif",
      label: "motif",
      description: "structural exploration of mathematics across fields",
      url: "https://docs.rhi.zone/motif",
      tier: "project",
      parent: "ecosystem/rhi",
      radius: 22,
      color: "oklch(0.78 0.09 155)",
      status: "planned",
      tags: ["project", "rust", "data"],
    },
  ]);

  // Essays — ring, center (40, 100), radius 120
  // Top: most personal/actionable, bottom: systems-level
  const essayNodes = ringLayout(80, 40, 120, [
    {
      id: "prose/whats-actually-wrong",
      label: "what's actually wrong?",
      description: "before solutions. before tools.\nwhat's actually wrong?",
      tier: "project",
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "design", "social"],
    },
    {
      id: "prose/how-do-i-do-things",
      label: "how do I do things?",
      description: "not a system. not productivity advice.\njust what seems to help.",
      tier: "project",
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "social"],
    },
    {
      id: "prose/what-can-i-change",
      label: "what can I change?",
      description: "what do you want to change?\nwhat's your relationship to it?",
      tier: "project",
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "social"],
    },
    {
      id: "prose/what-do-we-keep-losing",
      label: "what do we keep losing?",
      description: "technology isn't preserved by existence.\nit's preserved by continuous practice.",
      tier: "project",
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "infrastructure", "games"],
    },
    {
      id: "prose/what-will-agi-actually-want",
      label: "what will AGI actually want?",
      description: "alignment isn't safety. it's direction.",
      tier: "project",
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "ai", "social"],
    },
    {
      id: "prose/why-is-software-hard",
      label: "why is software hard?",
      description: "you're not bad at computers.\nsoftware is actually hard to use.",
      tier: "project",
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "design"],
    },
    {
      id: "prose/what-are-labels-anyway",
      label: "what are labels anyway?",
      description: "you live inside the stories\nyou tell yourself.",
      tier: "project",
      radius: 24,
      color: "oklch(0.78 0.09 45)",
      tags: ["essay", "social"],
    },
  ]);

  // Centered in the essay ring
  const deceitNode: Omit<Node, "baseX" | "baseY"> = {
    id: "prose/the-great-deceit",
    label: "the great deceit",
    description: "every word here was written by an AI.\nis that a bad thing?",
    tier: "project",
    x: 80,
    y: 40,
    radius: 24,
    color: "oklch(0.78 0.09 45)",
    tags: ["essay", "ai", "social"],
  };

  const defs: Omit<Node, "baseX" | "baseY">[] = [
    // Meta (landing)
    {
      id: "meta/pteraworld",
      label: "ptera",
      description: "i think about how software and people shape each other.",
      tier: "meta",
      x: 0,
      y: -170,
      radius: 0,
      color: "#fff",
      tags: ["meta"],
    },

    // Ecosystems
    {
      id: "ecosystem/rhi",
      label: "rhi",
      description: "glue layer for computers",
      url: "https://docs.rhi.zone",
      tier: "region",
      x: -370,
      y: 0,
      radius: 200,
      color: "oklch(0.7 0.12 155)",
      tags: ["region"],
    },
    {
      id: "ecosystem/exo",
      label: "exo",
      description: "places to exist",
      url: "https://docs.exo.place",
      tier: "region",
      x: 370,
      y: 0,
      radius: 140,
      color: "oklch(0.7 0.12 320)",
      tags: ["region"],
    },

    // rhi projects - computed ring layout
    ...rhiProjects,

    // exo projects
    {
      id: "project/hologram",
      label: "hologram",
      description: "a Discord bot where you describe things into existence",
      url: "https://docs.exo.place/hologram",
      tier: "project",
      parent: "ecosystem/exo",
      x: 420,
      y: -87,
      radius: 30,
      color: "oklch(0.78 0.09 320)",
      status: "fleshed-out",
      tags: ["project", "typescript", "ai", "social"],
    },
    {
      id: "project/aspect",
      label: "aspect",
      description: "exploring who you are through cards",
      url: "https://docs.exo.place/aspect",
      tier: "project",
      parent: "ecosystem/exo",
      x: 320,
      y: 87,
      radius: 28,
      color: "oklch(0.78 0.09 320)",
      status: "early",
      tags: ["project", "typescript", "social"],
    },

    // Standalone projects
    {
      id: "project/claude-code-hub",
      label: "claude-code-hub",
      description: "coordinates multiple Claude Code agents",
      url: "https://github.com/pterror/claude-code-hub",
      tier: "project",
      x: -80,
      y: -280,
      radius: 26,
      color: "oklch(0.78 0.09 85)",
      status: "early",
      tags: ["project", "ai"],
    },
    {
      id: "project/keybinds",
      label: "keybinds",
      description: "declarative keybindings for the web",
      url: "https://pterror.github.io/keybinds",
      tier: "project",
      x: 80,
      y: -280,
      radius: 24,
      color: "oklch(0.78 0.09 85)",
      status: "fleshed-out",
      tags: ["project", "javascript", "ui"],
    },
    {
      id: "project/ooxml",
      label: "ooxml",
      description: "Office Open XML library for Rust",
      url: "https://pterror.github.io/ooxml",
      tier: "project",
      x: -60,
      y: 210,
      radius: 24,
      color: "oklch(0.78 0.09 85)",
      status: "early",
      tags: ["project", "rust", "data"],
    },
    {
      id: "project/pad",
      label: "pad",
      description: "catches and organizes data from the terminal",
      url: "https://pterror.github.io/pad",
      tier: "project",
      x: 230,
      y: 210,
      radius: 22,
      color: "oklch(0.78 0.09 85)",
      status: "early",
      tags: ["project", "lua", "cli"],
    },
    {
      id: "project/lua",
      label: "lua",
      description: "a playground for Lua experiments",
      url: "https://github.com/pterror/lua",
      tier: "project",
      x: 90,
      y: 260,
      radius: 22,
      color: "oklch(0.78 0.09 85)",
      status: "early",
      tags: ["project", "lua"],
    },

    // Essays - ring layout
    ...essayNodes,
    deceitNode,
  ];

  const nodes: Node[] = defs.map((n) => ({ ...n, baseX: n.x, baseY: n.y }));

  const containmentEdges: Edge[] = nodes
    .filter((n) => n.parent)
    .map((n) => ({ from: n.parent!, to: n.id, strength: 0.7 }));

  const edges: Edge[] = [...containmentEdges, ...relatedEdges];

  return { nodes, edges };
}
