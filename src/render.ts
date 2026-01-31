import type { Camera } from "./camera";
import { worldToScreen, currentTier } from "./camera";
import type { Graph, Node } from "./graph";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** Render the graph to canvas given current camera state. */
export function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  graph: Graph,
  camera: Camera,
  hovered: Node | null,
  alphas: Map<string, number>,
): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const tier = currentTier(camera);
  const focused = buildFocusSet(graph, hovered);

  // Draw edges
  for (const edge of graph.edges) {
    const from = graph.nodes.find((n) => n.id === edge.from);
    const to = graph.nodes.find((n) => n.id === edge.to);
    if (!from || !to) continue;

    // Skip ecosystem→project containment edges at far zoom
    if (tier === "far" && (from.tier === "ecosystem" || to.tier === "ecosystem")) {
      if (from.tier !== to.tier) continue;
    }

    const fromAlpha = alphas.get(from.id) ?? 1;
    const toAlpha = alphas.get(to.id) ?? 1;
    const minAlpha = Math.min(fromAlpha, toAlpha);
    const edgeFocused = !hovered || (focused.has(from.id) && focused.has(to.id));
    const baseAlpha = hovered ? 0.7 : 0.4;

    ctx.globalAlpha = baseAlpha * minAlpha;

    const [x1, y1] = worldToScreen(camera, from.x, from.y, canvas);
    const [x2, y2] = worldToScreen(camera, to.x, to.y, canvas);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = edgeFocused && hovered ? "#aaa" : "#555";
    ctx.lineWidth = edgeFocused && hovered ? 1.5 : 1;
    ctx.stroke();

    // Edge labels at mid+near zoom
    if (tier !== "far" && edge.label && edgeFocused) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      ctx.globalAlpha = 0.5 * minAlpha;
      ctx.font = `10px ${FONT}`;
      ctx.fillStyle = "#999";
      ctx.textAlign = "center";
      ctx.fillText(edge.label, mx, my - 4);
    }
  }
  ctx.globalAlpha = 1;

  // Draw nodes — all nodes always render
  for (const node of graph.nodes) {
    const [sx, sy] = worldToScreen(camera, node.x, node.y, canvas);
    const sr = node.radius * camera.zoom;

    // Skip if offscreen
    if (sx + sr < 0 || sx - sr > canvas.width) continue;
    if (sy + sr < 0 || sy - sr > canvas.height) continue;

    const isHovered = hovered?.id === node.id;
    const nodeAlpha = alphas.get(node.id) ?? 1;

    ctx.globalAlpha = nodeAlpha;

    // Ecosystem glow at far zoom
    if (node.tier === "ecosystem" && tier === "far") {
      const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      gradient.addColorStop(0, node.color + "40");
      gradient.addColorStop(1, node.color + "00");
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Node circle — project nodes at far zoom draw as small dots (min 4px)
    const drawRadius = node.tier === "ecosystem"
      ? Math.max(sr * 0.15, 3)
      : Math.max(sr, 4);

    ctx.beginPath();
    ctx.arc(sx, sy, drawRadius, 0, Math.PI * 2);
    ctx.fillStyle = isHovered ? lighten(node.color) : node.color;
    ctx.fill();

    if (isHovered) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Labels
    if (node.tier === "ecosystem") {
      // Ecosystem labels always visible, sized to screen radius
      const fontSize = Math.max(14, sr * 0.18);
      ctx.font = `bold ${fontSize}px ${FONT}`;
      ctx.fillStyle = "#ddd";
      ctx.textAlign = "center";
      ctx.fillText(node.label, sx, sy + sr * 0.06);
    } else if (drawRadius > 8) {
      // Project labels when screen radius large enough
      const fontSize = Math.max(10, Math.min(14, sr * 0.5));
      ctx.font = `${fontSize}px ${FONT}`;
      ctx.fillStyle = isHovered ? "#fff" : "#ccc";
      ctx.textAlign = "center";
      ctx.fillText(node.label, sx, sy + drawRadius + fontSize + 2);
    }

    // Description at mid+near zoom
    if (tier !== "far" && (node.tier === "project" || isHovered) && nodeAlpha > 0.5) {
      const fontSize = Math.max(9, Math.min(11, sr * 0.3));
      ctx.font = `${fontSize}px ${FONT}`;
      ctx.fillStyle = "#888";
      ctx.textAlign = "center";
      ctx.fillText(node.description, sx, sy + drawRadius + 16 + fontSize);
    }
  }
  ctx.globalAlpha = 1;
}

/** Build set of node IDs that should be fully visible when a node is focused. */
export function buildFocusSet(graph: Graph, hovered: Node | null): Set<string> {
  const set = new Set<string>();
  if (!hovered) return set;
  set.add(hovered.id);
  if (hovered.parent) set.add(hovered.parent);
  for (const node of graph.nodes) {
    if (node.parent === hovered.id) set.add(node.id);
  }
  for (const edge of graph.edges) {
    if (edge.from === hovered.id) set.add(edge.to);
    if (edge.to === hovered.id) set.add(edge.from);
  }
  return set;
}

function lighten(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 0.3;
  return `rgb(${Math.round(r + (255 - r) * f)}, ${Math.round(g + (255 - g) * f)}, ${Math.round(b + (255 - b) * f)})`;
}
