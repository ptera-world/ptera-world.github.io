import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import type { WidgetDef } from "../../core/types";
import { h, style } from "../../ui/dom";
import { components, graph, islandSums, type BridgesPuzzle, type BridgesState } from "./graph";
import { bridges, type BridgesAction, type BridgesInteraction } from "./logic";
import { plugins } from "./plugins";
import { techniques } from "./techniques";
import { makeView, type BoardPrefs, type Look } from "./view";

type BridgesWidget = WidgetDef<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction>;

const CSS = `
.bridges-mode { display: inline-flex; }
.bridges-mode button { border-radius: 0; }
.bridges-mode button:first-child { border-radius: 6px 0 0 6px; }
.bridges-mode button:last-child { border-radius: 0 6px 6px 0; margin-left: -1px; }
.bridges-mode button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); position: relative; }
.bridges-mode button.remove[aria-pressed="true"] { background: var(--danger-soft); border-color: var(--danger); }
.bridges-progress { display: flex; white-space: nowrap; gap: 14px; justify-content: center; font-size: 13px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.bridges-progress b { display: inline-block; min-width: 3ch; text-align: right; color: var(--text); font-weight: 600; }
`;

const modeWidget: BridgesWidget = {
  id: "bridges.mode",
  name: "what a tap does",
  description: "choose whether tapping (or clicking) the board adds bridges or takes them away and puts ✕. mostly for touch, where there's no right-click",
  puzzles: ["bridges"],
  defaultSlot: "bottom",
  order: 5,
  mount(el, ctx) {
    style("bridges-widgets", CSS);
    const pick = (removing: boolean) => () => { if ((ctx.session.interaction.mode === "mark") !== removing) ctx.run("bridges.mode"); };
    const add = h("button", { type: "button", "data-tip": "tapping, clicking or dragging adds a bridge", onclick: pick(false) }, "tap adds");
    const remove = h("button", { type: "button", class: "remove", "data-tip": "tapping, clicking or dragging takes a bridge away, or puts a ✕ (no bridge here) on an empty gap. same as right-click", onclick: pick(true) }, "tap removes / ✕");
    el.append(h("div", { class: "bridges-mode", role: "group", "aria-label": "what a tap does" }, add, remove));
    const sync = () => {
      const removing = ctx.session.interaction.mode === "mark";
      add.setAttribute("aria-pressed", String(!removing));
      remove.setAttribute("aria-pressed", String(removing));
    };
    ctx.session.hooks.interaction.tap(sync, { owner: ctx.owner });
    sync();
  },
};

const progressWidget: BridgesWidget = {
  id: "bridges.progress",
  name: "progress",
  description: "islands still open and how many separate groups the bridges form",
  puzzles: ["bridges"],
  defaultSlot: "top",
  order: 10,
  mount(el, ctx) {
    style("bridges-widgets", CSS);
    const s = ctx.session;
    const g = graph(s.puzzle);
    const open = h("b"), groups = h("b");
    el.append(h("div", { class: "bridges-progress" },
      h("span", { "data-tip": "islands that don't have all their bridges yet" }, open, " islands left"),
      h("span", { "data-tip": "how many separate pieces the bridges so far make. a finished board is 1" }, groups, " groups")));
    const sync = () => {
      const sums = islandSums(g, s.state.b);
      open.textContent = String(s.puzzle.islands.filter((is, i) => sums[i] !== is.n).length);
      groups.textContent = String(components(g, s.state.b).count);
    };
    s.hooks.change.tap(sync, { owner: ctx.owner });
    sync();
  },
};

const plainLook: Look = { asset: (_id, fallback) => fallback };
const noLabels: BoardPrefs = { labelSides: () => new Set() };

export function register(registry: Registry, look: Look = plainLook, board: BoardPrefs = noLabels): void {
  for (const t of techniques) registry.technique(t);
  registry.puzzle(bridges);
  registry.view(makeView(look, board));
  for (const p of plugins) registry.plugin(p);
  registry.widget(modeWidget);
  registry.widget(progressWidget);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry, games.look, games.board);
}
