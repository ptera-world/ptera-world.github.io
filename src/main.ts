import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform, setFilterRef, updatePositions } from "./dom";
import { setupInput } from "./input";
import { initPanel } from "./panel";
import { hideCard } from "./card";
import { createFilter, buildFilterUI, applyFilter, getVisibleIds } from "./filter";
import { runLayout, resetLayout } from "./layout";

const camera = createCamera();
const graph = createGraph();

buildWorld(graph);

const filter = createFilter(graph.nodes);
setFilterRef(filter);
applyFilter(filter, graph);
buildFilterUI(document.getElementById("filter-bar")!, filter, () => {
  applyFilter(filter, graph);
  if (filter.active.size > 0) {
    runLayout(graph, getVisibleIds(filter, graph));
  } else {
    resetLayout(graph);
  }
  updatePositions(graph);
  hideCard();
});

updateTransform(camera);
const input = setupInput(document.getElementById("viewport")!, camera, graph);
initPanel(camera, graph);

// Handle ?focus= query param
const focusId = new URLSearchParams(location.search).get("focus");
if (focusId) {
  const node = graph.nodes.find((n) => n.id === focusId);
  if (node) {
    input.navigateTo(node, false);
    history.replaceState({ focus: node.id }, "", `?focus=${node.id}`);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
