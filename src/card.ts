import type { Graph, Node } from "./graph";

export function showCard(node: Node, graph: Graph): void {
  const el = document.getElementById("card");
  if (!el) return;
  el.innerHTML = renderCard(node, graph);
  el.hidden = false;
  el.querySelector(".card-close")?.addEventListener("click", hideCard);
}

export function hideCard(): void {
  const el = document.getElementById("card");
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}

export function isCardOpen(): boolean {
  const el = document.getElementById("card");
  return el ? !el.hidden : false;
}

function refEntry(other: Node, label?: string): string {
  const tag = label && label !== "uses"
    ? ` <span class="card-ref-label">${label}</span>`
    : "";
  return `<div class="card-ref"><strong>${other.label}</strong>${tag}</div>`;
}

function renderCard(node: Node, graph: Graph): string {
  const outgoing = graph.edges
    .filter(e => e.label && e.from === node.id)
    .map(e => {
      const other = graph.nodes.find(n => n.id === e.to);
      return other ? refEntry(other, e.label) : "";
    })
    .filter(Boolean).join("");

  const incoming = graph.edges
    .filter(e => e.label && e.to === node.id)
    .map(e => {
      const other = graph.nodes.find(n => n.id === e.from);
      return other ? refEntry(other, e.label) : "";
    })
    .filter(Boolean).join("");

  let refsHtml = "";
  if (outgoing || incoming) {
    refsHtml = '<div class="card-refs">';
    if (outgoing) refsHtml += `<div class="card-ref-group"><span class="card-ref-heading">Uses</span>${outgoing}</div>`;
    if (incoming) refsHtml += `<div class="card-ref-group"><span class="card-ref-heading">Used by</span>${incoming}</div>`;
    refsHtml += "</div>";
  }

  const url = node.url
    ? `<a class="card-link" href="${node.url}" target="_blank" rel="noopener">${node.url}</a>`
    : "";

  return `
    <div class="card-header">
      <h2 class="card-title">${node.label}</h2>
      <button class="card-close" aria-label="Close">&times;</button>
    </div>
    <p class="card-desc">${node.description}</p>
    ${url}
    ${refsHtml}
  `;
}
