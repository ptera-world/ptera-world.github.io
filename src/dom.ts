import type { Camera } from "./camera";
import { currentTier } from "./camera";
import type { Graph, Node } from "./graph";
import type { FilterState } from "./filter";

const viewport = document.getElementById("viewport")!;
const world = document.getElementById("world")!;

interface EdgeRef {
  el: HTMLElement;
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

  // Edges (behind nodes)
  for (const edge of graph.edges) {
    const from = graph.nodes.find(n => n.id === edge.from);
    const to = graph.nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    const el = document.createElement("div");
    el.className = "edge";
    if (to.parent === edge.from) el.dataset.type = "containment";
    el.dataset.from = from.id;
    el.dataset.to = to.id;
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    el.style.width = `${len}px`;
    el.style.transform = `rotate(${angle}rad)`;
    world.appendChild(el);

    edgeRefs.push({ el, from: from.id, to: to.id, labelEl: null });
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
      desc.textContent = node.description;
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
    for (const el of nodeEls.values()) el.classList.remove("focused");
    for (const ref of edgeRefs) {
      ref.el.classList.remove("focused");
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

  for (const [id, el] of nodeEls) {
    el.classList.toggle("focused", focused.has(id));
  }
  for (const ref of edgeRefs) {
    const f = ref.el.dataset.type !== "containment" && focused.has(ref.from) && focused.has(ref.to);
    ref.el.classList.toggle("focused", f);
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
        const fromVisible = !fromEl?.dataset.filtered || fromEl.dataset.filtered === "surfaced";
        const toVisible = !toEl?.dataset.filtered || toEl.dataset.filtered === "surfaced";
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
