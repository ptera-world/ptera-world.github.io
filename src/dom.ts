import type { Camera } from "./camera";
import { currentTier } from "./camera";
import type { Graph, Node } from "./graph";
import type { FilterState } from "./filter";
import { updateMinimap } from "./minimap";

const viewport = document.getElementById("viewport")!;
export const worldEl = document.getElementById("world")!;

interface EdgeRef {
  el: SVGPathElement;
  from: string;
  to: string;
  labelEl: HTMLElement | null;
  isContainment?: boolean;
}

export const nodeEls = new Map<string, HTMLElement>();
const hitNodes = new Map<HTMLElement, Node>();
const edgeRefs: EdgeRef[] = [];
const containmentEdgeRefs: EdgeRef[] = []; // Dynamic containment edges for current grouping
export let landingEl: HTMLElement;
const regionEls = new Map<string, HTMLElement>();
const regionPositions = new Map<string, { x: number; y: number }>(); // Current region positions for edge updates
let svgLayer: SVGSVGElement;

let filterRef: FilterState | null = null;
const surfacedNodes = new Set<string>();
const liveRegion = document.getElementById("live-region");

function announce(text: string): void {
  if (liveRegion) liveRegion.textContent = text;
}

export function setFilterRef(filter: FilterState): void {
  filterRef = filter;
}

export function buildWorld(graph: Graph): void {
  // Landing intro
  landingEl = document.createElement("div");
  landingEl.className = "landing";
  landingEl.innerHTML =
    `<div class="landing-name">ptera</div>` +
    `<div class="landing-body">i think about how software and people<br>shape each other.</div>` +
    `<div class="landing-trail">this is a map of things i've been exploring.</div>` +
    `<div class="landing-hint">scroll to zoom · click to explore · <kbd>/</kbd> to search</div>`;
  worldEl.appendChild(landingEl);

  // Edges (behind nodes) — SVG lines for CSS-transitionable coordinates
  const SVG_NS = "http://www.w3.org/2000/svg";
  svgLayer = document.createElementNS(SVG_NS, "svg");
  svgLayer.id = "edge-layer";
  worldEl.appendChild(svgLayer);

  for (const edge of graph.edges) {
    const from = graph.nodes.find(n => n.id === edge.from);
    const to = graph.nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    const isContainment = to.parent === edge.from;
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("edge");
    if (isContainment) path.dataset.type = "containment";
    path.dataset.from = from.id;
    path.dataset.to = to.id;
    path.style.setProperty("d", `path("M ${from.x} ${from.y} L ${to.x} ${to.y}")`);
    svgLayer.appendChild(path);

    const ref = { el: path, from: from.id, to: to.id, labelEl: null, isContainment };
    edgeRefs.push(ref);
    if (isContainment) containmentEdgeRefs.push(ref);
  }

  // Nodes
  for (const node of graph.nodes) {
    // Meta nodes (e.g. pteraworld) use the landing element, not a rendered dot
    if (node.tier === "meta") continue;

    const el = document.createElement("div");
    el.className = `node ${node.tier}`;
    el.dataset.id = node.id;
    if (node.tags.includes("essay")) el.dataset.kind = "essay";
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.setProperty("--color", node.color);

    if (node.tier === "region") {
      el.style.setProperty("--r", `${node.radius * 0.15}px`);
      el.style.setProperty("--glow-r", `${node.radius}px`);
      const core = document.createElement("div");
      core.className = "node-core node-hit";
      core.setAttribute("role", "button");
      core.tabIndex = -1;
      core.setAttribute("aria-label", node.label);
      el.appendChild(core);
      hitNodes.set(core, node);
      regionEls.set(node.id, el);
      regionPositions.set(node.id, { x: node.x, y: node.y });
    } else {
      el.style.setProperty("--r", `${node.radius}px`);
      const dot = document.createElement("div");
      dot.className = "node-dot node-hit";
      dot.setAttribute("role", "button");
      dot.tabIndex = -1;
      dot.setAttribute("aria-label", node.label);
      el.appendChild(dot);
      hitNodes.set(dot, node);
    }

    const text = document.createElement("div");
    text.className = "node-text";
    const label = document.createElement("div");
    label.className = "node-label";
    label.textContent = node.label;
    text.appendChild(label);

    if (node.description) {
      const desc = document.createElement("div");
      desc.className = "node-desc";
      const parts = node.description.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) desc.appendChild(document.createElement("br"));
        desc.appendChild(document.createTextNode(parts[i]!));
      }
      text.appendChild(desc);
    }

    el.appendChild(text);
    worldEl.appendChild(el);
    nodeEls.set(node.id, el);
  }
}

export function updateTransform(camera: Camera): void {
  const tx = viewport.clientWidth / 2 - camera.x * camera.zoom;
  const ty = viewport.clientHeight / 2 - camera.y * camera.zoom;
  worldEl.style.transform = `translate(${tx}px, ${ty}px) scale(${camera.zoom})`;
  worldEl.style.setProperty("--zoom", `${camera.zoom}`);
  worldEl.dataset.tier = currentTier(camera);
  const landingOpacity = Math.max(0, Math.min(1, (3.0 - camera.zoom) / 1.5));
  landingEl.style.opacity = `${landingOpacity}`;
  updateMinimap(camera);
}

/**
 * JS-driven camera animation — can't be replaced by a CSS transition on
 * #world's transform because updateTransform() also interpolates --zoom
 * (used for inverse-scale on cards/landing), data-tier (visibility), and
 * landing opacity each frame.  A CSS transition would snap those instantly.
 */
export function animateTo(camera: Camera, tx: number, ty: number, tz: number): void {
  const sx = camera.x, sy = camera.y, sz = camera.zoom;
  const start = performance.now();
  function step(now: number) {
    const t = Math.min(1, (now - start) / 300);
    const ease = t * (2 - t);
    camera.x = sx + (tx - sx) * ease;
    camera.y = sy + (ty - sy) * ease;
    camera.zoom = sz + (tz - sz) * ease;
    updateTransform(camera);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function setFocus(graph: Graph, hovered: Node | null, announceNav = false): void {
  // Restore any previously surfaced nodes
  for (const id of surfacedNodes) {
    const el = nodeEls.get(id);
    if (el) el.dataset.filtered = "hidden";
  }
  for (const ref of edgeRefs) {
    if (ref.el.dataset.filtered === "surfaced") {
      ref.el.dataset.filtered = "hidden";
    }
  }
  surfacedNodes.clear();

  if (!hovered) {
    delete worldEl.dataset.hovering;
    for (const el of nodeEls.values()) {
      el.classList.remove("focused");
      el.style.removeProperty("--fs");
    }
    for (const ref of edgeRefs) {
      ref.el.classList.remove("focused");
      ref.el.style.removeProperty("--es");
      ref.labelEl?.classList.remove("focused");
    }
    return;
  }

  worldEl.dataset.hovering = "";

  if (announceNav) {
    announce(`Focused on ${hovered.label}`);
    // Focus the hit element for screen readers
    const hitEl = nodeEls.get(hovered.id)?.querySelector<HTMLElement>(".node-hit");
    if (hitEl) hitEl.focus({ preventScroll: true });
  }

  const focused = new Set<string>();
  focused.add(hovered.id);
  if (hovered.parent) focused.add(hovered.parent);
  for (const node of graph.nodes) {
    if (node.parent === hovered.id) focused.add(node.id);
  }
  for (const edge of graph.edges) {
    if (edge.from === hovered.id) focused.add(edge.to);
    if (edge.to === hovered.id) focused.add(edge.from);
  }

  // Build tag set for hovered node (exclude structural tags)
  const structural = new Set(["project", "region"]);
  const hoveredNode = graph.nodes.find((n) => n.id === hovered.id)!;
  const hoveredTags = new Set(hoveredNode.tags.filter((t) => !structural.has(t)));

  // Compute per-node strength
  const nodeStrength = new Map<string, number>();
  nodeStrength.set(hovered.id, 1.0);

  for (const id of focused) {
    if (id === hovered.id) continue;
    // Edge strength: find the edge connecting this node to hovered
    let edgeStr = 0;
    for (const edge of graph.edges) {
      if ((edge.from === hovered.id && edge.to === id) || (edge.to === hovered.id && edge.from === id)) {
        edgeStr = Math.max(edgeStr, edge.strength);
      }
    }
    // Tag similarity (Jaccard)
    const node = graph.nodes.find((n) => n.id === id);
    let tagSim = 0;
    if (node) {
      const nodeTags = new Set(node.tags.filter((t) => !structural.has(t)));
      if (hoveredTags.size > 0 || nodeTags.size > 0) {
        let shared = 0;
        for (const t of nodeTags) if (hoveredTags.has(t)) shared++;
        const union = new Set([...hoveredTags, ...nodeTags]).size;
        tagSim = union > 0 ? shared / union : 0;
      }
    }
    nodeStrength.set(id, Math.max(edgeStr, tagSim));
  }

  // Build edge strength map (edge from→to key to strength)
  const edgeStrengthMap = new Map<string, number>();
  for (const edge of graph.edges) {
    edgeStrengthMap.set(`${edge.from}|${edge.to}`, edge.strength);
  }

  for (const [id, el] of nodeEls) {
    const isFocused = focused.has(id);
    el.classList.toggle("focused", isFocused);
    if (isFocused) {
      el.style.setProperty("--fs", `${nodeStrength.get(id) ?? 0}`);
    } else {
      el.style.removeProperty("--fs");
    }
  }
  for (const ref of edgeRefs) {
    const f = ref.el.dataset.type !== "containment" && focused.has(ref.from) && focused.has(ref.to);
    ref.el.classList.toggle("focused", f);
    if (f) {
      const es = edgeStrengthMap.get(`${ref.from}|${ref.to}`) ?? edgeStrengthMap.get(`${ref.to}|${ref.from}`) ?? 0.5;
      ref.el.style.setProperty("--es", `${es}`);
    } else {
      ref.el.style.removeProperty("--es");
    }
  }

  // Surface filtered-out nodes that are connected to the hovered node
  if (filterRef) {
    for (const id of focused) {
      const el = nodeEls.get(id);
      if (el && el.dataset.filtered === "hidden") {
        el.dataset.filtered = "surfaced";
        surfacedNodes.add(id);
      }
    }
    for (const ref of edgeRefs) {
      if (ref.el.dataset.filtered === "hidden") {
        const fromEl = nodeEls.get(ref.from);
        const toEl = nodeEls.get(ref.to);
        const fv = fromEl?.dataset.filtered;
        const fromVisible = !fv || fv === "surfaced" || fv === "adjacent";
        const tv = toEl?.dataset.filtered;
        const toVisible = !tv || tv === "surfaced" || tv === "adjacent";
        if (fromVisible && toVisible && focused.has(ref.from) && focused.has(ref.to)) {
          ref.el.dataset.filtered = "surfaced";
        }
      }
    }
  }
}

export function getHitNode(target: EventTarget | null): Node | null {
  const hitEl = (target as HTMLElement)?.closest?.(".node-hit");
  return hitEl ? hitNodes.get(hitEl as HTMLElement) ?? null : null;
}

/** Apply current node.x/y positions to DOM via compositor-friendly properties. */
export function updatePositions(graph: Graph): void {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const node of graph.nodes) {
    const el = nodeEls.get(node.id);
    if (!el) continue;
    const dx = node.x - node.baseX;
    const dy = node.y - node.baseY;
    el.style.translate = dx === 0 && dy === 0 ? "" : `${dx}px ${dy}px`;
  }

  for (const ref of edgeRefs) {
    // For containment edges, 'from' might be a region (not in nodeMap)
    const fromNode = nodeMap.get(ref.from);
    const fromRegion = regionPositions.get(ref.from);
    const toNode = nodeMap.get(ref.to);

    const fromPos = fromNode ?? fromRegion;
    const toPos = toNode;
    if (!fromPos || !toPos) continue;

    ref.el.style.setProperty("d", `path("M ${fromPos.x} ${fromPos.y} L ${toPos.x} ${toPos.y}")`);
  }
}

export interface RegionDef {
  id: string;
  label: string;
  description: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

function createRegionElement(region: RegionDef): HTMLElement {
  const el = document.createElement("div");
  el.className = "node region";
  el.dataset.id = region.id;
  el.style.left = `${region.x}px`;
  el.style.top = `${region.y}px`;
  el.style.setProperty("--color", region.color);
  el.style.setProperty("--r", `${region.radius * 0.15}px`);
  el.style.setProperty("--glow-r", `${region.radius}px`);

  const core = document.createElement("div");
  core.className = "node-core node-hit";
  core.setAttribute("role", "button");
  core.tabIndex = -1;
  core.setAttribute("aria-label", region.label);
  el.appendChild(core);

  const text = document.createElement("div");
  text.className = "node-text";
  const label = document.createElement("div");
  label.className = "node-label";
  label.textContent = region.label;
  text.appendChild(label);

  if (region.description) {
    const desc = document.createElement("div");
    desc.className = "node-desc";
    desc.textContent = region.description;
    text.appendChild(desc);
  }

  el.appendChild(text);
  return el;
}

/** Fade out and remove current region elements and their containment edges. */
export function fadeOutRegions(duration = 300): void {
  // Capture elements to remove NOW, before new ones are added
  const elementsToRemove = Array.from(regionEls.values());
  const edgesToRemove = [...containmentEdgeRefs];

  // Clear immediately so new ones can be added
  regionEls.clear();
  regionPositions.clear();
  containmentEdgeRefs.length = 0;

  // Fade out regions
  for (const el of elementsToRemove) {
    el.style.transition = `opacity ${duration}ms ease-out`;
    el.style.opacity = "0";
  }

  // Fade out containment edges
  for (const ref of edgesToRemove) {
    ref.el.style.transition = `opacity ${duration}ms ease-out`;
    ref.el.style.opacity = "0";
  }

  // Remove elements after animation completes
  setTimeout(() => {
    for (const el of elementsToRemove) {
      el.remove();
    }
    for (const ref of edgesToRemove) {
      ref.el.remove();
      // Remove from edgeRefs too
      const idx = edgeRefs.indexOf(ref);
      if (idx !== -1) edgeRefs.splice(idx, 1);
    }
  }, duration);
}

export interface NodePositionWithRegion {
  nodeId: string;
  x: number;
  y: number;
  regionId?: string;
}

/** Create and fade in new region elements with containment edges. */
export function fadeInRegions(
  regions: RegionDef[],
  positions: NodePositionWithRegion[],
  duration = 300
): void {
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Create region elements and store positions
  for (const region of regions) {
    const el = createRegionElement(region);
    el.style.opacity = "0";
    el.style.transition = `opacity ${duration}ms ease-in`;
    worldEl.appendChild(el);
    regionEls.set(region.id, el);
    regionPositions.set(region.id, { x: region.x, y: region.y });

    // Trigger reflow then fade in
    void el.offsetWidth;
    el.style.opacity = "1";
  }

  // Create containment edges from regions to nodes
  const regionMap = new Map(regions.map(r => [r.id, r]));
  for (const pos of positions) {
    if (!pos.regionId) continue;
    const region = regionMap.get(pos.regionId);
    if (!region) continue;

    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("edge");
    path.dataset.type = "containment";
    path.dataset.from = region.id;
    path.dataset.to = pos.nodeId;
    path.style.setProperty("d", `path("M ${region.x} ${region.y} L ${pos.x} ${pos.y}")`);
    path.style.opacity = "0";
    path.style.transition = `opacity ${duration}ms ease-in`;
    svgLayer.appendChild(path);

    const ref: EdgeRef = { el: path, from: region.id, to: pos.nodeId, labelEl: null, isContainment: true };
    edgeRefs.push(ref);
    containmentEdgeRefs.push(ref);

    // Trigger reflow then fade in
    void path.getBBox();
    path.style.opacity = "";
  }
}

/** Register a region element created during initial buildWorld. */
export function registerRegion(id: string, el: HTMLElement): void {
  regionEls.set(id, el);
}

/** Get a region element by ID for hit detection. */
export function getRegionHitNode(target: EventTarget | null, regions: RegionDef[]): RegionDef | null {
  const hitEl = (target as HTMLElement)?.closest?.(".node.region");
  if (!hitEl) return null;
  const id = (hitEl as HTMLElement).dataset.id;
  return regions.find(r => r.id === id) ?? null;
}
