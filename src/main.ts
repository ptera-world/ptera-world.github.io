import { createCamera } from "./camera";
import { createGraph } from "./graph";
import { buildWorld, updateTransform, setFilterRef, updatePositions, animateTo, worldEl, setOnTierChange, landingEl, nudges } from "./dom";
import { setupInput } from "./input";
import { initPanel, openPanel, fetchContent, panelState, restorePanel, type PanelState } from "./panel";
import { showCard, hideCard, getCurrentCardNode, setCardToggleFilter, setCardIsTagActive, setCardGetTagColor } from "./card";
import { createFilter, buildFilterUI, applyFilter, getVisibleIds, setActive, updateFilterPillColors } from "./filter";
import { runLayout } from "./layout";
import { createFocusLayout } from "./focus-layout";
import { loadSettingsFromUrl } from "./settings";
import { createMinimap } from "./minimap";
import { initGroupingState, buildGroupingUI, restoreGroupingFromUrl, getTagColor, setOnGroupingChange, resetToCurrentGrouping } from "./grouping-state";
import { siteConfig, getActiveCollection, siteUrl, type CollectionConfig } from "./site-config";
import { groupings } from "./groupings";
import type { GraphData, Node as GraphNode } from "./graph";
import { getSettings } from "./settings";
import { life, signal, onFrame, animating } from "./life";

/**
 * The page is replaced while it stays open when a deploy changes a file it reads. This module is
 * imported again under a new URL, a fresh copy of the whole page script, which loads the deploy's
 * data and page while the running copy keeps going, then stops it, puts the deploy's page body in
 * place and mounts there, continuing from what the stopped copy carried.
 */

/** UI state a stopped copy hands to its replacement. Every field may be missing. */
interface Carried {
  camera?: { x: number; y: number; zoom: number };
  /**
   * Each node's position without the landing nudge (the replacement redoes that for its own
   * landing), and the rest position it was laid out from.
   */
  positions?: [id: string, x: number, y: number, restX: number, restY: number][];
  panel?: PanelState;
  card?: string | null;
  /** The element with keyboard focus: by id, by the graph node it belongs to, or by its path from the nearest element with an id. */
  focus?: { id?: string; node?: string; within?: string; path?: number[]; sig?: string };
  /** A deploy heard while being replaced, for the replacement to act on. */
  deploy?: string | null;
}
interface Page {
  /** Resolves once nothing is mid-interaction or animating; stop() right after it loses nothing. */
  idle?(): Promise<void>;
  /** Release every listener, loop and timer; the caller replaces the page body. */
  stop(): Carried;
}
const PAGE = Symbol.for("pteraworld.graph.page");
const g = globalThis as { [PAGE]?: Page };
const previous = g[PAGE];

loadSettingsFromUrl();
const collectionId = getActiveCollection();
const dataUrl = siteUrl(`${collectionId === "default" ? "" : `/${collectionId}`}/graph.json`);

// Listening starts before loading, so a deploy that lands while this copy loads or replaces another
// is acted on once it has mounted.
const script = new URL(import.meta.url).pathname;
const pagePath = location.pathname;
const reads = (k: string): boolean =>
  k === script || k === dataUrl || k === siteUrl("/headings.json") || k === pagePath || k === `${pagePath}/` || k.startsWith(siteUrl("/content/"));
/** The newest deploy heard and not yet acted on. */
let heard: string | null = null;
let mounted = false;
let pressed = 0;
const capture = { capture: true, signal };
addEventListener("pointerdown", () => { pressed++; }, capture);
addEventListener("pointerup", () => { pressed = Math.max(0, pressed - 1); }, capture);
addEventListener("pointercancel", () => { pressed = Math.max(0, pressed - 1); }, capture);
addEventListener("blur", () => { pressed = 0; }, { signal });
addEventListener("deploy", (e) => {
  const { version, changed } = (e as CustomEvent<{ version: string; changed: string[] }>).detail;
  if (!changed.some(reads)) return;
  e.preventDefault();
  heard = version;
  if (mounted) void replace();
}, { signal });

let data: GraphData;
let carried: Carried | undefined;
try {
  const dataRes = await fetch(dataUrl);
  if (!dataRes.ok) throw new Error(`graph.json: ${dataRes.status}`);
  data = (await dataRes.json()) as GraphData;
  if (previous) {
    const pageRes = await fetch(location.href);
    if (!pageRes.ok) throw new Error(`${location.pathname}: ${pageRes.status}`);
    const next = new DOMParser().parseFromString(await pageRes.text(), "text/html");
    const focus = new URLSearchParams(location.search).get("focus");
    // a focused node's card or panel shows its content; fragments have neither
    if (data.nodes.some((n) => n.id === focus && !n.tags.includes("fragment"))) await fetchContent(focus!);
    await previous.idle?.();
    carried = previous.stop();
    heard ??= carried.deploy ?? null;
    document.title = next.title;
    document.body.replaceWith(next.body);
  }
} catch (e) {
  life.abort();
  throw e;
}
const positions = carried?.positions;
groupings.push(...data.groupings);
const camera = createCamera();
const graph = createGraph(data);

// Center camera on the active collection's meta node
const collectionMeta: CollectionConfig = siteConfig.collections[collectionId];
const metaNode = graph.nodes.find((n) => n.id === collectionMeta.metaNodeId);
if (metaNode) { camera.x = metaNode.x; camera.y = metaNode.y; }

buildWorld(graph);
// Disable transitions during initial setup
worldEl.dataset.noTransition = "";

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
window.addEventListener("resize", () => updateTransform(camera), { signal });
const neighborhoodEnabled = collectionMeta.neighborhoodFocus ?? getSettings().neighborhoodFocus;
const focusLayout = createFocusLayout(graph, collectionMeta.metaNodeId, neighborhoodEnabled);
setOnTierChange((tier) => focusLayout.onTierChange(tier));
const input = setupInput(document.getElementById("viewport")!, camera, graph, {
  onFocusChange: (node) => focusLayout.onFocusChange(node),
});
initPanel(camera, graph);

// where a fresh load has the nodes when it nudges them
const beforeNudge = new Map(graph.nodes.map((n) => [n.id, [n.x, n.y] as const]));
const focusId = new URLSearchParams(location.search).get("focus");
const focusNode = focusId ? graph.nodes.find((n) => n.id === focusId) : undefined;
if (!carried) {
  // snap without animation on page load
  if (focusNode) {
    input.navigateTo(focusNode, false, false);
    if (!focusNode.tags.includes("fragment")) {
      openPanel(focusNode.id, focusNode.label, false);
    }
  }
} else {
  if (positions) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const [id, x, y, restX, restY] of positions) {
      const node = byId.get(id);
      if (!node) continue;
      const same = node.baseX === restX && node.baseY === restY;
      node.x = same ? x : node.baseX + (x - restX);
      node.y = same ? y : node.baseY + (y - restY);
    }
    updatePositions(graph);
  }
  if (focusNode) {
    input.restoreFocus(focusNode);
    focusLayout.onFocusChange(focusNode, !!positions);
  }
  if (carried.camera) {
    camera.x = carried.camera.x;
    camera.y = carried.camera.y;
    camera.zoom = carried.camera.zoom;
  }
  updateTransform(camera);
  if (carried.panel) restorePanel(carried.panel);
  const cardNode = carried.card ? graph.nodes.find((n) => n.id === carried.card) : undefined;
  if (cardNode && !carried.panel?.open) showCard(cardNode, graph);
  if (carried.focus) focusTarget(carried.focus)?.focus({ preventScroll: true });
}

// Apply settings-driven attributes
const settings = getSettings();
if (settings.textOnCanvas) worldEl.dataset.textOnCanvas = "";
if (!settings.edgesVisible) worldEl.dataset.edgesHidden = "";
if (!settings.nodeGrowth) worldEl.dataset.noGrowth = "";

// Nudge nodes that overlap the landing element after fonts are ready.
// Keep noTransition active until this completes to prevent visible animation.
document.fonts.ready.then(() => {
  if (signal.aborted) return;
  // World-space bounds from layout, not from the screen, so the camera can't change the result
  const style = getComputedStyle(landingEl);
  const shift = new DOMMatrix(style.transform);
  const w = parseFloat(style.width);
  const h = parseFloat(style.height);
  const lCx = landingEl.offsetLeft + shift.e + w / 2;
  const lCy = landingEl.offsetTop + shift.f + h / 2;
  const halfW = w / 2 + 20; // 20px padding
  const halfH = h / 2 + 20;

  let nudged = false;
  for (const node of graph.nodes) {
    if (node.tags.includes("meta")) continue;
    const [x, y] = (positions ? beforeNudge.get(node.id) : undefined) ?? [node.x, node.y];
    const dx = x - lCx;
    const dy = y - lCy;
    if (Math.abs(dx) < halfW + node.radius && Math.abs(dy) < halfH + node.radius) {
      // Push radially outward from landing center
      const dist = Math.hypot(dx, dy) || 1;
      const pushDist = Math.hypot(halfW + node.radius, halfH + node.radius) - dist + 5;
      if (pushDist > 0) {
        const from: [number, number] = [node.x, node.y];
        node.x += (dx / dist) * pushDist;
        node.y += (dy / dist) * pushDist;
        nudges.set(node.id, { from, to: [node.x, node.y] });
        nudged = true;
      }
    }
  }
  if (nudged) updatePositions(graph);
  // Double-rAF: first rAF ensures the browser commits the nudged positions,
  // second rAF fires after paint — safe to re-enable transitions.
  onFrame(() => {
    onFrame(() => {
      delete worldEl.dataset.noTransition;
    });
  });
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
}, { signal });

g[PAGE] = {
  async idle() {
    while (pressed || input.overlayOpen() || animating() || cssAnimating()) {
      await new Promise((r) => requestAnimationFrame(r));
    }
  },
  stop() {
    const state: Carried = {
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
      positions: graph.nodes.map((n) => [n.id, ...withoutNudge(n), n.baseX, n.baseY]),
      panel: panelState(),
      card: getCurrentCardNode()?.id ?? null,
      focus: focusOf(document.activeElement),
      deploy: heard,
    };
    life.abort();
    return state;
  },
};
mounted = true;
if (heard) void replace();

function cssAnimating(): boolean {
  return document.getAnimations().some((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity);
}

let replacing = false;
/** Import this script again under the newest deploy heard, until one copy replaces this one. */
async function replace(): Promise<void> {
  if (replacing) return;
  replacing = true;
  try {
    while (heard && !signal.aborted) {
      const next = new URL(import.meta.url);
      next.search = `?v=${encodeURIComponent(heard)}`;
      heard = null;
      try {
        await import(/* @vite-ignore */ next.href);
      } catch (e) {
        console.error("[graph] couldn't replace the page script", e);
      }
    }
  } finally {
    replacing = false;
  }
}

/** A node's position minus the landing nudge it still includes; exact while it hasn't moved since. */
function withoutNudge(n: GraphNode): [number, number] {
  const nudge = nudges.get(n.id);
  if (!nudge) return [n.x, n.y];
  if (n.x === nudge.to[0] && n.y === nudge.to[1]) return nudge.from;
  return [n.x - (nudge.to[0] - nudge.from[0]), n.y - (nudge.to[1] - nudge.from[1])];
}

/** Identifies an element so the same control can be found in a rebuilt page. */
function focusOf(el: Element | null): Carried["focus"] {
  if (!el || el === document.body) return undefined;
  if (el.id) return { id: el.id };
  const node = el.closest<HTMLElement>(".node[data-id]")?.dataset.id;
  if (node) return { node };
  const path: number[] = [];
  let e = el;
  for (; !e.id && e.parentElement; e = e.parentElement) path.unshift([...e.parentElement.children].indexOf(e));
  return e.id ? { within: e.id, path, sig: signature(el) } : undefined;
}

function focusTarget(f: NonNullable<Carried["focus"]>): HTMLElement | null {
  if (f.id) return document.getElementById(f.id);
  if (f.node) return document.querySelector<HTMLElement>(`.node[data-id="${CSS.escape(f.node)}"] .node-hit`);
  let e: Element | null | undefined = f.within ? document.getElementById(f.within) : null;
  for (const i of f.path ?? []) e = e?.children[i];
  return e instanceof HTMLElement && signature(e) === f.sig ? e : null;
}

function signature(el: Element): string {
  return [el.tagName, el.textContent, el.getAttribute("title"), el.getAttribute("aria-label")].join("\0");
}
