import type { Camera } from "./camera";
import type { Graph, Node } from "./graph";
import { updateTransform, setFocus, animateTo } from "./dom";
import { hideCard } from "./card";
import { parseMarkdown } from "./markdown";

let panel: HTMLElement;
let panelTitle: HTMLElement;
let panelBody: HTMLElement;
let panelOpen: HTMLAnchorElement;
let divider: HTMLElement;
let cam: Camera;
let graphRef: Graph;

let currentNodeId: string | null = null;
export const contentCache = new Map<string, string>();

const FALLBACK = "<p style=\"color:#666\">No detailed page available yet.</p>";

export function fetchContent(nodeId: string): Promise<string> {
  const cached = contentCache.get(nodeId);
  if (cached !== undefined) return Promise.resolve(cached);

  return fetch(`/content/${nodeId}.md`)
    .then((res) => {
      if (!res.ok) throw new Error("not found");
      return res.text();
    })
    .then((md) => {
      const html = parseMarkdown(md);
      contentCache.set(nodeId, html);
      return html;
    })
    .catch(() => {
      contentCache.set(nodeId, FALLBACK);
      return FALLBACK;
    });
}

export function initPanel(camera: Camera, graph: Graph): void {
  cam = camera;
  graphRef = graph;
  panel = document.getElementById("panel")!;
  panelTitle = document.getElementById("panel-title")!;
  panelBody = document.getElementById("panel-body")!;
  panelOpen = document.getElementById("panel-open") as HTMLAnchorElement;
  divider = document.getElementById("panel-divider")!;

  // Close button
  document.getElementById("panel-close")!.addEventListener("click", closePanel);

  // Divider drag
  const isVertical = () => window.matchMedia("(max-width: 640px)").matches;
  let dragging = false;

  function startDrag(e: Event) {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = isVertical() ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  }

  function onDrag(x: number, y: number) {
    if (!dragging) return;
    if (isVertical()) {
      const h = Math.max(120, Math.min(window.innerHeight * 0.8, window.innerHeight - y));
      panel.style.height = `${h}px`;
    } else {
      const w = Math.max(240, Math.min(window.innerWidth * 0.6, window.innerWidth - x));
      panel.style.width = `${w}px`;
    }
    updateTransform(cam);
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  divider.addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", (e) => onDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", endDrag);

  divider.addEventListener("touchstart", startDrag, { passive: false });
  window.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    if (t) {
      onDrag(t.clientX, t.clientY);
    }
  });
  window.addEventListener("touchend", endDrag);

  // Crosslink interception — defer to native behavior on ctrl/meta+click
  panelBody.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const anchor = (e.target as HTMLElement).closest?.("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (href && /^\/[a-z][\w-]*$/.test(href)) {
      e.preventDefault();
      const targetId = href.slice(1);
      openPanel(targetId);
    }
  });
}

export function openPanel(nodeId: string, nodeLabel?: string): void {
  hideCard();
  currentNodeId = nodeId;
  panel.hidden = false;

  panelTitle.textContent = nodeLabel ?? nodeId;
  panelOpen.href = `/${nodeId}`;

  const node = graphRef.nodes.find(n => n.id === nodeId);
  if (node) {
    setFocus(graphRef, node);
    animateTo(cam, node.x, node.y, Math.max(cam.zoom, 1.5));
  }

  const cached = contentCache.get(nodeId);
  if (cached !== undefined) {
    panelBody.innerHTML = cached;
    updateTransform(cam);
    return;
  }

  panelBody.innerHTML = "<p style=\"color:#666\">Loading\u2026</p>";
  updateTransform(cam);

  fetchContent(nodeId).then((html) => {
    if (currentNodeId === nodeId) {
      panelBody.innerHTML = html;
    }
  });
}

export function closePanel(): void {
  panel.hidden = true;
  currentNodeId = null;
  setFocus(graphRef, null);
  updateTransform(cam);
}

export function isPanelOpen(): boolean {
  return !panel.hidden;
}

export function panelNode(): Node | null {
  if (!currentNodeId || panel.hidden) return null;
  return graphRef.nodes.find(n => n.id === currentNodeId) ?? null;
}
