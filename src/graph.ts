import { relatedEdges } from "./generated-edges";

/** Node in the world graph. */
export interface Node {
  id: string;
  label: string;
  description: string;
  url?: string;
  tier: "ecosystem" | "project" | "detail";
  /** Parent ecosystem id, if any. */
  parent?: string;
  /** Base position - layout shifts these based on focus. */
  x: number;
  y: number;
  /** Visual radius at native zoom. */
  radius: number;
  color: string;
}

/** Edge connecting two nodes. */
export interface Edge {
  from: string;
  to: string;
}

export interface Graph {
  nodes: Node[];
  edges: Edge[];
}

export function createGraph(): Graph {
  const nodes: Node[] = [
    // Ecosystems
    {
      id: "rhi",
      label: "rhi",
      description: "Glue layer for computers",
      url: "https://docs.rhi.zone",
      tier: "ecosystem",
      x: -420,
      y: 0,
      radius: 200,
      color: "oklch(0.7 0.12 155)",
    },
    {
      id: "exo",
      label: "exo",
      description: "Places to exist",
      url: "https://docs.exo.place",
      tier: "ecosystem",
      x: 320,
      y: 0,
      radius: 140,
      color: "oklch(0.7 0.12 320)",
    },

    // rhi projects - ring of radius 220 around (-420, 0)
    {
      id: "normalize",
      label: "normalize",
      description: "Structural code intelligence across 98 languages",
      url: "https://docs.rhi.zone/normalize",
      tier: "project",
      parent: "rhi",
      x: -420,
      y: -220,
      radius: 30,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "unshape",
      label: "unshape",
      description: "Constructive media generation",
      url: "https://docs.rhi.zone/unshape",
      tier: "project",
      parent: "rhi",
      x: -331,
      y: -201,
      radius: 28,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "dew",
      label: "dew",
      description: "Minimal expression language",
      url: "https://docs.rhi.zone/dew",
      tier: "project",
      parent: "rhi",
      x: -257,
      y: -147,
      radius: 22,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "moonlet",
      label: "moonlet",
      description: "Lua runtime with plugin system",
      url: "https://docs.rhi.zone/moonlet",
      tier: "project",
      parent: "rhi",
      x: -211,
      y: -68,
      radius: 26,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "paraphase",
      label: "paraphase",
      description: "Pipeline orchestrator for data conversion",
      url: "https://docs.rhi.zone/paraphase",
      tier: "project",
      parent: "rhi",
      x: -201,
      y: 23,
      radius: 24,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "dusklight",
      label: "dusklight",
      description: "Universal UI client with control plane",
      url: "https://docs.rhi.zone/dusklight",
      tier: "project",
      parent: "rhi",
      x: -229,
      y: 110,
      radius: 25,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "server-less",
      label: "server-less",
      description: "One impl → many protocols",
      url: "https://docs.rhi.zone/server-less",
      tier: "project",
      parent: "rhi",
      x: -291,
      y: 178,
      radius: 23,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "concord",
      label: "concord",
      description: "API bindings IR and codegen",
      url: "https://docs.rhi.zone/concord",
      tier: "project",
      parent: "rhi",
      x: -374,
      y: 215,
      radius: 22,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "rescribe",
      label: "rescribe",
      description: "Lossless document conversion",
      url: "https://docs.rhi.zone/rescribe",
      tier: "project",
      parent: "rhi",
      x: -466,
      y: 215,
      radius: 22,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "playmate",
      label: "playmate",
      description: "Game design primitives",
      url: "https://docs.rhi.zone/playmate",
      tier: "project",
      parent: "rhi",
      x: -549,
      y: 178,
      radius: 24,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "interconnect",
      label: "interconnect",
      description: "Federation protocol for persistent worlds",
      url: "https://docs.rhi.zone/interconnect",
      tier: "project",
      parent: "rhi",
      x: -611,
      y: 110,
      radius: 23,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "reincarnate",
      label: "reincarnate",
      description: "Legacy software lifting",
      url: "https://docs.rhi.zone/reincarnate",
      tier: "project",
      parent: "rhi",
      x: -639,
      y: 23,
      radius: 22,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "myenv",
      label: "myenv",
      description: "Ecosystem orchestrator",
      url: "https://docs.rhi.zone/myenv",
      tier: "project",
      parent: "rhi",
      x: -629,
      y: -68,
      radius: 20,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "portals",
      label: "portals",
      description: "Standard library interfaces",
      url: "https://docs.rhi.zone/portals",
      tier: "project",
      parent: "rhi",
      x: -583,
      y: -147,
      radius: 20,
      color: "oklch(0.78 0.09 155)",
    },
    {
      id: "zone",
      label: "zone",
      description: "Lua-based tools and orchestration",
      url: "https://docs.rhi.zone/zone",
      tier: "project",
      parent: "rhi",
      x: -509,
      y: -201,
      radius: 20,
      color: "oklch(0.78 0.09 155)",
    },

    // exo projects
    {
      id: "hologram",
      label: "hologram",
      description: "Discord bot - entities with text-based definitions",
      url: "https://docs.exo.place/hologram",
      tier: "project",
      parent: "exo",
      x: 370,
      y: -87,
      radius: 30,
      color: "oklch(0.78 0.09 320)",
    },
    {
      id: "aspect",
      label: "aspect",
      description: "Card-based identity exploration sandbox",
      url: "https://docs.exo.place/aspect",
      tier: "project",
      parent: "exo",
      x: 270,
      y: 87,
      radius: 28,
      color: "oklch(0.78 0.09 320)",
    },

    // Standalone projects
    {
      id: "claude-code-hub",
      label: "claude-code-hub",
      description: "Orchestration hub for Claude Code agents",
      url: "https://github.com/pterror/claude-code-hub",
      tier: "project",
      x: -80,
      y: -280,
      radius: 26,
      color: "oklch(0.78 0.09 85)",
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
    },
    {
      id: "ooxml",
      label: "ooxml",
      description: "Office Open XML library for Rust",
      url: "https://pterror.github.io/ooxml",
      tier: "project",
      x: -80,
      y: 280,
      radius: 24,
      color: "oklch(0.78 0.09 85)",
    },
    {
      id: "pad",
      label: "pad",
      description: "CLI stdin sink - captures and structures data locally",
      url: "https://pterror.github.io/pad",
      tier: "project",
      x: 80,
      y: 280,
      radius: 22,
      color: "oklch(0.78 0.09 85)",
    },
    {
      id: "lua",
      label: "lua",
      description: "LuaJIT sandbox - libraries, bindings, and CLI experiments",
      url: "https://github.com/pterror/lua",
      tier: "project",
      x: 0,
      y: 330,
      radius: 22,
      color: "oklch(0.78 0.09 85)",
    },
  ];

  const containmentEdges: Edge[] = nodes
    .filter((n) => n.parent)
    .map((n) => ({ from: n.parent!, to: n.id }));

  const edges: Edge[] = [...containmentEdges, ...relatedEdges];

  return { nodes, edges };
}
