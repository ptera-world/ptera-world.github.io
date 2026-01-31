import type { Graph, Node } from "./graph";
import { openPanel, fetchContent, contentCache } from "./panel";

let navigateFn: ((node: Node, graph: Graph) => void) | null = null;

export function setCardNavigate(fn: (node: Node, graph: Graph) => void): void {
  navigateFn = fn;
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
  a.href = `/${other.id}`;
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
  const desc = el("p", "card-desc", node.description);
  frag.appendChild(desc);

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

  // Learn more link
  const learnMore = document.createElement("a");
  learnMore.className = "card-learn-more";
  learnMore.href = `/${node.id}`;
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
  card.replaceChildren(buildCard(node, graph));
  const coreR = node.tier === "ecosystem" ? node.radius * 0.15 : node.radius;
  const vertical = window.matchMedia("(max-width: 640px)").matches;
  if (vertical) {
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
  card.hidden = true;
  card.replaceChildren();
}

export function isCardOpen(): boolean {
  const card = document.getElementById("card");
  return card ? !card.hidden : false;
}
