import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, style } from "../../core/dom";
import type { View } from "../../core/types";
import { formatValue } from "../../lib/dataset/compare";
import { mediaUrl } from "../../lib/pokemon/media";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";
import { sprite, typeChip } from "../../lib/pokemon/ui";
import { correct, isOver, lookupOf, mistakes, rounds, type Dir, type HLAction, type HLPuzzle, type HLState, type Lookup } from "./logic";

/** How long a round's answer stays showing before the next pokémon comes in. */
const REVEAL_MS = 1300;
const COUNT_MS = 600;

const CSS = `
.hl { container-type: size; width: 100%; height: 100%; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 6px; user-select: none; -webkit-user-select: none; font-family: var(--font); color: var(--text); }
.hl-bar { padding-right: 40px; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 15px; min-height: 1.4em; }
.hl-bar .hl-score { font-weight: 700; font-variant-numeric: tabular-nums; }
.hl-bar .hl-lives { letter-spacing: 2px; color: var(--danger, #c33); }
.hl-pair { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: stretch; gap: 8px; }
@container (aspect-ratio < 1) { .hl-pair { grid-template-columns: none; grid-template-rows: 1fr auto 1fr; } }
.hl-card { min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; text-align: center; }
@container (aspect-ratio < 1) { .hl-card { flex-direction: row; text-align: left; } .hl-card .hl-info { align-items: flex-start; } }
.hl-pic { flex: 1 1 auto; min-height: 0; min-width: 0; width: 100%; max-width: 260px; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }
@container (aspect-ratio < 1) { .hl-pic { width: auto; height: 100%; max-height: 180px; flex: 0 1 auto; } }
.hl-pic > * { width: 100% !important; height: 100% !important; }
.hl-pic img.art { image-rendering: auto; }
.hl-info { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.hl-name { font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
.hl-types { display: flex; gap: 4px; flex-wrap: wrap; }
.hl-attr { font-size: 14px; font-weight: 600; color: var(--accent); }
.hl-value { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; min-height: 1.2em; }
.hl-buttons { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 200px; }
.hl-buttons button { font-size: 18px; padding: 8px 12px; border-radius: 99px; }
.hl-mid { display: flex; align-items: center; justify-content: center; }
.hl-vs { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; background: var(--surface-2); border: 1px solid var(--border); font-size: 15px; }
.hl-vs.right { background: var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); color: #fff; font-size: 22px; }
.hl-vs.wrong { background: var(--danger, #c33); color: #fff; font-size: 22px; }
.hl-card.wrong { border-color: var(--danger, #c33); }
.hl-card.right { border-color: var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); }
.hl-card.hint { outline: 3px solid var(--hint); outline-offset: -3px; }
`;

const BINDINGS = {
  "higher-lower.higher": { label: "higher", category: "higher or lower", keys: ["ArrowUp", "w", "h"], description: "the right one's is higher" },
  "higher-lower.lower": { label: "lower", category: "higher or lower", keys: ["ArrowDown", "s", "l"], description: "the right one's is lower" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const picture = (it: PokemonItem): HTMLElement => {
  const art = !!mediaUrl(it, "art");
  const el = sprite(it, { kind: art ? "art" : "sprite", size: 240 });
  if (art) el.classList.add("art");
  return el;
};

/** Count a shown number up from `from` so the reveal has a moment, like the benchmark game. */
function countUp(el: HTMLElement, from: number, to: number, show: (n: number) => string, decimals: number): () => void {
  const t0 = performance.now();
  let raf = 0;
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / COUNT_MS);
    const eased = 1 - (1 - k) ** 3;
    const f = 10 ** decimals;
    el.textContent = show(k >= 1 ? to : Math.round((from + (to - from) * eased) * f) / f);
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function makeView(ds: () => PokemonDataset | undefined, puzzle: { id: string }): View<HLPuzzle, HLState, HLAction, null> {
  return {
    id: "pokemon-higher-lower.cards",
    name: "cards",
    puzzle,
    controls: [{ how: "click or tap higher or lower", what: "answer for the right one" }],
    legend: [
      { sample: `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a))"/><path d="M5.5 10.5l3 3 6-7" fill="none" stroke="#fff" stroke-width="2"/></svg>`, meaning: "right: the right one moves over" },
      { sample: `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="var(--danger, #c33)"/><path d="M6 6l8 8M14 6l-8 8" stroke="#fff" stroke-width="2"/></svg>`, meaning: "wrong: costs a life" },
    ],
    mount(root, { session }) {
      style("higher-lower", CSS);
      const d = ds();
      if (!d) throw new Error("the pokémon data pack isn't loaded");
      const look: Lookup = lookupOf(d);
      const p = session.puzzle;
      const el = h("div", { class: "hl" });
      root.append(el);

      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopCount: (() => void) | null = null;
      const cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        stopCount?.();
        stopCount = null;
      };

      const guess = (dir: Dir) => {
        // while an answer is showing, the next round isn't on screen yet
        if (timer) return;
        session.dispatch({ type: "guess", dir });
      };

      const card = (it: PokemonItem, ...info: (Node | null)[]) => h("div", { class: "hl-card" },
        h("div", { class: "hl-pic" }, picture(it)),
        h("div", { class: "hl-info" },
          h("div", { class: "hl-name" }, it.name),
          h("div", { class: "hl-types" }, ((it.values.type as readonly string[] | null) ?? []).map((t) => typeChip(t))),
          ...info));

      const preload = (k: number) => {
        const id = p.seq[k];
        if (!id) return;
        const it = look.item(id);
        const url = mediaUrl(it, "art") ?? mediaUrl(it, "sprite");
        if (url) { const img = new Image(); img.crossOrigin = "anonymous"; img.src = url; }
      };

      /** Round k on screen; `result` set: its answer showing (right or wrong). */
      const render = (k: number, result: boolean | null) => {
        cancel();
        const st = session.state;
        const attr = look.attribute(p.attrs[k]!);
        const left = look.item(p.seq[k]!), right = look.item(p.seq[k + 1]!);
        const lv = look.value(left.id, attr.id), rv = look.value(right.id, attr.id);
        const value = h("div", { class: "hl-value" }, result === null ? "" : formatValue(attr, lv));
        const over = isOver(p, st);
        const rightInfo = result === null
          ? h("div", { class: "hl-buttons" },
            h("button", { class: "primary", "data-command": "higher-lower.higher", disabled: over, onclick: () => guess("higher") }, "▲ higher"),
            h("button", { class: "primary", "data-command": "higher-lower.lower", disabled: over, onclick: () => guess("lower") }, "▼ lower"))
          : value;
        const rightCard = card(right, h("div", { class: "hl-attr" }, attr.label), rightInfo);
        if (result !== null) rightCard.classList.add(result ? "right" : "wrong");
        const vs = h("div", { class: `hl-vs${result === null ? "" : result ? " right" : " wrong"}` }, result === null ? "vs" : result ? "✓" : "✗");
        const lives = p.lives > 1 ? "♥".repeat(Math.max(0, p.lives - mistakes(st))) + "♡".repeat(Math.min(p.lives, mistakes(st))) : "";
        el.replaceChildren(
          h("div", { class: "hl-bar" },
            h("span", { class: "hl-score" }, p.lives > 1 ? `${correct(st)} right` : `streak ${correct(st)}`),
            h("span", null, `${Math.min(k + 2, p.seq.length)} / ${p.seq.length}`),
            lives ? h("span", { class: "hl-lives", "aria-label": `${p.lives - mistakes(st)} lives left` }, lives) : null),
          h("div", { class: "hl-pair" },
            card(left, h("div", { class: "hl-attr" }, attr.label), h("div", { class: "hl-value" }, formatValue(attr, lv))),
            h("div", { class: "hl-mid" }, vs),
            rightCard));
        if (result !== null) stopCount = countUp(value, lv, rv, (n) => formatValue(attr, n), attr.decimals ?? 0);
        preload(k + 2);
      };

      /** The board for the current state, without animation. */
      const settle = () => {
        const st = session.state;
        const n = st.results.length;
        if (isOver(p, st) && n > 0) render(n - 1, st.results[n - 1]!);
        else render(Math.min(n, rounds(p) - 1), null);
      };

      const offChange = session.hooks.change.tap(({ prev, state, cause }) => {
        const n = state.results.length;
        if (cause === "action" && n === prev.results.length + 1) {
          render(n - 1, state.results[n - 1]!);
          if (!isOver(p, state)) timer = setTimeout(() => { timer = null; settle(); }, REVEAL_MS);
        } else settle();
      }, { owner: "view" });
      const offRefresh = session.hooks.refresh.tap(() => { if (!timer) settle(); }, { owner: "view" });
      settle();

      const portrait = () => typeof window !== "undefined" && window.innerWidth < window.innerHeight;
      return {
        get aspect() { return portrait() ? 0.62 : 1.7; },
        // the losing value counts up before the results cover it
        endDelayMs: COUNT_MS + 700,
        commands: bindCommands(BINDINGS, {
          "higher-lower.higher": () => guess("higher"),
          "higher-lower.lower": () => guess("lower"),
        }, { "higher-lower.higher": { menu: "board" }, "higher-lower.lower": { menu: "board" } }),
        locate: () => [...el.querySelectorAll(".hl-card")].map((c) => c.getBoundingClientRect()),
        destroy() {
          cancel();
          offChange();
          offRefresh();
          el.remove();
        },
      };
    },
  };
}
