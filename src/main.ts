import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform, setFilterRef, updatePositions, animateTo, worldEl } from "./dom";
import { setupInput } from "./input";
import { initPanel, openPanel } from "./panel";
import { showCard, hideCard, getCurrentCardNode, setCardToggleFilter, setCardIsTagActive, setCardGetTagColor } from "./card";
import { createFilter, buildFilterUI, applyFilter, getVisibleIds, setActive, updateFilterPillColors } from "./filter";
import { runLayout } from "./layout";
import { createFocusLayout } from "./focus-layout";
import { loadSettingsFromUrl } from "./settings";
import { createMinimap } from "./minimap";
import { initGroupingState, buildGroupingUI, restoreGroupingFromUrl, getTagColor, setOnGroupingChange, resetToCurrentGrouping } from "./grouping-state";
import { siteConfig, getActiveCollection, siteUrl } from "./site-config";

loadSettingsFromUrl();
const camera = createCamera();
const graph = createGraph();

// Center camera on the active collection's meta node
const collectionMeta = siteConfig.collections[getActiveCollection()];
const metaNode = graph.nodes.find((n) => n.id === collectionMeta.metaNodeId);
if (metaNode) { camera.x = metaNode.x; camera.y = metaNode.y; }

// Disable transitions during initial setup
worldEl.dataset.noTransition = "";

buildWorld(graph);

// Initialize grouping state and restore from URL
initGroupingState(graph, camera);
restoreGroupingFromUrl();

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
buildGroupingUI(document.getElementById("grouping-bar")!);
buildFilterUI(document.getElementById("filter-bar")!, filter, () => {
  applyFilter(filter, graph);
  if (filter.active.size > 0) {
    runLayout(graph, getVisibleIds(filter, graph));
  } else {
    resetToCurrentGrouping(graph);
  }
  updatePositions(graph);
  hideCard();
  updateFilterUrl();
});

// Card tag support: clicking a tag on the card toggles the filter and compensates camera.
setCardToggleFilter((tag: string) => {
  const cardNode = getCurrentCardNode();
  const preX = cardNode?.x ?? 0;
  const preY = cardNode?.y ?? 0;

  if (filter.active.has(tag)) filter.active.delete(tag); else filter.active.add(tag);
  applyFilter(filter, graph);
  if (filter.active.size > 0) runLayout(graph, getVisibleIds(filter, graph));
  else resetToCurrentGrouping(graph);
  updatePositions(graph);
  updateFilterUrl();
  syncFilterPills();

  if (cardNode) {
    const dx = cardNode.x - preX, dy = cardNode.y - preY;
    if (dx !== 0 || dy !== 0) animateTo(camera, camera.x + dx, camera.y + dy, camera.zoom);
    showCard(cardNode, graph);
  }
});
setCardIsTagActive((tag) => filter.active.has(tag));
setCardGetTagColor(getTagColor);

// Update filter pill + card tag colors when grouping changes.
setOnGroupingChange(() => {
  updateFilterPillColors(getTagColor);
  const cardNode = getCurrentCardNode();
  if (cardNode) showCard(cardNode, graph);
});
updateFilterPillColors(getTagColor);

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
const focusLayout = createFocusLayout(graph);
const input = setupInput(document.getElementById("viewport")!, camera, graph, {
  onFocusChange: (node) => focusLayout.onFocusChange(node),
});
initPanel(camera, graph);

// Handle ?focus= query param (snap without animation on page load)
const focusId = new URLSearchParams(location.search).get("focus");
if (focusId) {
  const node = graph.nodes.find((n) => n.id === focusId);
  if (node) {
    input.navigateTo(node, false, false);
    openPanel(node.id, node.label, false);
  }
}

// Re-enable transitions after initial setup
requestAnimationFrame(() => {
  delete worldEl.dataset.noTransition;
});

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
      resetToCurrentGrouping(graph);
    }
    updatePositions(graph);
    syncFilterPills();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(siteUrl("/sw.js")).catch(() => {});
}
