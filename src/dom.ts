import type { Camera } from "./camera";
import { currentTier } from "./camera";
import type { Graph, Node } from "./graph";
import type { FilterState } from "./filter";

const viewport = document.getElementById("viewport")!;
const world = document.getElementById("world")!;

interface EdgeRef {
  el: SVGPathElement;
  from: string;
  to: string;
  labelEl: HTMLElement | null;
}

export const nodeEls = new Map<string, HTMLElement>();
const hitNodes = new Map<HTMLElement, Node>();
const edgeRefs: EdgeRef[] = [];
let landingEl: HTMLElement;

let filterRef: FilterState | null = null;
const surfacedNodes = new Set<string>();

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
    `<div class="landing-trail">this is a map of things i've been exploring.</div>`;
  world.appendChild(landingEl);

  // Edges (behind nodes) — SVG lines for CSS-transitionable coordinates
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "edge-layer";
  world.appendChild(svg);

  for (const edge of graph.edges) {
    const from = graph.nodes.find(n => n.id === edge.from);
    const to = graph.nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("edge");
    if (to.parent === edge.from) path.dataset.type = "containment";
    path.dataset.from = from.id;
    path.dataset.to = to.id;
    path.style.setProperty("d", `path("M ${from.x} ${from.y} L ${to.x} ${to.y}")`);
    svg.appendChild(path);

    edgeRefs.push({ el: path, from: from.id, to: to.id, labelEl: null });
  }

  // Nodes
  for (const node of graph.nodes) {
    const el = document.createElement("div");
    el.className = `node ${node.tier}`;
    el.dataset.id = node.id;
    if (node.tags.includes("essay")) el.dataset.kind = "essay";
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.setProperty("--color", node.color);

    if (node.tier === "ecosystem") {
      el.style.setProperty("--r", `${node.radius * 0.15}px`);
      el.style.setProperty("--glow-r", `${node.radius}px`);
      const core = document.createElement("div");
      core.className = "node-core node-hit";
      el.appendChild(core);
      hitNodes.set(core, node);
    } else {
      el.style.setProperty("--r", `${node.radius}px`);
      const dot = document.createElement("div");
      dot.className = "node-dot node-hit";
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
    world.appendChild(el);
    nodeEls.set(node.id, el);
  }
}

export function updateTransform(camera: Camera): void {
  const tx = viewport.clientWidth / 2 - camera.x * camera.zoom;
  const ty = viewport.clientHeight / 2 - camera.y * camera.zoom;
  world.style.transform = `translate(${tx}px, ${ty}px) scale(${camera.zoom})`;
  world.style.setProperty("--zoom", `${camera.zoom}`);
  world.dataset.tier = currentTier(camera);
  const landingOpacity = Math.max(0, Math.min(1, (3.0 - camera.zoom) / 1.5));
  landingEl.style.opacity = `${landingOpacity}`;
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

export function setFocus(graph: Graph, hovered: Node | null): void {
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
    delete world.dataset.hovering;
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

  world.dataset.hovering = "";

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
  const structural = new Set(["project", "ecosystem"]);
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
    const from = nodeMap.get(ref.from);
    const to = nodeMap.get(ref.to);
    if (!from || !to) continue;

    ref.el.style.setProperty("d", `path("M ${from.x} ${from.y} L ${to.x} ${to.y}")`);
  }
}
