import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform } from "./dom";
import { setupInput } from "./input";

const camera = createCamera();
const graph = createGraph();

buildWorld(graph);
updateTransform(camera);
setupInput(document.getElementById("viewport")!, camera, graph);

// Unregister stale service workers and clear their caches
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) r.unregister();
  });
  caches.keys().then((keys) => {
    for (const k of keys) caches.delete(k);
  });
}
