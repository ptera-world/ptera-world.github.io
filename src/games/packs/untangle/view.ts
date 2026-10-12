import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { untangle, crossings, type Pt, type UntangleAction, type UntangleFocus, type UntangleInteraction, type UntanglePuzzle, type UntangleState } from "./logic";
import type { UntangleTarget } from "./techniques";

const CSS = `
.untangle-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.untangle-board .bg { fill: var(--cell); stroke: var(--border); stroke-width: 0.2; }
.untangle-board .edge { stroke: var(--text); stroke-width: 0.35; stroke-linecap: round; }
.untangle-board .edge.crossed { stroke: var(--danger); }
.untangle-board .edge.near { stroke: var(--accent); stroke-width: 0.55; }
.untangle-board .point { fill: var(--accent); stroke: var(--text); stroke-width: 0.25; cursor: grab; }
.untangle-board .point.dragging { cursor: grabbing; fill: var(--focus); }
.untangle-board .point.selected { stroke: var(--focus); stroke-width: 0.6; }
.untangle-board .num { fill: var(--bg); font: 600 1.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.untangle-board .ghost { fill: none; stroke: var(--hint); stroke-width: 0.35; stroke-dasharray: 0.6 0.4; pointer-events: none; }
.untangle-board .ghost-line { stroke: var(--hint); stroke-width: 0.25; stroke-dasharray: 0.6 0.4; pointer-events: none; }
.untangle-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.5; pointer-events: none; }
`;

const settings = defineSchema({
  crossings: { type: "bool", label: "show crossing lines in red", default: true },
  numbers: { type: "bool", label: "number the points", default: false },
});

/** Board side in view units; positions are scaled from the unit square. */
const B = 40;
const R = 1.1;
/** Arrow-key step, as a fraction of the board. */
const NUDGE = 1 / 80;

const BINDINGS = {
  "untangle.next": { label: "next point", category: "untangle", keys: ["Tab", "space"], description: "select the next point for the keyboard" },
  "untangle.prev": { label: "previous point", category: "untangle", keys: ["shift+Tab"], description: "select the previous point" },
  "untangle.left": { label: "move left", category: "untangle", keys: ["ArrowLeft", "a"], description: "move the selected point a little left" },
  "untangle.right": { label: "move right", category: "untangle", keys: ["ArrowRight", "d"], description: "move the selected point a little right" },
  "untangle.up": { label: "move up", category: "untangle", keys: ["ArrowUp", "w"], description: "move the selected point a little up" },
  "untangle.down": { label: "move down", category: "untangle", keys: ["ArrowDown", "s"], description: "move the selected point a little down" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string) => `<svg viewBox="0 0 12 6">${body}</svg>`;
  const pt = (x: number, fill = "var(--accent)") => `<circle cx="${x}" cy="3" r="1.4" fill="${fill}" stroke="var(--text)" stroke-width="0.3"/>`;
  return [
    { sample: svg(`<line x1="2" y1="3" x2="10" y2="3" stroke="var(--text)" stroke-width="0.45"/>` + pt(2) + pt(10)), meaning: "two points joined by a line: drag the points" },
    { sample: svg(`<line x1="2" y1="3" x2="10" y2="3" stroke="var(--danger)" stroke-width="0.45"/>`), meaning: "a line that crosses another" },
    { sample: svg(`<circle cx="6" cy="3" r="1.4" fill="none" stroke="var(--hint)" stroke-width="0.4" stroke-dasharray="0.6 0.4"/>`), meaning: "hint: where to move the highlighted point" },
  ];
}

export function untangleView(): View<UntanglePuzzle, UntangleState, UntangleAction, UntangleInteraction, typeof settings> {
  return {
    id: "untangle.svg",
    name: "board",
    puzzle: untangle,
    settings,
    controls: [
      { how: "drag a point", what: "move it; its lines follow" },
      { how: "point at a point, or click or tap it without dragging", what: "highlights its lines; a click or tap keeps them highlighted until the next press on the board, or Esc" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("untangle", CSS);
      const p = session.puzzle;
      const svg = s("svg", { viewBox: `-1 -1 ${B + 2} ${B + 2}`, class: "untangle-board", role: "img", "aria-label": `untangle, ${p.n} points` });
      const bg = s("rect", { x: -1, y: -1, width: B + 2, height: B + 2, class: "bg" });
      const edgesL = s("g"), ghostL = s("g"), pointsL = s("g"), over = s("g");
      svg.append(bg, edgesL, ghostL, pointsL, over);
      root.append(svg);

      const lines = p.edges.map(() => {
        const l = s("line", { class: "edge" });
        edgesL.append(l);
        return l;
      });
      const dots = Array.from({ length: p.n }, (_, i) => {
        const c = s("circle", { r: R, class: "point", "data-point": i });
        pointsL.append(c);
        return c;
      });
      const nums = Array.from({ length: p.n }, (_, i) => {
        const t = s("text", { class: "num" }, String(i + 1));
        if (settings.numbers) pointsL.append(t);
        return t;
      });

      let drag: { point: number; pointerId: number; at: Pt; moved: boolean } | null = null;
      let hover = -1;
      /** Point whose lines stay highlighted after the pointer leaves; cleared by the next press on the board or Esc. */
      let pinned = -1;
      let preview: UntangleState | null = null;

      const render = () => {
        const pts = session.state.pts.map((pt, i) => (drag?.point === i ? drag.at : pt));
        const crossed = new Set<number>();
        if (settings.crossings) for (const [a, b] of crossings(p, pts)) { crossed.add(a); crossed.add(b); }
        const active = drag?.point ?? (hover >= 0 ? hover : pinned);
        p.edges.forEach(([a, b], i) => {
          const l = lines[i]!;
          l.setAttribute("x1", String(pts[a]![0] * B));
          l.setAttribute("y1", String(pts[a]![1] * B));
          l.setAttribute("x2", String(pts[b]![0] * B));
          l.setAttribute("y2", String(pts[b]![1] * B));
          l.classList.toggle("crossed", crossed.has(i));
          l.classList.toggle("near", a === active || b === active);
        });
        dots.forEach((d, i) => {
          d.setAttribute("cx", String(pts[i]![0] * B));
          d.setAttribute("cy", String(pts[i]![1] * B));
          d.classList.toggle("dragging", drag?.point === i);
          d.classList.toggle("selected", session.interaction.selected === i);
          nums[i]!.setAttribute("x", String(pts[i]![0] * B));
          nums[i]!.setAttribute("y", String(pts[i]![1] * B + 0.05));
        });
        while (ghostL.firstChild) ghostL.firstChild.remove();
        while (over.firstChild) over.firstChild.remove();
        const ghost = (v: number, to: Pt) => {
          ghostL.append(s("circle", { cx: to[0] * B, cy: to[1] * B, r: R + 0.3, class: "ghost" }));
          for (const [a, b] of p.edges) {
            if (a !== v && b !== v) continue;
            const o = pts[a === v ? b : a]!;
            ghostL.append(s("line", { x1: to[0] * B, y1: to[1] * B, x2: o[0] * B, y2: o[1] * B, class: "ghost-line" }));
          }
        };
        if (preview) preview.pts.forEach((pt, i) => { if (pt !== session.state.pts[i]) ghost(i, pt); });
        const focus = session.activeHint?.focus as UntangleFocus | undefined;
        if (focus) {
          (focus.points ?? []).forEach((v, k) => {
            over.append(s("circle", { cx: pts[v]![0] * B, cy: pts[v]![1] * B, r: R + 0.8, class: "focus" }));
            const to = focus.to?.[k];
            if (to) ghost(v, to);
          });
        }
      };

      const toUnit = (e: PointerEvent): Pt | null => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return null;
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        return [Math.min(1, Math.max(0, pt.x / B)), Math.min(1, Math.max(0, pt.y / B))];
      };
      /** The point within reach of the pointer, nearest first. */
      const pointNear = (u: Pt): number => {
        let best = -1, bd = ((R + 1.2) / B) ** 2;
        session.state.pts.forEach((pt, i) => {
          const d = (pt[0] - u[0]) ** 2 + (pt[1] - u[1]) ** 2;
          if (d < bd) { bd = d; best = i; }
        });
        return best;
      };
      const onDown = (e: PointerEvent) => {
        const u = toUnit(e);
        if (!u || drag) return;
        const v = pointNear(u);
        if (session.locked || v < 0) { clearPin(); return; }
        e.preventDefault();
        svg.setPointerCapture?.(e.pointerId);
        drag = { point: v, pointerId: e.pointerId, at: session.state.pts[v]!, moved: false };
        session.setInteraction((i) => ({ ...i, selected: v }));
        render();
      };
      const onMove = (e: PointerEvent) => {
        const u = toUnit(e);
        if (!u) return;
        if (drag && e.pointerId === drag.pointerId) {
          drag.at = u;
          drag.moved = true;
          render();
          return;
        }
        if (e.pointerType === "touch") return;
        const v = pointNear(u);
        if (v !== hover) { hover = v; render(); }
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;
        pinned = d.moved ? -1 : pinned === d.point ? -1 : d.point;
        if (!session.dispatch({ type: "move", moves: [[d.point, d.at[0], d.at[1]]] })) render();
      };
      const onCancel = () => { drag = null; render(); };
      const clearPin = () => {
        if (pinned < 0) return;
        pinned = -1;
        render();
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clearPin(); };
      document.addEventListener("keydown", onKey);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);
      svg.addEventListener("pointerleave", () => { if (hover !== -1) { hover = -1; render(); } });

      const nudge = (dx: number, dy: number) => () => {
        const v = session.interaction.selected;
        if (v < 0) return;
        const pt = session.state.pts[v]!;
        session.dispatch({ type: "move", moves: [[v, pt[0] + dx * NUDGE, pt[1] + dy * NUDGE]] });
      };
      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) drag = null;
          render();
        }, { owner: "view" }),
      ];
      render();

      const rectAt = (pt: Pt) => {
        const box = svg.getBoundingClientRect();
        const scale = box.width / (B + 2);
        return new DOMRect(box.x + (pt[0] * B + 1 - R - 0.5) * scale, box.y + (pt[1] * B + 1 - R - 0.5) * scale, (2 * R + 1) * scale, (2 * R + 1) * scale);
      };
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "untangle.next": () => session.setInteraction((i) => ({ ...i, selected: (i.selected + 1) % p.n })),
        "untangle.prev": () => session.setInteraction((i) => ({ ...i, selected: (i.selected - 1 + p.n) % p.n })),
        "untangle.left": nudge(-1, 0),
        "untangle.right": nudge(1, 0),
        "untangle.up": nudge(0, -1),
        "untangle.down": nudge(0, 1),
      }, {
        "untangle.left": { menu: "board" },
        "untangle.right": { menu: "board" },
        "untangle.up": { menu: "board" },
        "untangle.down": { menu: "board" },
      });
      return {
        aspect: 1,
        commands,
        target: (): UntangleTarget | undefined => {
          const v = hover >= 0 ? hover : session.interaction.selected;
          return v >= 0 ? { point: v } : undefined;
        },
        preview: (st) => {
          preview = st as UntangleState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as UntangleFocus | undefined;
          return f ? (f.points ?? []).map((v) => rectAt(session.state.pts[v]!)) : [];
        },
        locateChange: (a, b) => {
          const x = (a as UntangleState).pts, y = (b as UntangleState).pts;
          return y.flatMap((pt, i) => (pt !== x[i] ? [rectAt(pt)] : []));
        },
        destroy() {
          document.removeEventListener("keydown", onKey);
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
