import type { Camera } from "./camera";
import { currentTier } from "./camera";
import type { Graph, Node } from "./graph";
import { updateTransform, setFocus, getHitNode, animateTo, nodeEls } from "./dom";
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
    menu: "node",
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
  confirm: {
    label: "Open card / panel",
    category: "Navigation",
    keys: ["Enter"],
    menu: "node",
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

  function preserveParams(setFocusId?: string): string {
    const params = new URLSearchParams(location.search);
    if (setFocusId) {
      params.set("focus", setFocusId);
    } else {
      params.delete("focus");
    }
    const qs = params.toString();
    return qs ? `?${qs}` : location.pathname;
  }

  function navigateTo(node: Node, push = true): void {
    focusedNode = node;
    setFocus(graph, node, true);
    if (isPanelOpen()) {
      openPanel(node.id, node.label);
    } else {
      showCard(node, graph);
    }
    animateTo(camera, node.x, node.y, Math.max(camera.zoom, 1.5));
    if (push) {
      history.pushState({ focus: node.id }, "", preserveParams(node.id));
    }
  }

  function clearFocus(push = true): void {
    focusedNode = null;
    setFocus(graph, null);
    hideCard();
    if (push) {
      history.pushState(null, "", preserveParams());
    }
  }

  function arrowNav(dir: [number, number]): void {
    if (!focusedNode) {
      // Pick the nearest visible node to the camera center
      const nearest = nearestToCamera(graph, camera);
      if (nearest) navigateTo(nearest);
      return;
    }
    const next = bestNeighbor(focusedNode, dir, graph, camera);
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
    confirm: () => {
      if (!focusedNode) return;
      if (isPanelOpen()) return; // no-op when panel already open
      if (isCardOpen()) {
        openPanel(focusedNode.id, focusedNode.label);
      } else {
        showCard(focusedNode, graph);
      }
    },
  };

  const commands = fromBindings(schema, handlers, {
    "nav-right": { when: (ctx) => !!ctx.hasFocus },
    "nav-left": { when: (ctx) => !!ctx.hasFocus },
    "nav-up": { when: (ctx) => !!ctx.hasFocus },
    "nav-down": { when: (ctx) => !!ctx.hasFocus },
    confirm: { when: (ctx) => !!ctx.hasFocus },
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

  function getContext() {
    return {
      hasFocus: !!focusedNode,
      panelOpen: isPanelOpen(),
      cardOpen: isCardOpen(),
    };
  }

  keybinds(commands, getContext);

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

  // --- WASD smooth panning ---

  const PAN_SPEED = 600; // world-units per second at zoom=1
  const heldKeys = new Set<string>();
  let panRAF = 0;
  let lastPanTime = 0;

  function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if ((el as HTMLElement).isContentEditable) return true;
    // palette open = typing in search
    if (paletteEl?.hasAttribute("open")) return true;
    return false;
  }

  function panLoop(now: number): void {
    if (heldKeys.size === 0) { panRAF = 0; return; }
    const dt = lastPanTime ? (now - lastPanTime) / 1000 : 0;
    lastPanTime = now;
    let dx = 0, dy = 0;
    if (heldKeys.has("w")) dy -= 1;
    if (heldKeys.has("s")) dy += 1;
    if (heldKeys.has("a")) dx -= 1;
    if (heldKeys.has("d")) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const move = PAN_SPEED * dt / camera.zoom;
      camera.x += dx * move;
      camera.y += dy * move;
      updateTransform(camera);
    }
    panRAF = requestAnimationFrame(panLoop);
  }

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (!"wasd".includes(key)) return;
    if (isInputFocused()) return;
    if (heldKeys.has(key)) return; // key repeat
    heldKeys.add(key);
    if (!panRAF) {
      lastPanTime = 0;
      panRAF = requestAnimationFrame(panLoop);
    }
  });

  window.addEventListener("keyup", (e) => {
    heldKeys.delete(e.key.toLowerCase());
  });

  window.addEventListener("blur", () => {
    heldKeys.clear();
  });

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

  // --- Context menu ---

  const contextMenuCommands: Command[] = [
    {
      id: "open-panel",
      label: "Open details",
      menu: "node",
      when: (ctx) => !!ctx.hasFocus,
      execute: () => {
        if (focusedNode) openPanel(focusedNode.id, focusedNode.label);
      },
    },
    {
      id: "open-new-tab",
      label: "Open in new tab",
      menu: "node",
      when: (ctx) => !!ctx.hasFocus,
      execute: () => {
        if (focusedNode) window.open(`/${focusedNode.id}`, "_blank");
      },
    },
  ];
  allCommands.push(...contextMenuCommands);

  const ctxMenu = document.createElement("context-menu") as import("keybinds").ContextMenu;
  ctxMenu.setAttribute("auto-trigger", "");
  ctxMenu.setAttribute("target", "#viewport");
  ctxMenu.menu = "node";
  ctxMenu.commands = allCommands;
  ctxMenu.context = {};
  document.body.appendChild(ctxMenu);

  // Before the component handles contextmenu, focus the right-clicked node
  // without panning (panning would move the node away from the cursor)
  viewport.addEventListener("contextmenu", (e) => {
    const node = getHitNode(e.target);
    if (node) {
      focusedNode = node;
      setFocus(graph, node, true);
    }
    ctxMenu.context = getContext();
  }, { capture: true });

  return { navigateTo, commands: allCommands };
}

function bestNeighbor(from: Node, dir: [number, number], graph: Graph, camera: Camera): Node | null {
  // Phase 1: edge-connected neighbors (cosine threshold 0.2)
  const candidates = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === from.id) candidates.add(edge.to);
    if (edge.to === from.id) candidates.add(edge.from);
  }

  let best: Node | null = null;
  let bestScore = 0.2;

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

  if (best) return best;

  // Phase 2: spatial fallback — all visible nodes
  const tier = currentTier(camera);
  let bestSpatial: Node | null = null;
  let bestSpatialScore = 0;

  for (const node of graph.nodes) {
    if (node.id === from.id) continue;
    // Tier visibility filter
    if (tier === "far" && node.tier !== "ecosystem") continue;
    if (tier !== "far" && node.tier === "ecosystem") continue;
    // Respect active filters
    const el = nodeEls.get(node.id);
    if (el?.dataset.filtered === "hidden") continue;

    const dx = node.x - from.x;
    const dy = node.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;
    const cos = (dx * dir[0] + dy * dir[1]) / dist;
    if (cos <= 0.5) continue; // ~60° cone
    const score = cos / dist;
    if (score > bestSpatialScore) {
      bestSpatialScore = score;
      bestSpatial = node;
    }
  }

  return bestSpatial;
}

function nearestToCamera(graph: Graph, camera: Camera): Node | null {
  const tier = currentTier(camera);
  let best: Node | null = null;
  let bestDist = Infinity;
  for (const node of graph.nodes) {
    if (tier === "far" && node.tier !== "ecosystem") continue;
    if (tier !== "far" && node.tier === "ecosystem") continue;
    const el = nodeEls.get(node.id);
    if (el?.dataset.filtered === "hidden") continue;
    const dx = node.x - camera.x;
    const dy = node.y - camera.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
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
