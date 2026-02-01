import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform, setFilterRef, setFocus, animateTo, updatePositions } from "./dom";
import { setupInput } from "./input";
import { initPanel, openPanel } from "./panel";
import { showCard, hideCard } from "./card";
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
    const vis = getVisibleIds(filter, graph);
    runLayout(graph, vis);
    updatePositions(graph);

    // Center camera on visible non-ecosystem nodes (keep current zoom)
    const visible = graph.nodes.filter(
      (n) => vis.has(n.id) && n.tier !== "ecosystem",
    );
    if (visible.length > 0) {
      let sumX = 0, sumY = 0;
      for (const n of visible) { sumX += n.x; sumY += n.y; }
      animateTo(camera, sumX / visible.length, sumY / visible.length, camera.zoom);
    }
  } else {
    resetLayout(graph);
    updatePositions(graph);
    animateTo(camera, 0, 0, 1.5);
  }
  hideCard();
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
