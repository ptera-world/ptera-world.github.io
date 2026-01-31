import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { createInputState, setupInput } from "./input";
import { render } from "./render";

const canvas = document.getElementById("world") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const camera = createCamera();
const graph = createGraph();
const input = createInputState();

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  scheduleRender();
}

let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    render(ctx, canvas, graph, camera, input.hovered);
  });
}

setupInput(canvas, camera, graph, input, scheduleRender);
window.addEventListener("resize", resize);
resize();
