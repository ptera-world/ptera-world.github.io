/**
 * Animated force-directed layout that reorganizes the graph
 * around the currently focused node. Runs incrementally via
 * requestAnimationFrame until the simulation settles.
 */
import type { Graph, Node } from "./graph";
import { updatePositions, nodeEls } from "./dom";
import { getSettings } from "./settings";

const STEPS_PER_FRAME = 4;
const REPEL = 4000;
const SPRING_K = 0.012;
const SPRING_LEN = 80;
const ANCHOR_K = 0.025;
const DAMPING = 0.86;
const MAX_FORCE = 8;
const SETTLE_THRESHOLD = 0.3;
const NEIGHBORHOOD_HOPS = 2;

export function createFocusLayout(graph: Graph) {
  let focusedId: string | null = null;
  let neighborIds = new Set<string>();
  const vx = new Map<string, number>();
  const vy = new Map<string, number>();
  const anchorX = new Map<string, number>();
  const anchorY = new Map<string, number>();
  let rafId = 0;

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  function getNeighborhood(nodeId: string, hops: number): Set<string> {
    const result = new Set<string>([nodeId]);
    let frontier = new Set([nodeId]);
    for (let h = 0; h < hops; h++) {
      const next = new Set<string>();
      for (const id of frontier) {
        for (const edge of graph.edges) {
          const other =
            edge.from === id ? edge.to : edge.to === id ? edge.from : null;
          if (other && !result.has(other)) {
            result.add(other);
            next.add(other);
          }
        }
      }
      frontier = next;
    }
    return result;
  }

  function onFocusChange(node: Node | null): void {
    if (!getSettings().dynamicLayout) return;

    const newId = node?.id ?? null;
    if (newId === focusedId) return;
    focusedId = newId;

    if (!focusedId) {
      stop();
      for (const n of graph.nodes) {
        n.x = n.baseX;
        n.y = n.baseY;
      }
      updatePositions(graph);
      clearNeighborhoodAttr();
      return;
    }

    neighborIds = getNeighborhood(focusedId, NEIGHBORHOOD_HOPS);
    applyNeighborhoodAttr();

    vx.clear();
    vy.clear();
    anchorX.clear();
    anchorY.clear();
    for (const n of graph.nodes) {
      vx.set(n.id, 0);
      vy.set(n.id, 0);
      anchorX.set(n.id, n.x);
      anchorY.set(n.id, n.y);
    }

    start();
  }

  function start(): void {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function tick(): void {
    rafId = 0;
    if (!focusedId) return;

    const active = graph.nodes.filter(
      (n) => neighborIds.has(n.id) && !n.tags.includes("meta"),
    );
    const edges = graph.edges.filter(
      (e) => neighborIds.has(e.from) && neighborIds.has(e.to),
    );

    let maxV = 0;

    for (let step = 0; step < STEPS_PER_FRAME; step++) {
      maxV = 0;

      // Repulsion between active nodes
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const a = active[i]!,
            b = active[j]!;
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          const d = Math.sqrt(d2) || 1;
          const f = Math.min(REPEL / d2, MAX_FORCE);
          const fx = (dx / d) * f,
            fy = (dy / d) * f;
          if (a.id !== focusedId) {
            vx.set(a.id, vx.get(a.id)! - fx);
            vy.set(a.id, vy.get(a.id)! - fy);
          }
          if (b.id !== focusedId) {
            vx.set(b.id, vx.get(b.id)! + fx);
            vy.set(b.id, vy.get(b.id)! + fy);
          }
        }
      }

      // Spring attraction along edges (weighted by edge strength)
      for (const edge of edges) {
        const a = nodeMap.get(edge.from),
          b = nodeMap.get(edge.to);
        if (!a || !b) continue;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - SPRING_LEN) * SPRING_K * edge.strength;
        const fx = (dx / d) * f,
          fy = (dy / d) * f;
        if (a.id !== focusedId) {
          vx.set(a.id, vx.get(a.id)! + fx);
          vy.set(a.id, vy.get(a.id)! + fy);
        }
        if (b.id !== focusedId) {
          vx.set(b.id, vx.get(b.id)! - fx);
          vy.set(b.id, vy.get(b.id)! - fy);
        }
      }

      // Anchor toward pre-focus positions
      for (const n of active) {
        if (n.id === focusedId) continue;
        const ax = anchorX.get(n.id)!,
          ay = anchorY.get(n.id)!;
        vx.set(n.id, vx.get(n.id)! + (ax - n.x) * ANCHOR_K);
        vy.set(n.id, vy.get(n.id)! + (ay - n.y) * ANCHOR_K);
      }

      // Apply velocities with damping
      for (const n of active) {
        if (n.id === focusedId) continue;
        const nvx = vx.get(n.id)! * DAMPING;
        const nvy = vy.get(n.id)! * DAMPING;
        vx.set(n.id, nvx);
        vy.set(n.id, nvy);
        n.x += nvx;
        n.y += nvy;
        maxV = Math.max(maxV, Math.abs(nvx), Math.abs(nvy));
      }

      if (maxV < SETTLE_THRESHOLD) break;
    }

    updatePositions(graph);

    if (maxV >= SETTLE_THRESHOLD) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function applyNeighborhoodAttr(): void {
    if (!getSettings().neighborhoodFocus) return;
    for (const [id, el] of nodeEls) {
      if (neighborIds.has(id)) {
        delete el.dataset.neighborhood;
      } else {
        el.dataset.neighborhood = "distant";
      }
    }
  }

  function clearNeighborhoodAttr(): void {
    for (const [, el] of nodeEls) {
      delete el.dataset.neighborhood;
    }
  }

  return {
    onFocusChange,
    /** Current neighborhood node IDs (empty when no focus). */
    getNeighborIds: () => neighborIds,
  };
}
