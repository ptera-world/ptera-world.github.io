import type { Grouping } from "./groupings";

/** Node in the world graph. */
export interface Node {
  id: string;
  label: string;
  description: string;
  url?: string;
  /** Parent region id, if any. */
  parent?: string;
  /** Layout cluster id, if any (for rootless artifact nodes). */
  cluster?: string;
  /** Current position (mutated by layout). */
  x: number;
  y: number;
  /** DOM layout anchor — tracks the active grouping's rest position. Updated after grouping transitions. */
  baseX: number;
  baseY: number;
  /** Collision/card radius at native zoom. */
  radius: number;
  /** Visual dot radius — defaults to radius if not set. */
  iconRadius?: number;
  /** Collision radius for layout — defaults to radius if not set. */
  collisionRadius?: number;
  color: string;
  status?: "production" | "fleshed-out" | "early" | "planned";
  tags: string[];
  /** Fragment body text (source, used for collision radius). */
  body?: string;
  /** Fragment body pre-rendered as HTML (used for canvas display). */
  bodyHtml?: string;
  /** Optional tagline shown below description on the landing element. */
  trail?: string;
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

/** A collection's content as the build writes it (`graph.json` next to the collection's page). */
export interface GraphData {
  nodes: Omit<Node, "baseX" | "baseY">[];
  edges: Edge[];
  groupings: Grouping[];
}

export function createGraph(data: Pick<GraphData, "nodes" | "edges">): Graph {
  const nodes: Node[] = data.nodes.map((n) => ({ ...n, baseX: n.x, baseY: n.y }));

  const containmentEdges: Edge[] = nodes
    .filter((n) => n.parent)
    .map((n) => ({ from: n.parent!, to: n.id, strength: 0.7 }));

  return { nodes, edges: [...containmentEdges, ...data.edges] };
}
