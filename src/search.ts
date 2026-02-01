import type { Node } from "./graph";

let overlay: HTMLElement;
let input: HTMLInputElement;
let list: HTMLElement;
let nodes: Node[] = [];
let filtered: Node[] = [];
let selectedIdx = 0;
let selectCb: ((node: Node) => void) | null = null;

export function initSearch(allNodes: Node[], onSelect: (node: Node) => void): void {
  nodes = [...allNodes].sort((a, b) => a.label.localeCompare(b.label));
  selectCb = onSelect;

  overlay = document.createElement("div");
  overlay.id = "search-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.id = "search-box";

  input = document.createElement("input");
  input.id = "search-input";
  input.type = "text";
  input.placeholder = "Jump to node\u2026";

  list = document.createElement("div");
  list.id = "search-list";

  box.appendChild(input);
  box.appendChild(list);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  input.addEventListener("input", updateList);

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectedIdx < Math.min(filtered.length, 20) - 1) {
        selectedIdx++;
        highlight();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (selectedIdx > 0) {
        selectedIdx--;
        highlight();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const node = filtered[selectedIdx];
      if (node) pick(node);
    }
  });

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeSearch();
  });
}

function updateList(): void {
  const q = input.value.toLowerCase().trim();
  filtered = q
    ? nodes.filter((n) => n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))
    : nodes;
  selectedIdx = 0;
  renderList();
}

function renderList(): void {
  list.replaceChildren();
  const count = Math.min(filtered.length, 20);
  for (let i = 0; i < count; i++) {
    const node = filtered[i]!;
    const item = document.createElement("div");
    item.className = "search-item";
    if (i === selectedIdx) item.classList.add("selected");

    const label = document.createElement("span");
    label.className = "search-item-label";
    label.textContent = node.label;
    item.appendChild(label);

    const desc = document.createElement("span");
    desc.className = "search-item-desc";
    desc.textContent = node.description.split("\n")[0]!;
    item.appendChild(desc);

    item.addEventListener("click", () => pick(node));
    list.appendChild(item);
  }
}

function highlight(): void {
  const items = list.children;
  for (let i = 0; i < items.length; i++) {
    items[i]!.classList.toggle("selected", i === selectedIdx);
  }
  const sel = list.children[selectedIdx] as HTMLElement | undefined;
  sel?.scrollIntoView({ block: "nearest" });
}

function pick(node: Node): void {
  closeSearch();
  if (selectCb) selectCb(node);
}

export function openSearch(): void {
  overlay.hidden = false;
  filtered = nodes;
  selectedIdx = 0;
  input.value = "";
  renderList();
  input.focus();
}

export function closeSearch(): void {
  overlay.hidden = true;
  input.blur();
}

export function isSearchOpen(): boolean {
  return !overlay.hidden;
}
