import type { Camera } from "./camera";
import type { Graph, Node } from "./graph";
import { updateTransform, setFocus, getHitNode, animateTo } from "./dom";
import { showCard, hideCard, isCardOpen, setCardNavigate } from "./card";
import { isPanelOpen, closePanel, openPanel } from "./panel";
import { initSearch, openSearch, closeSearch, isSearchOpen } from "./search";

export interface InputHandle {
  navigateTo(node: Node, push?: boolean): void;
}

export function setupInput(
  viewport: HTMLElement,
  camera: Camera,
  graph: Graph,
): InputHandle {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let focusedNode: Node | null = null;

  // --- Navigation helpers ---

  function navigateTo(node: Node, push = true): void {
    focusedNode = node;
    setFocus(graph, node);
    if (isPanelOpen()) {
      openPanel(node.id, node.label);
    } else {
      showCard(node, graph);
    }
    animateTo(camera, node.x, node.y, 3);
    if (push) {
      history.pushState({ focus: node.id }, "", `?focus=${node.id}`);
    }
  }

  function clearFocus(push = true): void {
    focusedNode = null;
    setFocus(graph, null);
    hideCard();
    if (push) {
      history.pushState(null, "", location.pathname);
    }
  }

  // --- Card cross-link navigation ---

  setCardNavigate((node) => navigateTo(node));

  // --- Mouse ---

  viewport.addEventListener("mousedown", (e) => {
    dragging = true;
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
  });

  viewport.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (dx * dx + dy * dy > 16 * 16) viewport.classList.add("dragging");
    camera.x -= (e.clientX - lastX) / camera.zoom;
    camera.y -= (e.clientY - lastY) / camera.zoom;
    lastX = e.clientX;
    lastY = e.clientY;
    updateTransform(camera);
  });

  viewport.addEventListener("mouseup", () => {
    dragging = false;
    viewport.classList.remove("dragging");
  });

  viewport.addEventListener("mouseleave", () => {
    dragging = false;
    viewport.classList.remove("dragging");
    setFocus(graph, focusedNode);
  });

  // Hover
  viewport.addEventListener("mouseover", (e) => {
    if (dragging) return;
    const node = getHitNode(e.target);
    if (node) setFocus(graph, node);
  });

  viewport.addEventListener("mouseout", (e) => {
    if (dragging) return;
    const from = (e.target as HTMLElement).closest?.(".node-hit");
    const to = (e.relatedTarget as HTMLElement | null)?.closest?.(".node-hit");
    if (from && from !== to && !to) {
      setFocus(graph, focusedNode);
    }
  });

  // Click - only act if the mouse didn't drag
  viewport.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest?.("#card")) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (dx * dx + dy * dy > 16 * 16) return;
    const node = getHitNode(e.target);
    if (node) {
      if (e.ctrlKey || e.metaKey) {
        window.open(`/${node.id}`, "_blank");
        return;
      }
      navigateTo(node);
    } else if (isPanelOpen()) {
      closePanel();
    } else if (isCardOpen()) {
      hideCard();
    } else {
      clearFocus();
    }
  });

  // Double-click: zoom to fit ecosystem
  viewport.addEventListener("dblclick", (e) => {
    const node = getHitNode(e.target);
    if (!node) return;
    const eco = node.tier === "ecosystem"
      ? node
      : graph.nodes.find(n => n.id === node.parent);
    if (eco) {
      let maxDist = eco.radius;
      for (const n of graph.nodes) {
        if (n.parent !== eco.id) continue;
        const dx = n.x - eco.x;
        const dy = n.y - eco.y;
        maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy) + n.radius);
      }
      const fit = Math.min(
        Math.min(viewport.clientWidth, viewport.clientHeight) / (2 * maxDist * 1.3),
        2.5,
      );
      animateTo(camera, eco.x, eco.y, fit);
    } else {
      animateTo(camera, node.x, node.y, 3);
    }
  });

  // Wheel zoom
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const wx = (e.clientX - vw / 2) / camera.zoom + camera.x;
    const wy = (e.clientY - vh / 2) / camera.zoom + camera.y;
    camera.zoom = Math.max(0.3, Math.min(10, camera.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    const nx = vw / 2 + (wx - camera.x) * camera.zoom;
    const ny = vh / 2 + (wy - camera.y) * camera.zoom;
    camera.x += (nx - e.clientX) / camera.zoom;
    camera.y += (ny - e.clientY) / camera.zoom;
    updateTransform(camera);
  }, { passive: false });

  // --- Keyboard ---

  document.addEventListener("keydown", (e) => {
    // Escape: close the topmost overlay
    if (e.key === "Escape") {
      if (isSearchOpen()) { closeSearch(); return; }
      if (isPanelOpen()) { closePanel(); return; }
      if (isCardOpen()) { hideCard(); return; }
      if (focusedNode) { clearFocus(); return; }
      return;
    }

    // Don't handle other keys when typing in an input
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    // Search
    if (e.key === "/" || (e.key === "k" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      openSearch();
      return;
    }

    // Arrow key traversal between connected nodes
    const dir = arrowDir(e.key);
    if (dir && focusedNode) {
      e.preventDefault();
      const next = bestNeighbor(focusedNode, dir, graph);
      if (next) navigateTo(next);
    }
  });

  // --- History (popstate) ---

  window.addEventListener("popstate", (e) => {
    const id = (e.state as { focus?: string } | null)?.focus
      ?? new URLSearchParams(location.search).get("focus");
    if (id) {
      const node = graph.nodes.find(n => n.id === id);
      if (node) navigateTo(node, false);
    } else {
      clearFocus(false);
    }
  });

  // --- Touch ---

  let lastTouchDist = 0;
  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      dragging = true;
      lastX = e.touches[0]!.clientX;
      lastY = e.touches[0]!.clientY;
    } else if (e.touches.length === 2) {
      lastTouchDist = touchDist(e);
    }
  });

  viewport.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
      camera.x -= (e.touches[0]!.clientX - lastX) / camera.zoom;
      camera.y -= (e.touches[0]!.clientY - lastY) / camera.zoom;
      lastX = e.touches[0]!.clientX;
      lastY = e.touches[0]!.clientY;
      updateTransform(camera);
    } else if (e.touches.length === 2) {
      const dist = touchDist(e);
      camera.zoom = Math.max(0.3, Math.min(10, camera.zoom * dist / lastTouchDist));
      lastTouchDist = dist;
      updateTransform(camera);
    }
  }, { passive: false });

  viewport.addEventListener("touchend", () => { dragging = false; });

  // --- Search init ---

  initSearch(graph.nodes, (node) => navigateTo(node));

  return { navigateTo };
}

function arrowDir(key: string): [number, number] | null {
  switch (key) {
    case "ArrowRight": return [1, 0];
    case "ArrowLeft": return [-1, 0];
    case "ArrowUp": return [0, -1];
    case "ArrowDown": return [0, 1];
    default: return null;
  }
}

function bestNeighbor(from: Node, dir: [number, number], graph: Graph): Node | null {
  const candidates = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === from.id) candidates.add(edge.to);
    if (edge.to === from.id) candidates.add(edge.from);
  }

  let best: Node | null = null;
  let bestScore = 0.2; // minimum cosine threshold

  for (const id of candidates) {
    const node = graph.nodes.find(n => n.id === id);
    if (!node) continue;
    const dx = node.x - from.x;
    const dy = node.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;
    const cos = (dx * dir[0] + dy * dir[1]) / dist;
    if (cos > bestScore) {
      bestScore = cos;
      best = node;
    }
  }

  return best;
}

function touchDist(e: TouchEvent): number {
  const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
  const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
