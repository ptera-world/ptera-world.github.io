import type { Camera } from "./camera";
import type { Graph } from "./graph";

// World bounds (encompass all node positions with padding)
const WORLD_X_MIN = -590;
const WORLD_X_MAX = 590;
const WORLD_Y_MIN = -350;
const WORLD_Y_MAX = 350;
const WORLD_W = WORLD_X_MAX - WORLD_X_MIN;
const WORLD_H = WORLD_Y_MAX - WORLD_Y_MIN;

const WIDTH = 160;
const HEIGHT = Math.round(WIDTH * (WORLD_H / WORLD_W));

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let graphRef: Graph;
let viewportEl: HTMLElement;

function worldToMinimap(wx: number, wy: number): [number, number] {
  return [
    ((wx - WORLD_X_MIN) / WORLD_W) * WIDTH,
    ((wy - WORLD_Y_MIN) / WORLD_H) * HEIGHT,
  ];
}

function minimapToWorld(mx: number, my: number): [number, number] {
  return [
    WORLD_X_MIN + (mx / WIDTH) * WORLD_W,
    WORLD_Y_MIN + (my / HEIGHT) * WORLD_H,
  ];
}

export function createMinimap(
  camera: Camera,
  graph: Graph,
  panTo: (x: number, y: number, animate: boolean) => void,
): void {
  graphRef = graph;
  viewportEl = document.getElementById("viewport")!;

  canvas = document.createElement("canvas");
  canvas.id = "minimap";
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.setAttribute("aria-hidden", "true");
  ctx = canvas.getContext("2d")!;

  viewportEl.appendChild(canvas);

  // Redraw on resize so viewport rect stays accurate
  window.addEventListener("resize", () => updateMinimap(camera));

  // Click + drag to pan camera
  let dragging = false;

  function panFromEvent(e: MouseEvent, animate: boolean): void {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (WIDTH / rect.width);
    const my = (e.clientY - rect.top) * (HEIGHT / rect.height);
    const [wx, wy] = minimapToWorld(mx, my);
    panTo(wx, wy, animate);
  }

  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    panFromEvent(e, false);
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    panFromEvent(e, false);
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
  });
}

export function updateMinimap(camera: Camera): void {
  if (!canvas) return;

  // Fade out at far zoom (whole graph already visible)
  const opacity = Math.max(0, Math.min(1, (camera.zoom - 1.5) / 0.5));
  canvas.style.opacity = `${opacity}`;
  if (opacity === 0) return;

  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // Background
  ctx.fillStyle = "rgba(20, 20, 20, 0.75)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Draw nodes as colored dots
  for (const node of graphRef.nodes) {
    const [mx, my] = worldToMinimap(node.x, node.y);
    const r = node.tier === "ecosystem"
      ? Math.max(2, (node.radius / WORLD_W) * WIDTH * 0.3)
      : Math.max(1.5, (node.radius / WORLD_W) * WIDTH);
    ctx.fillStyle = node.color;
    ctx.globalAlpha = node.tier === "ecosystem" ? 0.3 : 0.8;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Draw viewport rectangle (use viewport element, not window, to account for panel)
  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;
  const viewLeft = camera.x - vw / (2 * camera.zoom);
  const viewTop = camera.y - vh / (2 * camera.zoom);
  const viewRight = camera.x + vw / (2 * camera.zoom);
  const viewBottom = camera.y + vh / (2 * camera.zoom);

  const [rx, ry] = worldToMinimap(viewLeft, viewTop);
  const [rx2, ry2] = worldToMinimap(viewRight, viewBottom);
  const rw = rx2 - rx;
  const rh = ry2 - ry;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, rw, rh);
}
