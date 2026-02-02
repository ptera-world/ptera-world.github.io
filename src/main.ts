import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform, setFilterRef, updatePositions, animateTo } from "./dom";
import { setupInput } from "./input";
import { initPanel } from "./panel";
import { hideCard } from "./card";
import { createFilter, buildFilterUI, applyFilter, getVisibleIds, setActive } from "./filter";
import { runLayout, resetLayout } from "./layout";
import { createMinimap } from "./minimap";

const camera = createCamera();
const graph = createGraph();

buildWorld(graph);

const filter = createFilter(graph.nodes);
setFilterRef(filter);

function updateFilterUrl(): void {
  const params = new URLSearchParams(location.search);
  if (filter.active.size > 0) {
    params.set("filter", [...filter.active].sort().join(","));
  } else {
    params.delete("filter");
  }
  const qs = params.toString();
  history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
}

// Restore filter state from URL before first render
const initFilterParam = new URLSearchParams(location.search).get("filter");
if (initFilterParam) {
  setActive(filter, initFilterParam.split(","));
}

applyFilter(filter, graph);
if (filter.active.size > 0) {
  runLayout(graph, getVisibleIds(filter, graph));
  updatePositions(graph);
}
buildFilterUI(document.getElementById("filter-bar")!, filter, () => {
  applyFilter(filter, graph);
  if (filter.active.size > 0) {
    runLayout(graph, getVisibleIds(filter, graph));
  } else {
    resetLayout(graph);
  }
  updatePositions(graph);
  hideCard();
  updateFilterUrl();
});

createMinimap(camera, graph, (x, y, animate) => {
  if (animate) {
    animateTo(camera, x, y, camera.zoom);
  } else {
    camera.x = x;
    camera.y = y;
    updateTransform(camera);
  }
});
updateTransform(camera);
window.addEventListener("resize", () => updateTransform(camera));
const input = setupInput(document.getElementById("viewport")!, camera, graph);
initPanel(camera, graph);

// Handle ?focus= query param
const focusId = new URLSearchParams(location.search).get("focus");
if (focusId) {
  const node = graph.nodes.find((n) => n.id === focusId);
  if (node) {
    input.navigateTo(node, false);
  }
}

// Restore filters on popstate (back/forward)
function syncFilterPills(): void {
  const pills = document.querySelectorAll<HTMLElement>(".filter-pill[data-tag]");
  for (const pill of pills) {
    if (filter.active.has(pill.dataset.tag!)) {
      pill.dataset.active = "";
      pill.setAttribute("aria-pressed", "true");
    } else {
      delete pill.dataset.active;
      pill.setAttribute("aria-pressed", "false");
    }
  }
}

window.addEventListener("popstate", () => {
  const filterParam = new URLSearchParams(location.search).get("filter");
  const newTags = filterParam ? filterParam.split(",") : [];
  const current = [...filter.active].sort().join(",");
  const next = newTags.sort().join(",");
  if (current !== next) {
    setActive(filter, newTags);
    applyFilter(filter, graph);
    if (filter.active.size > 0) {
      runLayout(graph, getVisibleIds(filter, graph));
    } else {
      resetLayout(graph);
    }
    updatePositions(graph);
    syncFilterPills();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
