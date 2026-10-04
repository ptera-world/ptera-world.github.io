import { Event } from "../../core/hooks";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { bindCommands, type BindingSchema, type CommandHandler } from "../../core/commands";
import { h, s, style } from "../../ui/dom";
import { getDeco } from "./deco";
import { DIR_NAMES, graph, type BridgesPuzzle, type BridgesState } from "./graph";
import type { BridgesAction, BridgesInteraction, Focus } from "./logic";

const S = 10;
const R = 3.4;
const GAP = 1.4;

const CSS = `
.bridges-wrap { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 0; }
.bridges-board { flex: 1; width: 100%; min-height: 0; touch-action: none; user-select: none; -webkit-user-select: none; }
.bridges-tools { display: flex; gap: 6px; }
.bridges-tools button[aria-pressed="true"] { background: var(--danger-soft); border-color: var(--danger); }
.bridges-board .dot { fill: var(--border); }
.bridges-board .island circle { fill: var(--surface-2); stroke: var(--text-dim); stroke-width: 0.5; transition: fill 120ms, stroke 120ms; }
.bridges-board .island text { fill: var(--text); font: 600 4.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.bridges-board .island .badge { fill: var(--warn); font-size: 2.8px; }
.bridges-board .island.done circle { fill: var(--accent-soft); stroke: var(--accent); }
.bridges-board .island.done text { fill: var(--text-dim); }
.bridges-board .island.error circle { fill: var(--danger-soft); stroke: var(--danger); }
.bridges-board .island.hint circle { stroke: var(--hint); stroke-width: 1.1; }
.bridges-board .island.from circle { stroke: var(--accent); stroke-width: 1; }
${Array.from({ length: 8 }, (_, k) => `.bridges-board .island.g${k} circle { stroke: hsl(${k * 40 + 40} 65% 62%); stroke-width: 1; }`).join("\n")}
.bridges-board .bridge line { stroke: var(--text); stroke-width: 0.55; stroke-linecap: round; }
.bridges-board .bridge.error line, .bridges-board .bridge.wrong line { stroke: var(--danger); }
.bridges-board .guide { stroke: var(--text-dim); stroke-width: 0.3; stroke-dasharray: 0.6 0.9; opacity: 0.6; }
.bridges-board .mark line { stroke: var(--danger); stroke-width: 0.45; stroke-linecap: round; opacity: 0.85; }
.bridges-board .mark.wrong line { stroke: var(--warn); }
.bridges-board .focus { stroke: var(--hint-soft); stroke-width: 4.5; stroke-linecap: round; }
.bridges-board .preview { stroke: var(--accent); stroke-width: 0.7; stroke-dasharray: 1 1; }
.bridges-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
`;

const settings = defineSchema({
  dots: { type: "bool", label: "grid dots", default: true },
  wrap: { type: "bool", label: "adding past the max clears the bridge", default: true },
});

/** View hook points for plugin ui() extensions. */
export interface BridgesViewHooks {
  /** After every render; `overlay` is an empty-on-mount layer above the board. */
  render: Event<{ svg: SVGSVGElement; overlay: SVGGElement; center(i: number): [number, number] }>;
}

const DIR_KEYS = [["ArrowRight", "d"], ["ArrowDown", "s"], ["ArrowLeft", "a"], ["ArrowUp", "w"]] as const;

const bindings: BindingSchema = {
  "bridges.mode": { label: "Toggle mark mode", category: "Bridges", keys: ["x"] },
  "bridges.apply-hint": { label: "Apply the shown hint", category: "Bridges", keys: ["h"] },
};
DIR_NAMES.forEach((name, d) => {
  const [arrow, letter] = DIR_KEYS[d]!;
  bindings[`bridges.move-${name}`] = { label: `Cursor ${name}`, category: "Bridges", keys: [arrow, letter] };
  bindings[`bridges.add-${name}`] = { label: `Add bridge ${name}`, category: "Bridges", keys: [`shift+${arrow}`, `shift+${letter}`] };
  bindings[`bridges.remove-${name}`] = { label: `Remove bridge / mark ${name}`, category: "Bridges", keys: [`$mod+${arrow}`] };
});

type Press =
  | { kind: "island"; island: number; secondary: boolean }
  | { kind: "edge"; edge: number; secondary: boolean };

export const bridgesView: View<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction> & { bindings: BindingSchema } = {
  id: "bridges.svg",
  name: "board",
  puzzle: "bridges",
  settings,
  bindings,
  mount(root, { session, settings }) {
    style("bridges", CSS);
    const p = session.puzzle;
    const g = graph(p);
    const hooks: BridgesViewHooks = { render: new Event("bridges.render") };
    const center = (i: number): [number, number] => [(p.islands[i]!.x + 0.5) * S, (p.islands[i]!.y + 0.5) * S];

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
      const label = s("text", { x: cx, y: cy + 0.15 }, String(is.n));
      const badge = s("text", { x: cx + R + 0.6, y: cy - R + 0.4, class: "badge" });
      const el = s("g", { class: "island" }, s("circle", { cx, cy, r: R }), label, badge);
      islandLayer.append(el);
      return { el, label, badge };
    });
    const cursorEl = s("circle", { r: R + 1.3, class: "cursor", visibility: "hidden" });
    svg.append(cursorEl);

    const modeBtn = h("button", { type: "button", "aria-pressed": "false", title: "mark mode (x)" }, "✕ mark");
    const wrap = h("div", { class: "bridges-wrap" }, svg, h("div", { class: "bridges-tools" }, modeBtn));
    root.append(wrap);

    let keyboard = false;

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
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, k = 1;
          markLayer.append(s("g", { class: ["mark", ...classes].join(" ") },
            s("line", { x1: mx - k, y1: my - k, x2: mx + k, y2: my + k }),
            s("line", { x1: mx - k, y1: my + k, x2: mx + k, y2: my - k })));
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
      cursorEl.setAttribute("visibility", keyboard ? "visible" : "hidden");
      modeBtn.setAttribute("aria-pressed", String(ia.mode === "mark"));
      hooks.render.call({ svg, overlay, center });
    };

    // --- input ---

    const act = (edge: number, secondary: boolean) => {
      if (edge < 0) return;
      const markMode = session.interaction.mode === "mark";
      const n = session.state.b[edge]!;
      if (secondary === markMode) {
        if (n >= p.maxb && !settings.wrap) return;
        session.dispatch({ type: "cycle", edge, delta: 1 });
      } else if (n > 0) {
        session.dispatch({ type: "cycle", edge, delta: -1 });
      } else {
        session.dispatch({ type: "mark", edge });
      }
    };

    const toBoard = (ev: PointerEvent): [number, number] | null => {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
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

    svg.addEventListener("contextmenu", (ev) => ev.preventDefault());
    svg.addEventListener("pointerdown", (ev) => {
      const at = toBoard(ev);
      if (!at) return;
      const target = hit(at[0], at[1]);
      if (!target) return;
      ev.preventDefault();
      keyboard = false;
      press = { ...target, secondary: ev.button === 2 || ev.ctrlKey || ev.metaKey };
      svg.setPointerCapture(ev.pointerId);
      if (press.kind === "island") {
        const from = press.island;
        session.setInteraction((i) => ({ ...i, cursor: from, drag: { from, edge: -1 } }));
      }
    });
    svg.addEventListener("pointermove", (ev) => {
      if (press?.kind !== "island") return;
      const at = toBoard(ev);
      if (!at) return;
      const is = p.islands[press.island]!;
      const dx = at[0] - (is.x + 0.5), dy = at[1] - (is.y + 0.5);
      let edge = -1;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.6) {
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
        edge = g.islandEdges[press.island]![dir]!;
      }
      setDrag({ from: press.island, edge });
    });
    const finish = (ev: PointerEvent, commit: boolean) => {
      const pr = press;
      press = null;
      const drag = session.interaction.drag;
      if (drag) setDrag(null);
      if (!pr || !commit) return;
      if (pr.kind === "island") {
        if (drag && drag.edge >= 0) act(drag.edge, pr.secondary);
        return;
      }
      const at = toBoard(ev);
      const up = at && hit(at[0], at[1]);
      if (up?.kind === "edge" && up.edge === pr.edge) act(pr.edge, pr.secondary);
    };
    svg.addEventListener("pointerup", (ev) => finish(ev, true));
    svg.addEventListener("pointercancel", (ev) => finish(ev, false));
    modeBtn.addEventListener("click", () => session.setInteraction((i) => ({ ...i, mode: i.mode === "mark" ? "bridge" : "mark" })));

    const move = (dir: number) => () => {
      keyboard = true;
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
      render();
    };
    const edgeFrom = (dir: number) => {
      const c = session.interaction.cursor;
      return p.islands[c] ? g.islandEdges[c]![dir]! : -1;
    };

    const handlers: Record<string, CommandHandler> = {
      "bridges.mode": () => modeBtn.click(),
      "bridges.apply-hint": () => {
        const acts = session.activeHint?.actions ?? [];
        session.batch(() => { for (const a of acts) session.dispatch(a, { source: { kind: "hint" } }); });
      },
    };
    DIR_NAMES.forEach((name, d) => {
      handlers[`bridges.move-${name}`] = move(d);
      handlers[`bridges.add-${name}`] = () => { keyboard = true; act(edgeFrom(d), false); };
      handlers[`bridges.remove-${name}`] = () => { keyboard = true; act(edgeFrom(d), true); };
    });

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    return {
      destroy() {
        offs.forEach((f) => f());
        wrap.remove();
      },
      commands: bindCommands(bridgesView.bindings, handlers),
      hooks,
    };
  },
};
