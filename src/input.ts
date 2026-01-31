import type { Camera } from "./camera";
import { screenToWorld, worldToScreen } from "./camera";
import type { Graph, Node } from "./graph";

export interface InputState {
  dragging: boolean;
  lastX: number;
  lastY: number;
  hovered: Node | null;
}

export function createInputState(): InputState {
  return { dragging: false, lastX: 0, lastY: 0, hovered: null };
}

export function setupInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  graph: Graph,
  state: InputState,
  requestRender: () => void,
): void {
  canvas.addEventListener("mousedown", (e) => {
    state.dragging = true;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("mousemove", (e) => {
    if (state.dragging) {
      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      requestRender();
    } else {
      state.hovered = hitTest(canvas, camera, graph, e.clientX, e.clientY);
      canvas.style.cursor = state.hovered?.url ? "pointer" : "grab";
      requestRender();
    }
  });

  canvas.addEventListener("mouseup", () => {
    state.dragging = false;
    canvas.style.cursor = state.hovered?.url ? "pointer" : "grab";
  });

  canvas.addEventListener("mouseleave", () => {
    state.dragging = false;
    state.hovered = null;
    canvas.style.cursor = "grab";
    requestRender();
  });

  canvas.addEventListener("click", (e) => {
    const node = hitTest(canvas, camera, graph, e.clientX, e.clientY);
    if (node?.url) {
      window.open(node.url, "_blank");
    }
  });

  canvas.addEventListener("dblclick", (e) => {
    const node = hitTest(canvas, camera, graph, e.clientX, e.clientY);
    if (node) {
      // Smooth zoom to node
      animateTo(camera, node.x, node.y, camera.zoom * 2, requestRender);
    }
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [wx, wy] = screenToWorld(camera, e.clientX, e.clientY, canvas);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    camera.zoom = Math.max(0.3, Math.min(10, camera.zoom * factor));
    // Keep world point under cursor stable
    const [sx2, sy2] = worldToScreen(camera, wx, wy, canvas);
    camera.x += (sx2 - e.clientX) / camera.zoom;
    camera.y += (sy2 - e.clientY) / camera.zoom;
    requestRender();
  }, { passive: false });

  // Touch support
  let lastTouchDist = 0;
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      state.dragging = true;
      state.lastX = e.touches[0]!.clientX;
      state.lastY = e.touches[0]!.clientY;
    } else if (e.touches.length === 2) {
      lastTouchDist = touchDist(e);
    }
  });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && state.dragging) {
      const dx = e.touches[0]!.clientX - state.lastX;
      const dy = e.touches[0]!.clientY - state.lastY;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      state.lastX = e.touches[0]!.clientX;
      state.lastY = e.touches[0]!.clientY;
      requestRender();
    } else if (e.touches.length === 2) {
      const dist = touchDist(e);
      const factor = dist / lastTouchDist;
      camera.zoom = Math.max(0.3, Math.min(10, camera.zoom * factor));
      lastTouchDist = dist;
      requestRender();
    }
  }, { passive: false });

  canvas.addEventListener("touchend", () => {
    state.dragging = false;
  });
}

function hitTest(
  canvas: HTMLCanvasElement,
  camera: Camera,
  graph: Graph,
  sx: number,
  sy: number,
): Node | null {
  const [wx, wy] = screenToWorld(camera, sx, sy, canvas);
  let closest: Node | null = null;
  let closestDist = Infinity;
  for (const node of graph.nodes) {
    const dx = wx - node.x;
    const dy = wy - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hitRadius = node.tier === "ecosystem"
      ? node.radius * 0.15
      : node.radius;
    if (dist < hitRadius + 10 / camera.zoom && dist < closestDist) {
      closest = node;
      closestDist = dist;
    }
  }
  return closest;
}

function touchDist(e: TouchEvent): number {
  const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
  const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function animateTo(
  camera: Camera,
  tx: number,
  ty: number,
  tz: number,
  requestRender: () => void,
): void {
  const duration = 300;
  const sx = camera.x, sy = camera.y, sz = camera.zoom;
  const start = performance.now();

  function step(now: number) {
    const t = Math.min(1, (now - start) / duration);
    const ease = t * (2 - t); // ease-out quad
    camera.x = sx + (tx - sx) * ease;
    camera.y = sy + (ty - sy) * ease;
    camera.zoom = sz + (tz - sz) * ease;
    requestRender();
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}
