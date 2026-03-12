import { generatedNodes, generatedEdges } from "./generated-graph";

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
  /** Fragment body text (rendered on canvas). */
  body?: string;
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

export function createGraph(): Graph {
  const nodes: Node[] = generatedNodes.map((n) => ({ ...n, baseX: n.x, baseY: n.y }));

  const containmentEdges: Edge[] = nodes
    .filter((n) => n.parent)
    .map((n) => ({ from: n.parent!, to: n.id, strength: 0.7 }));

  return { nodes, edges: [...containmentEdges, ...generatedEdges] };
}
