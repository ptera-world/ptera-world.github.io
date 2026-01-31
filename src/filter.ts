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
  return { active: new Set(available), available };
}

export function toggleTag(filter: FilterState, tag: string): void {
  if (filter.active.has(tag)) {
    filter.active.delete(tag);
  } else {
    filter.active.add(tag);
  }
}

export function applyFilter(filter: FilterState, graph: Graph): void {
  // Determine which nodes pass the filter
  const visible = new Set<string>();
  for (const node of graph.nodes) {
    if (node.tags.includes("ecosystem")) {
      visible.add(node.id);
      continue;
    }
    const passes = node.tags.some((t) => filter.active.has(t));
    if (passes) visible.add(node.id);
  }

  // Apply to DOM nodes
  for (const node of graph.nodes) {
    const el = nodeEls.get(node.id);
    if (!el) continue;
    if (node.tags.includes("ecosystem")) {
      delete el.dataset.filtered;
    } else if (visible.has(node.id)) {
      delete el.dataset.filtered;
    } else {
      el.dataset.filtered = "hidden";
    }
  }

  // Apply to DOM edges - hide only when BOTH endpoints are filtered out
  const edges = document.querySelectorAll<HTMLElement>(".edge[data-from]");
  for (const el of edges) {
    const from = el.dataset.from!;
    const to = el.dataset.to!;
    if (!visible.has(from) && !visible.has(to)) {
      el.dataset.filtered = "hidden";
    } else {
      delete el.dataset.filtered;
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
    pill.dataset.active = "";

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
