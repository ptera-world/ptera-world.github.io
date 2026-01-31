import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform } from "./dom";
import { setupInput } from "./input";
import { initPanel } from "./panel";

const camera = createCamera();
const graph = createGraph();

buildWorld(graph);
updateTransform(camera);
setupInput(document.getElementById("viewport")!, camera, graph);
initPanel(camera);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
