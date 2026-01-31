import type { Graph, Node } from "./graph";
import { openPanel, fetchContent, contentCache } from "./panel";

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

function refEntry(other: Node, label?: string): HTMLDivElement {
  const div = el("div", "card-ref");
  const strong = el("strong", undefined, other.label);
  div.appendChild(strong);
  if (label && label !== "uses") {
    const span = el("span", "card-ref-label", label);
    div.append(" ", span);
  }
  return div;
}

function refGroup(heading: string, entries: HTMLDivElement[]): HTMLDivElement {
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

  // Description — show first paragraph from content, fall back to short desc
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

  // Cross-references
  const outgoing = graph.edges
    .filter(e => e.label && e.from === node.id)
    .map(e => {
      const other = graph.nodes.find(n => n.id === e.to);
      return other ? refEntry(other, e.label) : null;
    })
    .filter((e): e is HTMLDivElement => e !== null);

  const incoming = graph.edges
    .filter(e => e.label && e.to === node.id)
    .map(e => {
      const other = graph.nodes.find(n => n.id === e.from);
      return other ? refEntry(other, e.label) : null;
    })
    .filter((e): e is HTMLDivElement => e !== null);

  if (outgoing.length || incoming.length) {
    const refs = el("div", "card-refs");
    if (outgoing.length) refs.appendChild(refGroup("Uses", outgoing));
    if (incoming.length) refs.appendChild(refGroup("Used by", incoming));
    frag.appendChild(refs);
  }

  // Learn more button
  const learnMore = el("button", "card-learn-more", "Learn more \u2192");
  learnMore.addEventListener("click", (e) => {
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
