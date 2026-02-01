import type { Graph, Node } from "./graph";
import { nodeEls } from "./dom";

export interface FilterState {
  active: Set<string>;
  available: string[];
}

export function createFilter(nodes: Node[]): FilterState {
  const tagSet = new Set<string>();
  for (const node of nodes) {
    for (const tag of node.tags) {
      if (tag !== "ecosystem") tagSet.add(tag);
    }
  }
  const available = [...tagSet].sort();
  return { active: new Set<string>(), available };
}

export function toggleTag(filter: FilterState, tag: string): void {
  if (filter.active.has(tag)) {
    filter.active.delete(tag);
  } else {
    filter.active.add(tag);
  }
}

/** Return the set of node IDs that pass the current filter. */
export function getVisibleIds(filter: FilterState, graph: Graph): Set<string> {
  const filtering = filter.active.size > 0;
  const visible = new Set<string>();
  for (const node of graph.nodes) {
    if (node.tags.includes("ecosystem")) continue;
    const passes = !filtering || node.tags.some((t) => filter.active.has(t));
    if (passes) visible.add(node.id);
  }
  for (const node of graph.nodes) {
    if (!node.tags.includes("ecosystem")) continue;
    if (!filtering) {
      visible.add(node.id);
    } else {
      const hasChild = graph.nodes.some(n => n.parent === node.id && visible.has(n.id));
      if (hasChild) visible.add(node.id);
    }
  }
  return visible;
}

export function applyFilter(filter: FilterState, graph: Graph): void {
  const world = document.getElementById("world")!;

  // Signal filtering state for landing fade
  if (filter.active.size > 0) {
    world.dataset.filtering = "";
  } else {
    delete world.dataset.filtering;
  }

  const visible = getVisibleIds(filter, graph);

  const filtering = filter.active.size > 0;

  // Compute filter strength for non-visible project nodes
  const structural = new Set(["project", "ecosystem"]);
  const filterStrength = new Map<string, number>();

  if (filtering) {
    for (const node of graph.nodes) {
      if (visible.has(node.id) || node.tags.includes("ecosystem")) continue;

      let maxStr = 0;
      const nodeTags = new Set(node.tags.filter((t) => !structural.has(t)));

      // Edge strength to any visible node
      for (const edge of graph.edges) {
        if (edge.from === node.id && visible.has(edge.to)) maxStr = Math.max(maxStr, edge.strength);
        if (edge.to === node.id && visible.has(edge.from)) maxStr = Math.max(maxStr, edge.strength);
      }

      // Tag similarity to visible nodes
      for (const vId of visible) {
        const vNode = graph.nodes.find((n) => n.id === vId);
        if (!vNode || vNode.tags.includes("ecosystem")) continue;
        const vTags = new Set(vNode.tags.filter((t) => !structural.has(t)));
        let shared = 0;
        for (const t of nodeTags) if (vTags.has(t)) shared++;
        const union = new Set([...nodeTags, ...vTags]).size;
        if (union > 0) maxStr = Math.max(maxStr, shared / union);
      }

      if (maxStr > 0) filterStrength.set(node.id, maxStr);
    }
  }

  // Apply to DOM nodes
  for (const node of graph.nodes) {
    const el = nodeEls.get(node.id);
    if (!el) continue;

    if (node.tags.includes("ecosystem")) {
      // Ecosystem opacity scales with proportion of visible children
      if (!filtering) {
        delete el.dataset.filtered;
        el.style.removeProperty("--eco-filter-opacity");
      } else if (!visible.has(node.id)) {
        el.dataset.filtered = "hidden";
        el.style.removeProperty("--eco-filter-opacity");
      } else {
        delete el.dataset.filtered;
        const children = graph.nodes.filter((n) => n.parent === node.id);
        const visibleCount = children.filter((n) => visible.has(n.id)).length;
        const ratio = children.length > 0 ? visibleCount / children.length : 1;
        if (ratio < 1) {
          el.style.setProperty("--eco-filter-opacity", `${0.25 + 0.75 * ratio}`);
        } else {
          el.style.removeProperty("--eco-filter-opacity");
        }
      }
    } else if (visible.has(node.id)) {
      delete el.dataset.filtered;
      el.style.removeProperty("--filter-strength");
    } else if (filterStrength.has(node.id)) {
      el.dataset.filtered = "adjacent";
      el.style.setProperty("--filter-strength", `${filterStrength.get(node.id)}`);
    } else {
      el.dataset.filtered = "hidden";
      el.style.removeProperty("--filter-strength");
    }
  }

  // Apply to DOM edges
  const nodeStr = (id: string) => visible.has(id) ? 1 : (filterStrength.get(id) ?? 0);
  const edges = document.querySelectorAll<SVGPathElement>(".edge[data-from]");
  for (const el of edges) {
    const from = el.dataset.from!;
    const to = el.dataset.to!;
    const fromStr = nodeStr(from);
    const toStr = nodeStr(to);
    if (fromStr > 0 && toStr > 0) {
      if (fromStr < 1 || toStr < 1) {
        el.dataset.filtered = "adjacent";
        el.style.setProperty("--filter-strength", `${Math.min(fromStr, toStr)}`);
      } else {
        delete el.dataset.filtered;
        el.style.removeProperty("--filter-strength");
      }
    } else {
      el.dataset.filtered = "hidden";
      el.style.removeProperty("--filter-strength");
    }
  }
}

export function buildFilterUI(
  container: HTMLElement,
  filter: FilterState,
  onToggle: () => void,
): void {
  for (const tag of filter.available) {
    const pill = document.createElement("button");
    pill.className = "filter-pill";
    pill.textContent = tag;
    pill.dataset.tag = tag;

    pill.addEventListener("click", () => {
      toggleTag(filter, tag);
      if (filter.active.has(tag)) {
        pill.dataset.active = "";
      } else {
        delete pill.dataset.active;
      }
      onToggle();
    });

    container.appendChild(pill);
  }
}
