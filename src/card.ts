import type { Graph, Node } from "./graph";
import { openPanel, fetchContent, contentCache } from "./panel";
import { siteUrl } from "./site-config";

let navigateFn: ((node: Node, graph: Graph) => void) | null = null;
let toggleFilterFn: ((tag: string) => void) | null = null;
let isTagActiveFn: ((tag: string) => boolean) | null = null;
let getTagColorFn: ((tag: string) => string | undefined) | null = null;
let currentCardNode: Node | null = null;

export function setCardNavigate(fn: (node: Node, graph: Graph) => void): void {
  navigateFn = fn;
}
export function setCardToggleFilter(fn: (tag: string) => void): void {
  toggleFilterFn = fn;
}
export function setCardIsTagActive(fn: (tag: string) => boolean): void {
  isTagActiveFn = fn;
}
export function setCardGetTagColor(fn: (tag: string) => string | undefined): void {
  getTagColorFn = fn;
}
export function getCurrentCardNode(): Node | null {
  return currentCardNode;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function setSummary(descEl: HTMLElement, html: string): void {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const firstP = tmp.querySelector("p");
  if (firstP && firstP.textContent && !firstP.style.color) {
    descEl.innerHTML = firstP.innerHTML;
  }
}

function refEntry(other: Node, graph: Graph): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "card-ref";
  a.href = siteUrl(`/${other.id}`);
  const strong = el("strong", undefined, other.label);
  a.appendChild(strong);
  a.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (navigateFn) navigateFn(other, graph);
  });
  return a;
}

function refGroup(heading: string, entries: HTMLAnchorElement[]): HTMLDivElement {
  const group = el("div", "card-ref-group");
  group.appendChild(el("span", "card-ref-heading", heading));
  for (const entry of entries) group.appendChild(entry);
  return group;
}

function buildCard(node: Node, graph: Graph): DocumentFragment {
  const frag = document.createDocumentFragment();

  // Header
  const header = el("div", "card-header");
  header.appendChild(el("h2", "card-title", node.label));
  const close = el("button", "card-close", "\u00d7");
  close.ariaLabel = "Close";
  close.addEventListener("click", hideCard);
  header.appendChild(close);
  frag.appendChild(header);

  // Description - show first paragraph from content, fall back to short desc
  const desc = el("p", "card-desc");
  if (node.description) {
    const parts = node.description.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) desc.appendChild(document.createElement("br"));
      desc.appendChild(document.createTextNode(parts[i]!));
    }
  }
  frag.appendChild(desc);

  // Intercept cross-node links in card description (same as panel)
  desc.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const anchor = (e.target as HTMLElement).closest?.("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    if (/^\/[a-z][\w-]*(\/[a-z][\w-]*)*$/.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      openPanel(href.slice(1));
    }
  });

  const cached = contentCache.get(node.id);
  if (cached) {
    setSummary(desc, cached);
  } else {
    fetchContent(node.id).then((html) => setSummary(desc, html));
  }

  // URL
  if (node.url) {
    const a = el("a", "card-link");
    a.href = node.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = node.url;
    frag.appendChild(a);
  }

  // Cross-references (non-containment edges)
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const related = graph.edges
    .filter((e) => {
      const toNode = nodeMap.get(e.to);
      if (toNode?.parent === e.from) return false;
      return e.from === node.id || e.to === node.id;
    })
    .map((e) => {
      const otherId = e.from === node.id ? e.to : e.from;
      const other = nodeMap.get(otherId);
      return other ? refEntry(other, graph) : null;
    })
    .filter((e): e is HTMLAnchorElement => e !== null);

  if (related.length) {
    const refs = el("div", "card-refs");
    refs.appendChild(refGroup("Related", related));
    frag.appendChild(refs);
  }

  // Tags
  const visibleTags = node.tags.filter((t) => t !== "code" && t !== "region" && t !== "meta");
  if (visibleTags.length > 0 && toggleFilterFn) {
    const tagsEl = el("div", "card-tags");
    for (const tag of visibleTags) {
      const btn = el("button", "card-tag", tag);
      const color = getTagColorFn?.(tag);
      if (color) btn.style.setProperty("--tc", color);
      if (isTagActiveFn?.(tag)) btn.dataset.active = "";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFilterFn!(tag);
      });
      tagsEl.appendChild(btn);
    }
    frag.appendChild(tagsEl);
  }

  // Learn more link
  const learnMore = document.createElement("a");
  learnMore.className = "card-learn-more";
  learnMore.href = siteUrl(`/${node.id}`);
  learnMore.textContent = "Learn more \u2192";
  learnMore.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    openPanel(node.id, node.label);
  });
  frag.appendChild(learnMore);

  return frag;
}

export function showCard(node: Node, graph: Graph): void {
  const card = document.getElementById("card");
  if (!card) return;
  currentCardNode = node;
  card.replaceChildren(buildCard(node, graph));
  card.setAttribute("aria-label", node.label);
  const coreR = node.radius;
  const below = node.tags.includes("meta") || window.matchMedia("(max-width: 640px)").matches;
  if (below) {
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y + coreR + 12}px`;
  } else {
    card.style.left = `${node.x + coreR + 12}px`;
    card.style.top = `${node.y}px`;
  }
  card.hidden = false;
}

export function hideCard(): void {
  const card = document.getElementById("card");
  if (!card) return;
  currentCardNode = null;
  card.hidden = true;
  card.replaceChildren();
}

export function isCardOpen(): boolean {
  const card = document.getElementById("card");
  return card ? !card.hidden : false;
}
