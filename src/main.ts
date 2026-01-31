import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform, setFilterRef, setFocus, animateTo } from "./dom";
import { setupInput } from "./input";
import { initPanel, openPanel } from "./panel";
import { showCard } from "./card";
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

// Handle ?focus= query param
const focusId = new URLSearchParams(location.search).get("focus");
if (focusId) {
  const node = graph.nodes.find((n) => n.id === focusId);
  if (node) {
    setFocus(graph, node);
    animateTo(camera, node.x, node.y, 3);
    showCard(node, graph);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
