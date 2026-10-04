import { Event as HookEvent } from "../../core/hooks";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { s, style } from "../../ui/dom";
import { getDeco } from "./deco";
import { DIR_NAMES, graph, type BridgesPuzzle, type BridgesState } from "./graph";
import type { BridgesAction, BridgesInteraction, Focus } from "./logic";

const S = 10;
const R = 3.4;
const GAP = 1.4;

/** Themeable graphics, drawn centred on the island / mark in board units (a cell is 10 wide). */
export const ASSETS = {
  island: { id: "bridges.island", fallback: `<circle r="${R}"/>` },
  mark: { id: "bridges.mark", fallback: `<path d="M-1 -1L1 1M-1 1L1 -1"/>` },
} as const;

export interface Look {
  asset(id: string, fallback: string): string;
}

const CSS = `
.bridges-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.bridges-board .dot { fill: var(--border); }
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
.bridges-board .focus { stroke: var(--hint-soft); stroke-width: 4.5; stroke-linecap: round; }
.bridges-board .preview { stroke: var(--accent); stroke-width: 0.7; stroke-dasharray: 1 1; }
.bridges-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
[data-input="pointer"] .bridges-board .cursor { display: none; }
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

type Press =
  | { kind: "island"; island: number; secondary: boolean }
  | { kind: "edge"; edge: number; secondary: boolean };

/** Graphic markup or an image URL, as a group centred on the origin. */
function graphic(src: string, size: number, cls: string): SVGGElement {
  const el = s("g", { class: cls });
  if (src.trimStart().startsWith("<")) el.innerHTML = src;
  else el.append(s("image", { href: src, x: -size / 2, y: -size / 2, width: size, height: size }));
  return el;
}

export function makeView(look: Look): View<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction> {
  const view: View<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction> = {
    id: "bridges.svg",
    name: "board",
    puzzle: "bridges",
    settings,
    mount(root, { session, settings }) {
      style("bridges", CSS);
      const p = session.puzzle;
      const g = graph(p);
      const hooks: BridgesViewHooks = { render: new HookEvent("bridges.render") };
      const center = (i: number): [number, number] => [(p.islands[i]!.x + 0.5) * S, (p.islands[i]!.y + 0.5) * S];
      const islandArt = look.asset(ASSETS.island.id, ASSETS.island.fallback);
      const markArt = look.asset(ASSETS.mark.id, ASSETS.mark.fallback);

      const svg = s("svg", {
        viewBox: `-1 -1 ${p.w * S + 2} ${p.h * S + 2}`, class: "bridges-board",
        role: "img", "aria-label": `${p.w} by ${p.h} bridges puzzle with ${p.islands.length} islands`,
      });
      const layer = () => {
        const el = s("g");
        svg.append(el);
        return el;
      };
      const dots = layer(), focusLayer = layer(), guideLayer = layer(), bridgeLayer = layer(), markLayer = layer();
      const previewLayer = layer(), islandLayer = layer(), overlay = layer();
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

      const render = () => {
        const st = session.state;
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
            bridgeLayer.append(grp);
          } else if (classes.includes("guide")) {
            guideLayer.append(line(ed.id, 0, "guide"));
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

      /** Add (primary) or take away (secondary) on an edge; mark mode swaps them. Removals are sent as retractions. */
      const act = (edge: number, secondary: boolean) => {
        if (edge < 0) return;
        const markMode = session.interaction.mode === "mark";
        const n = session.state.b[edge]!;
        if (secondary === markMode) {
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

      let press: Press | null = null;
      const setDrag = (drag: BridgesInteraction["drag"]) => session.setInteraction((i) => (
        i.drag?.from === drag?.from && i.drag?.edge === drag?.edge ? i : { ...i, drag }
      ));

      /** Start a gesture at a client point; false if it isn't on anything. */
      const begin = (x: number, y: number, secondary: boolean): boolean => {
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
      const finish = (ev: PointerEvent) => {
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
        if (!press) begin(ev.clientX, ev.clientY, false);
      };
      const onContextMenu = (ev: Event) => ev.preventDefault();
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);

      const pointer = (secondary: boolean) => (_ctx: unknown, ev?: unknown) => {
        const e = ev as MouseEvent | undefined;
        if (!e || !(e.target instanceof Element) || !svg.contains(e.target)) return false;
        return begin(e.clientX, e.clientY, secondary);
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

      const commands: CommandDef[] = [
        {
          id: "bridges.mode", label: "mark mode", category: "board", keys: ["x"],
          description: "taps and the add keys take away bridges and cross off connections instead",
          checked: () => session.interaction.mode === "mark",
          run: () => session.setInteraction((i) => ({ ...i, mode: i.mode === "mark" ? "bridge" : "mark" })),
        },
        { id: "bridges.add-at", label: "add a bridge (drag from an island, or click a connection)", category: "board", mouse: ["click"], hidden: true, run: pointer(false) },
        { id: "bridges.remove-at", label: "take a bridge away or cross off (drag or click)", category: "board", mouse: ["rightclick", "$mod+click"], hidden: true, run: pointer(true) },
      ];
      DIR_NAMES.forEach((name, d) => {
        const [arrow, letter] = DIR_KEYS[d]!;
        commands.push(
          { id: `bridges.move-${name}`, label: `cursor ${name}`, category: "board", keys: [arrow, letter], run: move(d) },
          { id: `bridges.add-${name}`, label: `add bridge ${name}`, category: "board", keys: [`shift+${arrow}`, `shift+${letter}`], run: () => act(edgeFrom(d), false) },
          { id: `bridges.remove-${name}`, label: `take away / cross off ${name}`, category: "board", keys: [`$mod+${arrow}`], run: () => act(edgeFrom(d), true) },
        );
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
        aspect: (p.w * S + 2) / (p.h * S + 2),
        locate(focus) {
          const f = focus as Partial<Focus> | null;
          if (!f || typeof f !== "object") return [];
          return [...(f.islands ?? []).map(islandRect), ...(f.edges ?? []).map(edgeRect)];
        },
        locateChange(prev, next) {
          const a = prev as BridgesState, b = next as BridgesState;
          return g.edges.filter((e) => a.b[e.id] !== b.b[e.id] || a.no[e.id] !== b.no[e.id]).map((e) => edgeRect(e.id));
        },
        context: () => ({ markMode: session.interaction.mode === "mark" }),
        destroy() {
          offs.forEach((f) => f());
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          svg.remove();
        },
        commands,
        hooks,
      };
    },
  };
  return view;
}
