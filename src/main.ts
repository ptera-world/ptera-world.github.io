import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform, setFilterRef } from "./dom";
import { setupInput } from "./input";
import { initPanel } from "./panel";
import { createFilter, buildFilterUI, applyFilter } from "./filter";

const camera = createCamera();
const graph = createGraph();

buildWorld(graph);

const filter = createFilter(graph.nodes);
setFilterRef(filter);
applyFilter(filter, graph);
buildFilterUI(document.getElementById("filter-bar")!, filter, () => {
  applyFilter(filter, graph);
});

updateTransform(camera);
setupInput(document.getElementById("viewport")!, camera, graph);
initPanel(camera, graph);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
