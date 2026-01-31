/** Camera state for pan/zoom. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

export function currentTier(camera: Camera): "far" | "mid" | "near" {
  if (camera.zoom < 0.6) return "far";
  if (camera.zoom < 2) return "mid";
  return "near";
}

export function screenToWorld(camera: Camera, sx: number, sy: number): [number, number] {
  return [
    (sx - window.innerWidth / 2) / camera.zoom + camera.x,
    (sy - window.innerHeight / 2) / camera.zoom + camera.y,
  ];
}
