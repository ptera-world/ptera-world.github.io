import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import type { WidgetDef } from "../../core/types";
import { h, style } from "../../ui/dom";
import { components, graph, islandSums, type BridgesPuzzle, type BridgesState } from "./graph";
import { bridges, type BridgesAction, type BridgesInteraction } from "./logic";
import { plugins } from "./plugins";
import { techniques } from "./techniques";
import { makeView, type Look } from "./view";

type BridgesWidget = WidgetDef<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction>;

const CSS = `
.bridges-mode button[aria-pressed="true"] { background: var(--danger-soft); border-color: var(--danger); }
.bridges-progress { display: flex; white-space: nowrap; gap: 14px; justify-content: center; font-size: 13px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.bridges-progress b { display: inline-block; min-width: 3ch; text-align: right; color: var(--text); font-weight: 600; }
`;

const modeWidget: BridgesWidget = {
  id: "bridges.mode",
  name: "mark mode",
  description: "switch taps between adding bridges and taking away / crossing off",
  puzzles: ["bridges"],
  defaultSlot: "bottom",
  order: 5,
  mount(el, ctx) {
    style("bridges-widgets", CSS);
    const btn = h("button", { type: "button", "aria-pressed": "false", onclick: () => ctx.run("bridges.mode") }, "✕ mark mode");
    el.append(h("div", { class: "bridges-mode" }, btn));
    const sync = () => btn.setAttribute("aria-pressed", String(ctx.session.interaction.mode === "mark"));
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
    el.append(h("div", { class: "bridges-progress" }, h("span", null, open, " islands left"), h("span", null, groups, " groups")));
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

export function register(registry: Registry, look: Look = plainLook): void {
  for (const t of techniques) registry.technique(t);
  registry.puzzle(bridges);
  registry.view(makeView(look));
  for (const p of plugins) registry.plugin(p);
  registry.widget(modeWidget);
  registry.widget(progressWidget);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry, games.look);
}
