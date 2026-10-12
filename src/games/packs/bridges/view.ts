import { Event as HookEvent } from "../../core/hooks";
import { defineSchema } from "../../core/schema";
import { bindCommands, bindingsOver, handlersOver, type BindingSchema, type Ids } from "../../core/commands";
import type { View } from "../../core/types";
import { colName, rowName, type Side } from "../../core/names";
import { s, style, inputIs } from "../../core/dom";
import { buttonsSwapped, secondary } from "../../core/gestures";
import { getDeco } from "./deco";
import { DIR_NAMES, graph, type BridgesPuzzle, type BridgesState } from "./graph";
import { bridges, type BridgesAction, type BridgesInteraction, type Focus } from "./logic";



const S = 10;
const R = 3.4;
const GAP = 1.4;

/** Themeable graphics, drawn centerd on the island / mark in board units (a cell is 10 wide). */
export const ASSETS = {
  island: { id: "bridges.island", fallback: `<circle r="${R}"/>` },
  mark: { id: "bridges.mark", fallback: `<path d="M-1 -1L1 1M-1 1L1 -1"/>` },
} as const;

export interface Look {
  asset(id: string, fallback: string): string;
}

/** Player's board-label preference (which edges carry column letters / row numbers). */
export interface BoardPrefs {
  labelSides(): Set<Side>;
}

/** Room for edge labels, in board units. */
const LABEL = 6;
/** How long before the shell's touch hold (board menu) a still touch is abandoned as a move. */
const HOLD_LEAD_MS = 50;

const CSS = `
.bridges-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.bridges-board .dot { fill: var(--border); }
.bridges-board .edge-label { fill: var(--text-dim); font: 3px var(--font); text-anchor: middle; dominant-baseline: central; }
.bridges-board .island .shape { fill: var(--surface-2); stroke: var(--text-dim); stroke-width: 0.5; transition: fill 120ms, stroke 120ms; }
.bridges-board .island text { fill: var(--text); font: 600 4.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.bridges-board .island .badge { fill: var(--warn); font-size: 2.8px; }
.bridges-board .island { transition: opacity 160ms; }
.bridges-board .island.done { opacity: var(--done-opacity); }
.bridges-board .island.error .shape { fill: var(--danger-soft); stroke: var(--danger); }
.bridges-board .island.error { opacity: 1; }
.bridges-board .island.hint { opacity: 1; }
.bridges-board .island.hint .shape { stroke: var(--hint); stroke-width: 1.1; }
.bridges-board .island.from .shape { stroke: var(--accent); stroke-width: 1; }
${Array.from({ length: 8 }, (_, k) => `.bridges-board .island.g${k} .shape { stroke: hsl(${k * 40 + 40} 65% 62%); stroke-width: 1; }`).join("\n")}
.bridges-board .bridge line { stroke: var(--text); stroke-width: 0.55; stroke-linecap: round; }
.bridges-board .bridge.error line, .bridges-board .bridge.wrong line { stroke: var(--danger); }
.bridges-board .guide { stroke: var(--text-dim); stroke-width: 0.3; stroke-dasharray: 0.6 0.9; opacity: 0.6; }
.bridges-board .mark { fill: none; stroke: var(--danger); stroke-width: 0.45; stroke-linecap: round; opacity: 0.85; }
.bridges-board .mark.wrong { stroke: var(--warn); }
.bridges-board .bridge.ghost line { stroke-dasharray: 0.8 0.6; opacity: 0.6; }
.bridges-board .bridge.faded { opacity: 0.3; }
.bridges-board .mark.ghost { opacity: 0.5; }
.bridges-board .focus { stroke: var(--hint-soft); stroke-width: 4.5; stroke-linecap: round; }
.bridges-board .preview { stroke: var(--accent); stroke-width: 0.7; stroke-dasharray: 1 1; }
.bridges-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .bridges-board .cursor { display: none; }
`;

const settings = defineSchema({
  dots: { type: "bool", label: "grid dots", default: true },
  wrap: { type: "bool", label: "adding past the max clears the bridge", default: true },
});

/** View hook points for plugin ui() extensions. */
export interface BridgesViewHooks {
  /** After every render; `overlay` is an empty-on-mount layer above the board. */
  render: HookEvent<{ svg: SVGSVGElement; overlay: SVGGElement; center(i: number): [number, number] }>;
}

const DIR_KEYS = [["ArrowRight", "d"], ["ArrowDown", "s"], ["ArrowLeft", "a"], ["ArrowUp", "w"]] as const;

type Dir = (typeof DIR_NAMES)[number];
const keysOf = (name: Dir) => DIR_KEYS[DIR_NAMES.indexOf(name)]!;
const toward = (name: Dir) => (name === "down" ? "below" : name === "up" ? "above" : `to the ${name}`);

const BINDINGS = {
  "bridges.add-at": { label: "add a bridge", description: "drag from an island toward a neighbor, or click the gap between them", category: "board", mouse: ["click"], hidden: true },
  "bridges.remove-at": { label: "take away / ✕", description: "drag from an island or click a gap: removes a bridge, or marks an empty gap ✕ (no bridge here)", category: "board", mouse: ["rightclick", "$mod+click"], hidden: true },
  ...bindingsOver("bridges.add-", DIR_NAMES, (name) => ({ label: `add bridge ${name}`, description: `keyboard: add a bridge from the ringed island to its neighbor ${toward(name)}`, category: "keyboard", keys: [`shift+${keysOf(name)[0]}`, `shift+${keysOf(name)[1]}`] })),
  ...bindingsOver("bridges.remove-", DIR_NAMES, (name) => ({ label: `take away / ✕ ${name}`, description: `keyboard: take a bridge away ${name === "down" || name === "up" ? toward(name) : `to the ${name} of`} the ringed island, or mark that gap ✕ (no bridge here)`, category: "keyboard", keys: [`$mod+${keysOf(name)[0]}`] })),
  ...bindingsOver("bridges.move-", DIR_NAMES, (name) => ({ label: `ring ${name}`, description: `keyboard: move the ring (the keyboard cursor) to the next island ${toward(name)}`, category: "keyboard", keys: [...keysOf(name)] })),
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

type Press =
  | { kind: "island"; island: number; secondary: boolean }
  | { kind: "edge"; edge: number; secondary: boolean };

/** Graphic markup or an image URL, as a group centerd on the origin. */
function graphic(src: string, size: number, cls: string): SVGGElement {
  const el = s("g", { class: cls });
  if (src.trimStart().startsWith("<")) el.innerHTML = src;
  else el.append(s("image", { href: src, x: -size / 2, y: -size / 2, width: size, height: size }));
  return el;
}

/** A legend swatch drawn with the board's own classes, so it follows the theme and the board CSS. */
function swatch(inner: string): string {
  return `<svg class="bridges-board" viewBox="0 0 10 10">${inner}</svg>`;
}

function legend(look: Look): { sample: string; meaning: string }[] {
  const art = look.asset(ASSETS.island.id, ASSETS.island.fallback);
  const mark = look.asset(ASSETS.mark.id, ASSETS.mark.fallback);
  const island = (cls: string, n: string, extra = "") =>
    `<g class="island ${cls}" transform="translate(5 5)"><g class="shape">${art}</g><text y="0.15">${n}</text>${extra}</g>`;
  const bridge = (n: number, cls = "") =>
    `<g class="bridge ${cls}">${Array.from({ length: n }, (_, k) => `<line x1="0" x2="10" y1="${5 + (k - (n - 1) / 2) * GAP}" y2="${5 + (k - (n - 1) / 2) * GAP}"/>`).join("")}</g>`;
  const markAt = (cls = "") => `<line x1="0" x2="10" y1="5" y2="5" class="guide" style="opacity:0.25"/><g class="mark ${cls}" transform="translate(5 5) scale(1.6)">${mark}</g>`;
  return [
    { sample: swatch(island("", "3")), meaning: "an island. its number is how many bridges it needs" },
    { sample: swatch(bridge(1)), meaning: "a bridge" },
    { sample: swatch(bridge(2)), meaning: "a double bridge: two bridges between the same islands, counts as two" },
    { sample: swatch(markAt()), meaning: "a ✕ on a gap: your note that no bridge goes there" },
    { sample: swatch(island("done", "2")), meaning: "faded island: it has all its bridges" },
    { sample: swatch(island("error", "2")), meaning: "warning island: something's wrong here (too many bridges, no way left to get enough, or a finished group cut off from the rest)" },
    { sample: swatch(bridge(1, "error")), meaning: "warning bridge: it closes a loop on a board that doesn't allow loops, or (with “flag wrong bridges” on) it isn't in the solution" },
    { sample: swatch(markAt("wrong")), meaning: "warning ✕: a bridge does go there (with “flag wrong bridges” on)" },
    { sample: swatch(island("hint", "4") + `<line x1="8.4" x2="10" y1="5" y2="5" class="focus" style="stroke-width:3"/>`), meaning: "highlighted ring and glow: what the current hint is talking about" },
    { sample: swatch(island("", "4", `<text x="${R + 0.6}" y="${-R + 0.4}" class="badge">1</text>`)), meaning: "small number by an island: bridges it still needs (“show bridges still needed”)" },
    { sample: swatch(island("g0", "2")), meaning: "colored ring: islands with the same color are already joined by bridges (“color connected groups”)" },
    { sample: swatch(`<line x1="0" x2="10" y1="5" y2="5" class="guide"/>`), meaning: "faint dotted line: a bridge could still go here (“show open connections”)" },
    { sample: swatch(`<line x1="0" x2="10" y1="5" y2="5" class="preview"/>`), meaning: "dashed line while dragging: where the bridge will go when you let go" },
    { sample: swatch(`<circle cx="5" cy="5" r="${R + 1.3}" class="cursor" style="display:inline"/>`), meaning: "ring around an island: the keyboard cursor (shows while you use the keys)" },
  ];
}

export function makeView(look: Look, board: BoardPrefs, holdMs: number): View<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction, typeof settings> {
  const view: View<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction, typeof settings> = {
    id: "bridges.svg",
    name: "board",
    puzzle: bridges,
    settings,
    get legend() {
      return legend(look);
    },
    controls: [
      { how: "drag from an island toward a neighbor", what: "add a bridge between them (again for a double bridge)" },
      { how: "click or tap the gap between two islands", what: "add a bridge there too" },
      { how: "right-click, or ctrl+click (⌘ on mac)", what: "take a bridge away. on an empty gap it puts a ✕, your note that no bridge goes there" },
    ],
    mount(root, { session, settings }) {
      style("bridges", CSS);
      const p = session.puzzle;
      const g = graph(p);
      const hooks: BridgesViewHooks = { render: new HookEvent("bridges.render") };
      const center = (i: number): [number, number] => [(p.islands[i]!.x + 0.5) * S, (p.islands[i]!.y + 0.5) * S];
      const islandArt = look.asset(ASSETS.island.id, ASSETS.island.fallback);
      const markArt = look.asset(ASSETS.mark.id, ASSETS.mark.fallback);

      const sides = board.labelSides();
      const pad = (side: Side) => (sides.has(side) ? LABEL : 0);
      const vbW = p.w * S + 2 + pad("left") + pad("right"), vbH = p.h * S + 2 + pad("top") + pad("bottom");
      const svg = s("svg", {
        viewBox: `${-1 - pad("left")} ${-1 - pad("top")} ${vbW} ${vbH}`, class: "bridges-board",
        role: "img", "aria-label": `${p.w} by ${p.h} bridges puzzle with ${p.islands.length} islands`,
      });
      const layer = () => {
        const el = s("g");
        svg.append(el);
        return el;
      };
      const dots = layer(), focusLayer = layer(), guideLayer = layer(), bridgeLayer = layer(), markLayer = layer();
      const previewLayer = layer(), islandLayer = layer(), overlay = layer();
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) dots.append(s("text", { x: (x + 0.5) * S, y: -1 - LABEL / 2, class: "edge-label" }, colName(x)));
        if (sides.has("bottom")) dots.append(s("text", { x: (x + 0.5) * S, y: p.h * S + 1 + LABEL / 2, class: "edge-label" }, colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) dots.append(s("text", { x: -1 - LABEL / 2, y: (y + 0.5) * S, class: "edge-label" }, rowName(y)));
        if (sides.has("right")) dots.append(s("text", { x: p.w * S + 1 + LABEL / 2, y: (y + 0.5) * S, class: "edge-label" }, rowName(y)));
      }
      if (settings.dots) {
        for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
          if (g.cellIsland[y * p.w + x]! < 0) dots.append(s("circle", { cx: (x + 0.5) * S, cy: (y + 0.5) * S, r: 0.35, class: "dot" }));
        }
      }
      const islandEls = p.islands.map((is, i) => {
        const [cx, cy] = center(i);
        const shape = graphic(islandArt, 2 * R, "shape");
        const label = s("text", { y: 0.15 }, String(is.n));
        const badge = s("text", { x: R + 0.6, y: -R + 0.4, class: "badge" });
        const el = s("g", { class: "island", transform: `translate(${cx} ${cy})` }, shape, label, badge);
        islandLayer.append(el);
        return { el, shape, label, badge };
      });
      const cursorEl = s("circle", { r: R + 1.3, class: "cursor" });
      svg.append(cursorEl);
      root.append(svg);

      const endpoints = (e: number, offset: number): [number, number, number, number] => {
        const ed = g.edges[e]!;
        const [ax, ay] = center(ed.a), [bx, by] = center(ed.b);
        return ed.horizontal
          ? [ax + R, ay + offset, bx - R, by + offset]
          : [ax + offset, ay + R, bx + offset, by - R];
      };
      const line = (e: number, offset: number, cls?: string) => {
        const [x1, y1, x2, y2] = endpoints(e, offset);
        return s("line", { x1, y1, x2, y2, class: cls });
      };

      let previewing: BridgesState | null = null;
      const render = () => {
        const st = session.state;
        const pv = previewing;
        const ia = session.interaction;
        const deco = getDeco(session.derived());
        const focus = (session.activeHint?.focus as Focus | undefined) ?? { islands: [], edges: [] };
        const focusIslands = new Set(focus.islands);

        for (const layerEl of [focusLayer, guideLayer, bridgeLayer, markLayer, previewLayer]) layerEl.replaceChildren();
        for (const e of focus.edges) focusLayer.append(line(e, 0, "focus"));
        for (const ed of g.edges) {
          const classes = deco.edge[ed.id] ?? [];
          const n = st.b[ed.id]!;
          if (n > 0) {
            const grp = s("g", { class: ["bridge", ...classes].join(" ") });
            for (let k = 0; k < n; k++) grp.append(line(ed.id, (k - (n - 1) / 2) * GAP));
            if (pv && pv.b[ed.id] !== n) grp.classList.add("faded");
            bridgeLayer.append(grp);
          } else if (classes.includes("guide")) {
            guideLayer.append(line(ed.id, 0, "guide"));
          }
          const pn = pv?.b[ed.id] ?? n;
          if (pn !== n && pn > 0) {
            const grp = s("g", { class: "bridge ghost" });
            for (let k = 0; k < pn; k++) grp.append(line(ed.id, (k - (pn - 1) / 2) * GAP));
            previewLayer.append(grp);
          }
          if (pv?.no[ed.id] === 1 && st.no[ed.id] !== 1) {
            const [x1, y1, x2, y2] = endpoints(ed.id, 0);
            const mark = graphic(markArt, 2, "mark ghost");
            mark.setAttribute("transform", `translate(${(x1 + x2) / 2} ${(y1 + y2) / 2})`);
            previewLayer.append(mark);
          }
          if (st.no[ed.id] === 1) {
            const [x1, y1, x2, y2] = endpoints(ed.id, 0);
            const mark = graphic(markArt, 2, ["mark", ...classes].join(" "));
            mark.setAttribute("transform", `translate(${(x1 + x2) / 2} ${(y1 + y2) / 2})`);
            markLayer.append(mark);
          }
        }
        if (ia.drag && ia.drag.edge >= 0) previewLayer.append(line(ia.drag.edge, 0, "preview"));

        p.islands.forEach((is, i) => {
          const { el, label, badge } = islandEls[i]!;
          const cls = ["island", ...(deco.island[i] ?? [])];
          if (focusIslands.has(i)) cls.push("hint");
          if (ia.drag?.from === i) cls.push("from");
          el.setAttribute("class", cls.join(" "));
          label.textContent = deco.label[i] ?? String(is.n);
          badge.textContent = deco.badge[i] ?? "";
        });

        const c = p.islands[ia.cursor] ? ia.cursor : 0;
        const [cx, cy] = center(c);
        cursorEl.setAttribute("cx", String(cx));
        cursorEl.setAttribute("cy", String(cy));
        hooks.render.call({ svg, overlay, center });
      };

      // --- input ---

      /** Add or take away on an edge. Removals are sent as retractions. */
      const act = (edge: number, remove: boolean) => {
        if (edge < 0) return;
        const n = session.state.b[edge]!;
        if (!remove) {
          if (n < p.maxb) session.dispatch({ type: "set", edge, n: n + 1 });
          else if (settings.wrap) session.dispatch({ type: "set", edge, n: 0 });
        } else if (n > 0) {
          session.dispatch({ type: "cycle", edge, delta: -1 });
        } else {
          session.dispatch({ type: "mark", edge, on: session.state.no[edge] !== 1 });
        }
      };

      const toBoard = (x: number, y: number): [number, number] | null => {
        const m = svg.getScreenCTM();
        if (!m) return null;
        const pt = new DOMPoint(x, y).matrixTransform(m.inverse());
        return [pt.x / S, pt.y / S];
      };

      const hit = (fx: number, fy: number): Press | null => {
        const x = Math.floor(fx), y = Math.floor(fy);
        if (x >= 0 && y >= 0 && x < p.w && y < p.h) {
          const i = g.cellIsland[y * p.w + x]!;
          if (i >= 0) return { kind: "island", island: i, secondary: false };
        }
        let best = -1, bestD = 0.5;
        for (const ed of g.edges) {
          const a = p.islands[ed.a]!, b = p.islands[ed.b]!;
          const d = ed.horizontal
            ? Math.abs(fy - (a.y + 0.5)) + Math.max(0, a.x + 0.5 - fx, fx - (b.x + 0.5))
            : Math.abs(fx - (a.x + 0.5)) + Math.max(0, a.y + 0.5 - fy, fy - (b.y + 0.5));
          if (d < bestD) {
            bestD = d;
            best = ed.id;
          }
        }
        return best >= 0 ? { kind: "edge", edge: best, secondary: false } : null;
      };

      let press: (Press & { touch?: { x: number; y: number; t: number; far: boolean } }) | null = null;
      const setDrag = (drag: BridgesInteraction["drag"]) => session.setInteraction((i) => (
        i.drag?.from === drag?.from && i.drag?.edge === drag?.edge ? i : { ...i, drag }
      ));

      /** Start a gesture at a client point; false if it isn't on anything. */
      const begin = (x: number, y: number, secondary: boolean): boolean => {
        if (session.locked) return false;
        const at = toBoard(x, y);
        const target = at && hit(at[0], at[1]);
        if (!target) return false;
        press = { ...target, secondary };
        if (press.kind === "island") {
          const from = press.island;
          session.setInteraction((i) => ({ ...i, cursor: from, drag: { from, edge: -1 } }));
        }
        return true;
      };
      const onMove = (ev: PointerEvent) => {
        if (press?.touch && Math.hypot(ev.clientX - press.touch.x, ev.clientY - press.touch.y) > 10) press.touch.far = true;
        if (press?.kind !== "island") return;
        const at = toBoard(ev.clientX, ev.clientY);
        if (!at) return;
        const is = p.islands[press.island]!;
        const dx = at[0] - (is.x + 0.5), dy = at[1] - (is.y + 0.5);
        let edge = -1;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.6) {
          const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
          edge = g.islandEdges[press.island]![dir]!;
        }
        setDrag({ from: press.island, edge });
      };
      let holdTimer = 0;
      /** A still touch turning into a hold: drop the move so lifting the finger does nothing. */
      const abandon = () => {
        holdTimer = 0;
        if (!press?.touch || press.touch.far) return;
        press = null;
        setDrag(null);
      };
      const finish = (ev: PointerEvent) => {
        clearTimeout(holdTimer);
        const pr = press;
        press = null;
        const drag = session.interaction.drag;
        if (drag) setDrag(null);
        if (!pr || ev.type !== "pointerup") return;
        if (pr.kind === "island") {
          if (drag && drag.edge >= 0) act(drag.edge, pr.secondary);
          return;
        }
        const at = toBoard(ev.clientX, ev.clientY);
        const up = at && hit(at[0], at[1]);
        if (up?.kind === "edge" && up.edge === pr.edge) act(pr.edge, pr.secondary);
      };
      /** Touch and pen start here; mouse buttons go through the rebindable pointer commands. */
      const onDown = (ev: PointerEvent) => {
        if (ev.pointerType === "mouse") return;
        ev.preventDefault();
        if (!press && begin(ev.clientX, ev.clientY, buttonsSwapped(session.def.id)) && press) {
          (press as { touch?: unknown }).touch = { x: ev.clientX, y: ev.clientY, t: performance.now(), far: false };
          clearTimeout(holdTimer);
          holdTimer = window.setTimeout(abandon, Math.max(0, holdMs - HOLD_LEAD_MS));
        }
      };
      /** Right-click is the take-away gesture everywhere on the board, never the browser or board menu. */
      const onContextMenu = (ev: MouseEvent) => ev.preventDefault();
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);

      const pointer = () => (_ctx: unknown, ev?: unknown) => {
        const e = ev as MouseEvent | undefined;
        if (!e || !(e.target instanceof Element) || !svg.contains(e.target)) return false;
        return begin(e.clientX, e.clientY, secondary(e, session.def.id) !== (e.shiftKey || e.ctrlKey || e.metaKey));
      };

      const move = (dir: number) => () => {
        session.setInteraction((ia) => {
          const c = p.islands[ia.cursor] ? ia.cursor : 0;
          const e = g.islandEdges[c]![dir]!;
          if (e >= 0) {
            const ed = g.edges[e]!;
            return { ...ia, cursor: ed.a === c ? ed.b : ed.a };
          }
          const from = p.islands[c]!;
          let best = -1, bestScore = Infinity;
          p.islands.forEach((is, j) => {
            const along = (is.x - from.x) * (dir === 0 ? 1 : dir === 2 ? -1 : 0) + (is.y - from.y) * (dir === 1 ? 1 : dir === 3 ? -1 : 0);
            if (along <= 0) return;
            const perp = dir % 2 === 0 ? Math.abs(is.y - from.y) : Math.abs(is.x - from.x);
            const score = along + 2 * perp;
            if (score < bestScore) {
              bestScore = score;
              best = j;
            }
          });
          return best < 0 ? ia : { ...ia, cursor: best };
        });
      };
      const edgeFrom = (dir: number) => {
        const c = session.interaction.cursor;
        return p.islands[c] ? g.islandEdges[c]![dir]! : -1;
      };

      const dir = (name: Dir) => DIR_NAMES.indexOf(name);
      const commands = bindCommands(BINDINGS, {
        "bridges.add-at": pointer(),
        "bridges.remove-at": pointer(),
        ...handlersOver("bridges.add-", DIR_NAMES, (name) => () => act(edgeFrom(dir(name)), false)),
        ...handlersOver("bridges.remove-", DIR_NAMES, (name) => () => act(edgeFrom(dir(name)), true)),
        ...handlersOver("bridges.move-", DIR_NAMES, (name) => move(dir(name))),
      });

      const ctm = (x1: number, y1: number, x2: number, y2: number, pad: number): DOMRect => {
        const m = svg.getScreenCTM();
        if (!m) return new DOMRect();
        const a = new DOMPoint(Math.min(x1, x2) - pad, Math.min(y1, y2) - pad).matrixTransform(m);
        const b = new DOMPoint(Math.max(x1, x2) + pad, Math.max(y1, y2) + pad).matrixTransform(m);
        return new DOMRect(a.x, a.y, b.x - a.x, b.y - a.y);
      };
      const islandRect = (i: number) => {
        const [cx, cy] = center(i);
        return ctm(cx, cy, cx, cy, R);
      };
      const edgeRect = (e: number) => {
        const [x1, y1, x2, y2] = endpoints(e, 0);
        return ctm(x1, y1, x2, y2, GAP);
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();
      return {
        aspect: vbW / vbH,
        cells: { cols: vbW / S, rows: vbH / S },
        preview(state) {
          previewing = state as BridgesState | null;
          render();
        },
        locate(focus) {
          const f = focus as Partial<Focus> | null;
          if (!f || typeof f !== "object") return [];
          return [...(f.islands ?? []).map(islandRect), ...(f.edges ?? []).map(edgeRect)];
        },
        locateChange(prev, next) {
          const a = prev as BridgesState, b = next as BridgesState;
          return g.edges.filter((e) => a.b[e.id] !== b.b[e.id] || a.no[e.id] !== b.no[e.id]).map((e) => edgeRect(e.id));
        },
        destroy() {
          clearTimeout(holdTimer);
          offs.forEach((f) => f());
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          svg.remove();
        },
        gestures: { secondaryClick: true },
        commands,
        hooks,
      };
    },
  };
  return view;
}
