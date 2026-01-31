/** Camera state for pan/zoom on the canvas. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

/** Convert world coordinates to screen coordinates. */
export function worldToScreen(
  camera: Camera,
  wx: number,
  wy: number,
  canvas: HTMLCanvasElement,
): [number, number] {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return [
    cx + (wx - camera.x) * camera.zoom,
    cy + (wy - camera.y) * camera.zoom,
  ];
}

/** Convert screen coordinates to world coordinates. */
export function screenToWorld(
  camera: Camera,
  sx: number,
  sy: number,
  canvas: HTMLCanvasElement,
): [number, number] {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return [
    (sx - cx) / camera.zoom + camera.x,
    (sy - cy) / camera.zoom + camera.y,
  ];
}

/** Current tier based on zoom level. */
export function currentTier(
  camera: Camera,
): "far" | "mid" | "near" {
  if (camera.zoom < 1.5) return "far";
  if (camera.zoom < 3.5) return "mid";
  return "near";
}
