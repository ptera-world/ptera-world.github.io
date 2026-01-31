import type { Camera } from "./camera";
import { updateTransform } from "./dom";
import { parseMarkdown } from "./markdown";

let panel: HTMLElement;
let panelTitle: HTMLElement;
let panelBody: HTMLElement;
let divider: HTMLElement;
let cam: Camera;

let currentNodeId: string | null = null;
const contentCache = new Map<string, string>();

export function initPanel(camera: Camera): void {
  cam = camera;
  panel = document.getElementById("panel")!;
  panelTitle = document.getElementById("panel-title")!;
  panelBody = document.getElementById("panel-body")!;
  divider = document.getElementById("panel-divider")!;

  // Close button
  document.getElementById("panel-close")!.addEventListener("click", closePanel);

  // Divider drag
  let dragging = false;
  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const newWidth = Math.max(240, Math.min(window.innerWidth * 0.6, window.innerWidth - e.clientX));
    panel.style.width = `${newWidth}px`;
    updateTransform(cam);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  // Crosslink interception
  panelBody.addEventListener("click", (e) => {
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
  currentNodeId = nodeId;
  panel.hidden = false;

  if (nodeLabel) {
    panelTitle.textContent = nodeLabel;
  }

  const cached = contentCache.get(nodeId);
  if (cached !== undefined) {
    panelBody.innerHTML = cached;
    updateTransform(cam);
    return;
  }

  panelBody.innerHTML = "<p style=\"color:#666\">Loading…</p>";
  updateTransform(cam);

  fetch(`/content/${nodeId}.md`)
    .then((res) => {
      if (!res.ok) throw new Error("not found");
      return res.text();
    })
    .then((md) => {
      const html = parseMarkdown(md);
      contentCache.set(nodeId, html);
      if (currentNodeId === nodeId) {
        panelBody.innerHTML = html;
      }
    })
    .catch(() => {
      const fallback = "<p style=\"color:#666\">No detailed page available yet.</p>";
      contentCache.set(nodeId, fallback);
      if (currentNodeId === nodeId) {
        panelBody.innerHTML = fallback;
      }
    });
}

export function closePanel(): void {
  panel.hidden = true;
  currentNodeId = null;
  updateTransform(cam);
}

export function isPanelOpen(): boolean {
  return !panel.hidden;
}
