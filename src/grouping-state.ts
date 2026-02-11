/**
 * Manages active grouping state and applies position changes to the graph.
 */

import type { Graph, Node } from "./graph";
import { groupings, defaultGrouping, getGrouping, type Grouping } from "./groupings";
import { updatePositions, animateTo, fadeOutRegions, fadeInRegions, nodeEls, type NodePositionWithRegion } from "./dom";
import type { Camera } from "./camera";

let currentLayoutGrouping: Grouping = defaultGrouping;
let currentColorGrouping: Grouping = defaultGrouping;
let graphRef: Graph;
let cameraRef: Camera;

/** Store original positions and colors from graph.ts */
const originalData = new Map<string, { x: number; y: number; color: string; parent?: string }>();
/** IDs of region nodes from graph.ts (for containment edge restoration) */
const graphRegionIds = new Set<string>();

export function initGroupingState(graph: Graph, camera: Camera): void {
  graphRef = graph;
  cameraRef = camera;

  // Store original positions, colors, and track region nodes
  for (const node of graph.nodes) {
    originalData.set(node.id, {
      x: node.baseX,
      y: node.baseY,
      color: node.color,
      parent: node.parent,
    });
    if (node.tier === "region") {
      graphRegionIds.add(node.id);
    }
  }
}

export function getCurrentLayoutGrouping(): Grouping {
  return currentLayoutGrouping;
}

export function getCurrentColorGrouping(): Grouping {
  return currentColorGrouping;
}

/** Compute node positions with regionIds for a given grouping. */
function computePositionsForGrouping(grouping: Grouping): NodePositionWithRegion[] {
  const positions: NodePositionWithRegion[] = [];

  for (const node of graphRef.nodes) {
    if (node.tier === "region") continue;

    const override = grouping.positions[node.id];
    const original = originalData.get(node.id);

    // For ecosystem grouping, use the node's parent as regionId
    let regionId = override?.regionId;
    if (!regionId && grouping.id === "ecosystem" && node.parent) {
      regionId = node.parent;
    }

    const x = override?.x ?? original?.x ?? node.x;
    const y = override?.y ?? original?.y ?? node.y;

    positions.push({ nodeId: node.id, x, y, regionId });
  }

  return positions;
}

export function getGroupings(): Grouping[] {
  return groupings;
}

/** Set layout grouping (positions + regions). If colors were linked, they follow. */
export function setLayoutGrouping(groupingId: string, updateColors = true): void {
  const grouping = getGrouping(groupingId);
  if (!grouping || grouping.id === currentLayoutGrouping.id) return;

  const wasLinked = currentLayoutGrouping.id === currentColorGrouping.id;

  const fadeDuration = 300;

  // Fade out current regions and their containment edges
  fadeOutRegions(fadeDuration);

  // Compute positions for new containment edges
  const positions = computePositionsForGrouping(grouping);

  // Fade in new regions (with slight delay for crossfade overlap)
  setTimeout(() => {
    fadeInRegions(grouping.regions, positions, fadeDuration);
  }, fadeDuration * 0.3);

  currentLayoutGrouping = grouping;

  // If colors were linked to layout, keep them linked
  if (wasLinked && updateColors) {
    currentColorGrouping = grouping;
  }

  applyGroupingPositions();
  updateUrl();
}

/** Set color grouping only (no position/region changes). */
export function setColorGrouping(groupingId: string): void {
  const grouping = getGrouping(groupingId);
  if (!grouping || grouping.id === currentColorGrouping.id) return;

  currentColorGrouping = grouping;
  applyGroupingColors();
  updateUrl();
}

function updateUrl(): void {
  const params = new URLSearchParams(location.search);

  // Layout param
  if (currentLayoutGrouping.id === defaultGrouping.id) {
    params.delete("grouping");
  } else {
    params.set("grouping", currentLayoutGrouping.id);
  }

  // Color param (only if different from layout)
  if (currentColorGrouping.id === currentLayoutGrouping.id) {
    params.delete("colors");
  } else {
    params.set("colors", currentColorGrouping.id);
  }

  const qs = params.toString();
  history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
}

/** Apply colors from currentColorGrouping (CSS transition handles animation). */
function applyGroupingColors(): void {
  for (const node of graphRef.nodes) {
    if (node.tier === "region") continue;
    const el = nodeEls.get(node.id);
    if (!el) continue;

    const override = currentColorGrouping.positions[node.id];
    const original = originalData.get(node.id);
    const color = override?.color ?? original?.color ?? node.color;
    el.style.setProperty("--color", color);
  }
}

function applyGroupingPositions(animate = true): void {
  // Compute target positions (only update x/y, NOT baseX/baseY)
  // baseX/baseY stays as original position from buildWorld
  // translate CSS will handle the offset
  const targets = new Map<string, { x: number; y: number }>();

  for (const node of graphRef.nodes) {
    if (node.tier === "region") continue;

    const override = currentLayoutGrouping.positions[node.id];
    const original = originalData.get(node.id);

    if (override) {
      targets.set(node.id, { x: override.x, y: override.y });
    } else if (original) {
      targets.set(node.id, { x: original.x, y: original.y });
    }
  }

  // Apply colors from color grouping
  applyGroupingColors();

  if (!animate) {
    // Snap immediately
    for (const node of graphRef.nodes) {
      const target = targets.get(node.id);
      if (target) {
        node.x = target.x;
        node.y = target.y;
      }
    }
    updatePositions(graphRef);
    return;
  }

  // Animate to target positions
  const duration = 400;
  const start = performance.now();
  const startPositions = new Map<string, { x: number; y: number }>();

  for (const node of graphRef.nodes) {
    if (targets.has(node.id)) {
      startPositions.set(node.id, { x: node.x, y: node.y });
    }
  }

  function step(now: number) {
    const t = Math.min(1, (now - start) / duration);
    const ease = t * (2 - t); // ease-out

    for (const node of graphRef.nodes) {
      const target = targets.get(node.id);
      const startPos = startPositions.get(node.id);
      if (target && startPos) {
        node.x = startPos.x + (target.x - startPos.x) * ease;
        node.y = startPos.y + (target.y - startPos.y) * ease;
      }
    }

    updatePositions(graphRef);

    if (t < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

/** Restore grouping from URL on page load */
export function restoreGroupingFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const layoutId = params.get("grouping");
  const colorId = params.get("colors");

  // Restore layout grouping
  if (layoutId) {
    const layoutGrouping = getGrouping(layoutId);
    if (layoutGrouping && layoutGrouping.id !== defaultGrouping.id) {
      currentLayoutGrouping = layoutGrouping;
      const positions = computePositionsForGrouping(layoutGrouping);
      // Swap regions immediately (no animation on page load)
      fadeOutRegions(0);
      fadeInRegions(layoutGrouping.regions, positions, 0);
    }
  }

  // Restore color grouping (defaults to layout if not specified)
  if (colorId) {
    const colorGrouping = getGrouping(colorId);
    if (colorGrouping) {
      currentColorGrouping = colorGrouping;
    }
  } else {
    currentColorGrouping = currentLayoutGrouping;
  }

  applyGroupingPositions(false); // Don't animate on page load
}

let legendEl: HTMLElement | null = null;

function updateLegend(): void {
  if (!legendEl) return;

  // Show legend when colors differ from layout (decoupled state)
  const showLegend = currentColorGrouping.id !== currentLayoutGrouping.id;

  if (showLegend) {
    // Populate legend with color grouping's regions
    legendEl.innerHTML = "";
    for (const region of currentColorGrouping.regions) {
      const item = document.createElement("div");
      item.className = "legend-item";

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = region.color;

      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = region.label;

      item.appendChild(swatch);
      item.appendChild(label);
      legendEl.appendChild(item);
    }
    legendEl.dataset.visible = "";
  } else {
    delete legendEl.dataset.visible;
  }
}

export function buildGroupingUI(container: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = "grouping-selector";

  for (const grouping of groupings) {
    const pill = document.createElement("div");
    pill.className = "grouping-pill";
    pill.dataset.grouping = grouping.id;

    // Layout button (left side)
    const layoutBtn = document.createElement("button");
    layoutBtn.className = "grouping-layout";
    layoutBtn.textContent = grouping.label;
    if (grouping.id === currentLayoutGrouping.id) {
      layoutBtn.dataset.active = "";
    }

    // Divider
    const divider = document.createElement("span");
    divider.className = "grouping-divider";

    // Color button (right side)
    const colorBtn = document.createElement("button");
    colorBtn.className = "grouping-color";
    colorBtn.innerHTML = "&#x1F3A8;"; // 🎨
    colorBtn.title = `Color by ${grouping.label}`;
    if (grouping.id === currentColorGrouping.id) {
      colorBtn.dataset.active = "";
    }

    layoutBtn.addEventListener("click", () => {
      // Update layout active state
      for (const b of wrapper.querySelectorAll<HTMLElement>(".grouping-layout")) {
        delete b.dataset.active;
      }
      layoutBtn.dataset.active = "";

      // If colors were linked (same as old layout), update color active state too
      const wasLinked = currentLayoutGrouping.id === currentColorGrouping.id;
      if (wasLinked) {
        for (const b of wrapper.querySelectorAll<HTMLElement>(".grouping-color")) {
          delete b.dataset.active;
        }
        colorBtn.dataset.active = "";
      }

      setLayoutGrouping(grouping.id);
      updateLegend();
    });

    colorBtn.addEventListener("click", () => {
      // Update color active state only
      for (const b of wrapper.querySelectorAll<HTMLElement>(".grouping-color")) {
        delete b.dataset.active;
      }
      colorBtn.dataset.active = "";

      setColorGrouping(grouping.id);
      updateLegend();
    });

    pill.appendChild(layoutBtn);
    pill.appendChild(divider);
    pill.appendChild(colorBtn);
    wrapper.appendChild(pill);
  }

  container.appendChild(wrapper);

  // Create legend below pills
  legendEl = document.createElement("div");
  legendEl.className = "color-legend";
  container.appendChild(legendEl);

  // Initialize legend state
  updateLegend();
}
