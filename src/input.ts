import type { Camera } from "./camera";
import type { Graph, Node } from "./graph";
import { updateTransform, setFocus, getHitNode, animateTo } from "./dom";
import { showCard, hideCard, isCardOpen, setCardNavigate } from "./card";
import { isPanelOpen, closePanel, openPanel } from "./panel";

import { keybinds, defineSchema, fromBindings, registerComponents, fuzzyMatcher } from "keybinds";
import type { Command } from "keybinds";

export interface InputHandle {
  navigateTo(node: Node, push?: boolean): void;
  commands: Command[];
}

// --- Keybind schema (data only — no closures) ---

const schema = defineSchema({
  close: {
    label: "Close",
    keys: ["Escape"],
    captureInput: true,
  },
  search: {
    label: "Search nodes",
    category: "Navigation",
    keys: ["/"],
  },
  "nav-right": {
    label: "Navigate right",
    category: "Navigation",
    keys: ["ArrowRight"],
  },
  "nav-left": {
    label: "Navigate left",
    category: "Navigation",
    keys: ["ArrowLeft"],
  },
  "nav-up": {
    label: "Navigate up",
    category: "Navigation",
    keys: ["ArrowUp"],
  },
  "nav-down": {
    label: "Navigate down",
    category: "Navigation",
    keys: ["ArrowDown"],
  },
  "zoom-in": {
    label: "Zoom in",
    category: "View",
    keys: ["="],
  },
  "zoom-out": {
    label: "Zoom out",
    category: "View",
    keys: ["-"],
  },
  "reset-view": {
    label: "Reset view",
    category: "View",
    keys: ["0"],
  },
});

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
  let paletteEl: import("keybinds").CommandPalette;

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

  function arrowNav(dir: [number, number]): void {
    if (!focusedNode) return;
    const next = bestNeighbor(focusedNode, dir, graph);
    if (next) navigateTo(next);
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

  // --- Keybinds (replaces manual keydown handler) ---

  const handlers: Record<string, (ctx: Record<string, unknown>, event?: Event) => unknown> = {
    close: () => {
      if (isPanelOpen()) { closePanel(); return; }
      if (isCardOpen()) { hideCard(); return; }
      if (focusedNode) { clearFocus(); return; }
    },
    search: () => { paletteEl.open = true; },
    "nav-right": () => arrowNav([1, 0]),
    "nav-left": () => arrowNav([-1, 0]),
    "nav-up": () => arrowNav([0, -1]),
    "nav-down": () => arrowNav([0, 1]),
    "zoom-in": () => {
      camera.zoom = Math.min(10, camera.zoom * 1.25);
      updateTransform(camera);
    },
    "zoom-out": () => {
      camera.zoom = Math.max(0.3, camera.zoom / 1.25);
      updateTransform(camera);
    },
    "reset-view": () => animateTo(camera, 0, 0, 1.5),
  };

  const commands = fromBindings(schema, handlers, {
    "nav-right": { when: (ctx) => !!ctx.hasFocus },
    "nav-left": { when: (ctx) => !!ctx.hasFocus },
    "nav-up": { when: (ctx) => !!ctx.hasFocus },
    "nav-down": { when: (ctx) => !!ctx.hasFocus },
  });

  // Node navigation commands (no key binding — palette-only)
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const nodeCommands: Command[] = graph.nodes.map(node => {
    const parent = node.parent ? nodeMap.get(node.parent) : null;
    const category = node.tier === "ecosystem" ? "Ecosystems"
      : node.tags.includes("essay") ? "Essays"
      : parent ? parent.label
      : "Projects";
    return {
      id: `go-to-${node.id}`,
      label: node.label,
      description: node.description.split("\n")[0],
      category,
      execute: () => navigateTo(node),
    };
  });

  keybinds(commands, () => ({
    hasFocus: !!focusedNode,
    panelOpen: isPanelOpen(),
    cardOpen: isCardOpen(),
  }));

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

  const allCommands = [...commands, ...nodeCommands];

  // --- Web components (palette + cheatsheet) ---

  registerComponents();

  // Body text index: label → searchable text (descriptions + section bodies)
  const bodyIndex = new Map<string, string>();
  for (const node of graph.nodes) {
    bodyIndex.set(node.label, node.description);
  }

  const palette = document.createElement("command-palette") as import("keybinds").CommandPalette;
  paletteEl = palette;
  palette.setAttribute("auto-trigger", "");
  palette.setAttribute("placeholder", "Search nodes, essays, commands\u2026");
  palette.commands = allCommands;
  palette.context = {};
  palette.matcher = ((query: string, text: string) => {
    const labelMatch = fuzzyMatcher(query, text);
    const body = bodyIndex.get(text);
    if (body) {
      const bodyMatch = fuzzyMatcher(query, body);
      if (bodyMatch) {
        const bodyScore = bodyMatch.score * 0.7;
        if (!labelMatch || bodyScore > labelMatch.score) {
          return { score: bodyScore };
        }
      }
    }
    return labelMatch;
  }) as import("keybinds").CommandPalette["matcher"];
  document.body.appendChild(palette);

  // Lazy-load heading commands on first palette open
  let headingsLoaded = false;
  async function loadHeadings() {
    if (headingsLoaded) return;
    headingsLoaded = true;
    try {
      const res = await fetch("/headings.json");
      if (!res.ok) return;
      const headings: { nodeId: string; heading: string; slug: string; body: string }[] = await res.json();
      const headingCommands: Command[] = headings.flatMap(h => {
        const node = nodeMap.get(h.nodeId);
        if (!node) return [];
        return [{
          id: `go-to-${h.nodeId}-${h.slug}`,
          label: h.heading,
          category: node.label,
          execute: () => {
            openPanel(h.nodeId, node.label);
            requestAnimationFrame(() => {
              const panelBody = document.getElementById("panel-body");
              const sec = panelBody?.querySelector<HTMLElement>(`#${CSS.escape(h.slug)}`);
              if (sec?.classList.contains("collapsible-section")) {
                sec.classList.add("expanded");
                sec.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            });
          },
        }];
      });
      for (const h of headings) {
        bodyIndex.set(h.heading, h.body);
      }
      allCommands.push(...headingCommands);
      palette.commands = allCommands;
    } catch { /* headings unavailable — degrade gracefully */ }
  }
  new MutationObserver(() => {
    if (palette.hasAttribute("open")) loadHeadings();
  }).observe(palette, { attributes: true, attributeFilter: ["open"] });

  const cheatsheet = document.createElement("keybind-cheatsheet") as import("keybinds").KeybindCheatsheet;
  cheatsheet.setAttribute("auto-trigger", "");
  cheatsheet.commands = commands;
  cheatsheet.context = {};
  document.body.appendChild(cheatsheet);

  return { navigateTo, commands: allCommands };
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
