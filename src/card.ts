import type { Graph, Node } from "./graph";

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

  // Description
  frag.appendChild(el("p", "card-desc", node.description));

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

  return frag;
}

export function showCard(node: Node, graph: Graph, cx: number, cy: number): void {
  const card = document.getElementById("card");
  if (!card) return;
  card.replaceChildren(buildCard(node, graph));
  card.hidden = false;
  // Position near click point, clamped to viewport
  const rect = card.getBoundingClientRect();
  const left = Math.max(12, Math.min(cx + 16, window.innerWidth - rect.width - 12));
  const top = Math.max(12, Math.min(cy - rect.height / 2, window.innerHeight - rect.height - 12));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
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
