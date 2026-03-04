/**
 * Manages active grouping state and applies position changes to the graph.
 */

import type { Graph, Node } from "./graph";
import { groupings, getGrouping, type Grouping } from "./groupings";
import { updatePositions, animateTo, fadeOutRegions, fadeInRegions, snapNodePositions, nodeEls, worldEl, type NodePositionWithRegion } from "./dom";
import type { Camera } from "./camera";

let currentLayoutGrouping: Grouping | undefined = groupings[0];
let currentColorGrouping: Grouping | undefined = groupings[0];
let graphRef: Graph;
let cameraRef: Camera;

export function initGroupingState(graph: Graph, camera: Camera): void {
  if (groupings.length === 0) return;
  graphRef = graph;
  cameraRef = camera;
}

export function getCurrentLayoutGrouping(): Grouping | undefined {
  return currentLayoutGrouping;
}

export function getCurrentColorGrouping(): Grouping | undefined {
  return currentColorGrouping;
}

/** Return the region color for a tag in the current color grouping, or undefined. */
export function getTagColor(tag: string): string | undefined {
  const regions = currentColorGrouping?.regions ?? [];
  return regions.find((r) => r.id.split("/")[1] === tag)?.color;
}

let onGroupingChangeFn: (() => void) | null = null;
export function setOnGroupingChange(fn: () => void): void {
  onGroupingChangeFn = fn;
}

/** Restore all nodes to the current grouping's rest positions (used instead of resetLayout when a grouping is active). */
export function resetToCurrentGrouping(graph: Graph): void {
  if (!currentLayoutGrouping) {
    for (const node of graph.nodes) { node.x = node.baseX; node.y = node.baseY; }
    return;
  }
  for (const node of graph.nodes) {
    const pos = currentLayoutGrouping.positions[node.id];
    if (pos) { node.x = pos.x; node.y = pos.y; }
  }
}

/** Compute node positions with regionId(s) for a given grouping. */
function computePositionsForGrouping(grouping: Grouping): NodePositionWithRegion[] {
  return graphRef.nodes
    .filter((n) => !n.tags.includes("meta"))
    .flatMap((n) => {
      const pos = grouping.positions[n.id];
      if (!pos) return [];
      return [{ nodeId: n.id, x: pos.x, y: pos.y, regionId: pos.regionId, regionIds: pos.regionIds }];
    });
}

export function getGroupings(): Grouping[] {
  return groupings;
}

/** Set layout grouping (positions + regions). If colors were linked, they follow. */
export function setLayoutGrouping(groupingId: string, updateColors = true): void {
  const grouping = getGrouping(groupingId);
  if (!grouping || !currentLayoutGrouping || grouping.id === currentLayoutGrouping.id) return;

  const wasLinked = currentLayoutGrouping?.id === currentColorGrouping?.id;

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
  worldEl.dataset.grouping = grouping.id;

  // If colors were linked to layout, keep them linked
  if (wasLinked && updateColors) {
    currentColorGrouping = grouping;
  }

  applyGroupingPositions();
  updateUrl();
  onGroupingChangeFn?.();
}

/** Set color grouping only (no position/region changes). */
export function setColorGrouping(groupingId: string): void {
  const grouping = getGrouping(groupingId);
  if (!grouping || !currentColorGrouping || grouping.id === currentColorGrouping.id) return;

  currentColorGrouping = grouping;
  applyGroupingColors();
  updateUrl();
  onGroupingChangeFn?.();
}

function updateUrl(): void {
  if (!currentLayoutGrouping || !currentColorGrouping || !groupings[0]) return;

  const params = new URLSearchParams(location.search);

  // Layout param
  if (currentLayoutGrouping.id === groupings[0].id) {
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
  if (!currentColorGrouping) return;
  for (const node of graphRef.nodes) {
    const el = nodeEls.get(node.id);
    if (!el) continue;

    const override = currentColorGrouping.positions[node.id];
    const color = override?.color ?? node.color;
    el.style.setProperty("--color", color);
  }
}

let animationGeneration = 0;

function applyGroupingPositions(animate = true): void {
  if (!currentLayoutGrouping) return;
  const generation = ++animationGeneration;
  const targets = new Map<string, { x: number; y: number }>();

  for (const node of graphRef.nodes) {
    const pos = currentLayoutGrouping.positions[node.id];
    if (pos) targets.set(node.id, { x: pos.x, y: pos.y });
  }

  // Apply colors from color grouping
  applyGroupingColors();

  if (!animate) {
    // Snap immediately — move nodes then snap DOM anchors (transitions already suppressed by caller)
    for (const node of graphRef.nodes) {
      const target = targets.get(node.id);
      if (target) { node.x = target.x; node.y = target.y; }
    }
    snapNodePositions(graphRef);
    updatePositions(graphRef); // Also redraw edges to match new positions
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
    if (generation !== animationGeneration) return; // cancelled by newer animation
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
    } else {
      // Snap DOM anchors so baseX/baseY tracks the grouping position.
      // Force a style flush between setting data-no-transition and changing
      // translate — without it the CSS transition fires during the snap.
      worldEl.dataset.noTransition = "";
      void worldEl.offsetWidth; // flush pending style recalc
      snapNodePositions(graphRef);
      requestAnimationFrame(() => delete worldEl.dataset.noTransition);
    }
  }

  requestAnimationFrame(step);
}

/** Restore grouping from URL on page load */
export function restoreGroupingFromUrl(): void {
  if (groupings.length === 0) return;

  const params = new URLSearchParams(location.search);
  const layoutId = params.get("grouping");
  const colorId = params.get("colors");

  // Restore layout grouping
  if (layoutId) {
    const layoutGrouping = getGrouping(layoutId);
    if (layoutGrouping && groupings[0] && layoutGrouping.id !== groupings[0].id) {
      currentLayoutGrouping = layoutGrouping;
    }
  }

  if (currentLayoutGrouping) worldEl.dataset.grouping = currentLayoutGrouping.id;

  // Always fade in regions for the active grouping on load (no animation)
  if (currentLayoutGrouping) {
    const positions = computePositionsForGrouping(currentLayoutGrouping);
    fadeInRegions(currentLayoutGrouping.regions, positions, 0);
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
  if (currentColorGrouping && currentLayoutGrouping && currentColorGrouping.id !== currentLayoutGrouping.id) {
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
  if (groupings.length === 0) return;

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
    if (grouping.id === currentLayoutGrouping?.id) {
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
    if (grouping.id === currentColorGrouping?.id) {
      colorBtn.dataset.active = "";
    }

    layoutBtn.addEventListener("click", () => {
      // Update layout active state
      for (const b of wrapper.querySelectorAll<HTMLElement>(".grouping-layout")) {
        delete b.dataset.active;
      }
      layoutBtn.dataset.active = "";

      // If colors were linked (same as old layout), update color active state too
      const wasLinked = currentLayoutGrouping?.id === currentColorGrouping?.id;
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
