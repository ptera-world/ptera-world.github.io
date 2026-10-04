import { add, clear, h, style } from "../../core/dom";
import { prefs } from "../../core/storage";
import type { WidgetContext } from "../../core/types";
import { colorOf } from "./engine";
import { explainer } from "./explainer";
import { techniqueCommand } from "./names";
import type { Shell } from "./shell";


const CSS = `
.gd { display: flex; flex-direction: column; gap: 10px; }
.gd-msg { padding: 9px 12px; border-radius: 12px 12px 12px 4px; background: var(--surface-2); line-height: 1.45; font-size: 14px; max-width: 95%; }
.gd-msg.you { align-self: flex-end; border-radius: 12px 12px 4px 12px; background: var(--accent-soft); color: var(--text); font-size: 13px; }
.gd-msg ul { padding-left: 18px; margin-top: 4px; display: flex; flex-direction: column; gap: 3px; }
.gd-msg .legend { list-style: none; padding-left: 0; }
.gd-msg .legend li { display: flex; gap: 8px; align-items: center; }
.gd-msg .sw { width: 30px; height: 30px; flex: none; display: inline-flex; }
.gd-msg .sw svg { width: 100%; height: 100%; }
.gd-msg .act { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.gd-asks { display: flex; flex-wrap: wrap; gap: 6px; }
.gd-asks button { border-radius: 99px; font-size: 13px; padding: 5px 12px; }
.gd-asks button.asked { opacity: .55; }
.gd-pulse { animation: gd-pulse 1.2s ease-out 2; }
@keyframes gd-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent); } 100% { box-shadow: 0 0 0 12px transparent; } }
@media (prefers-reduced-motion: reduce) { .gd-pulse { animation: none; outline: 2px solid var(--accent); } }
`;

interface Ask {
  id: string;
  q: string;
  answer(): (Node | string | null)[];
  available?(): boolean;
}

/** Make a sidebar tab, or something inside it, catch the eye for a moment. */
function pulse(el: Element | null): void {
  if (!el) return;
  el.classList.remove("gd-pulse");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("gd-pulse");
  setTimeout(() => el.classList.remove("gd-pulse"), 2600);
}

/**
 * A conversation instead of a wall of text: a one-line opener about the puzzle, then questions to
 * click. Each answer is short and can act on the page (open a tab, show a technique on a small
 * board, point at the board). Built from what packs already declare: description, rules,
 * controls, legend, commands, techniques.
 */
export function guideWidget(shell: Shell, el: HTMLElement, ctx: WidgetContext): () => void {
  style("guide", CSS);
  const s = ctx.session;
  const def = s.def;
  const thread = h("div", { class: "gd" });
  const asks = h("div", { class: "gd-asks", role: "group", "aria-label": "ask the guide" });
  const disposers: (() => void)[] = [];
  const asked = new Set<string>();
  el.append(thread, asks);

  const say = (...parts: (Node | string | null)[]) => {
    const m = h("div", { class: "gd-msg" });
    add(m, ...parts);
    thread.append(m);
    m.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const youSaid = (q: string) => thread.append(h("div", { class: "gd-msg you" }, q));
  const act = (...buttons: HTMLElement[]) => h("div", { class: "act" }, buttons);
  const goTab = (id: string, highlight?: string) => {
    shell.openTab(id);
    requestAnimationFrame(() => {
      pulse(document.querySelector(`.tabs [data-widget="${id}"]`));
      if (highlight) pulse(document.querySelector(highlight));
    });
  };

  const view = shell.view;
  const techniques = shell.techniques?.list ?? [];
  const lessons = techniques.filter((t) => t.practice !== false);
  const legendOf = () => {
    const lg = view?.def.legend;
    return typeof lg === "function" ? lg(s.puzzle) : lg ?? [];
  };

  const all: Ask[] = [
    {
      id: "play", q: "how do i play?",
      answer: () => {
        const gestures = view?.def.controls ?? [];
        const pointer = ctx.commands().filter((c) => !/^(shell|toggle|technique|widget|fx)\./.test(c.id) && !c.hidden && (c.mouse?.length || [c.menu].flat().includes("board")));
        return [
          gestures.length || pointer.length ? h("ul", null,
            gestures.map((g) => h("li", null, h("strong", null, g.how), ` · ${g.what}`)),
            pointer.slice(0, 6).map((c) => h("li", null, h("strong", null, c.label), c.description ? ` · ${c.description}` : ""))) : "play on the board.",
          act(h("button", { onclick: () => ctx.run("shell.shortcuts") }, "keyboard shortcuts")),
        ];
      },
    },
    {
      id: "rules", q: "what are the rules?",
      available: () => !!def.rules,
      answer: () => [h("ul", null, (def.rules?.(s.puzzle) ?? []).map((r) => h("li", null, r)))],
    },
    {
      id: "colors", q: "what do the colors mean?",
      available: () => legendOf().length > 0,
      answer: () => [h("ul", { class: "legend" }, legendOf().map((l) => {
        const sw = h("span", { class: "sw", "aria-hidden": "true" });
        sw.innerHTML = l.sample;
        return h("li", null, sw, h("span", null, l.meaning));
      }))],
    },
    {
      id: "trick", q: "teach me the first trick",
      available: () => lessons.length > 0 && !!view,
      answer: () => {
        const t = lessons[0]!;
        const ex = explainer(def, t, techniques, view!.def, shell.viewSettings(view!.def));
        disposers.push(() => ex.dispose());
        ex.style.setProperty("--ex-color", colorOf(t, techniques));
        return [
          `the easiest one is ${t.name}. press play to watch it on a small board:`,
          ex,
          act(
            h("button", { class: "primary", onclick: () => ctx.run(techniqueCommand("practice", t)) }, "try it myself"),
            h("button", { onclick: () => goTab("techniques", `[data-technique="${t.id}"]`) }, `all ${techniques.length} techniques`)),
        ];
      },
    },
    {
      id: "learn", q: "how do i get better?",
      available: () => techniques.length > 0,
      answer: () => [
        `every trick that solves ${def.name} is in the techniques tab, easiest first. each one has "watch it", and a practice board where it's the next move.`,
        act(
          h("button", { class: "primary", onclick: () => goTab("techniques", ".w-tech-start") }, "open techniques"),
          lessons.length ? h("button", { onclick: () => void shell.startPractice(def, lessons[0]!, String(Date.now())) }, "start from the first one") : h("span")),
      ],
    },
    {
      id: "stuck", q: "i'm stuck",
      answer: () => [
        "the hint button points at where to look first. press it again for the reason, a third time and it makes the move for you.",
        act(h("button", { class: "primary", onclick: () => ctx.run("shell.hint") }, "give me a hint")),
      ],
    },
    {
      id: "change", q: "can i change how it looks or plays?",
      answer: () => [
        "everything lives in settings: themes and colors, which helpers run on their own, what each key does, and where every panel sits (or whether it shows at all).",
        act(h("button", { onclick: () => goTab("settings") }, "open settings")),
      ],
    },
  ];

  const renderAsks = () => {
    clear(asks);
    for (const a of all) {
      if (a.available && !a.available()) continue;
      asks.append(h("button", {
        class: asked.has(a.id) ? "asked" : undefined,
        onclick: () => { asked.add(a.id); youSaid(a.q); say(...a.answer()); renderAsks(); },
      }, a.q));
    }
  };

  const others = (def.aliases ?? []).filter((a) => a.toLowerCase() !== def.name.toLowerCase());
  const aka = others.length ? ` (also called ${others.slice(0, 2).join(" or ")})` : "";
  say(`this is ${def.name}${aka}. ${def.description ?? ""}`.trim(), " what would you like to know?");
  renderAsks();
  prefs.set(`guideSeen:${def.id}`, true);
  return () => { for (const d of disposers) d(); };
}

/** True the first time a puzzle is opened, so the guide can open itself once. */
export const guideUnseen = (puzzleId: string): boolean => !prefs.get(`guideSeen:${puzzleId}`, false);
