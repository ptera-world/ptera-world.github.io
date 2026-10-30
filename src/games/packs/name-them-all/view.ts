import { h, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { mediaUrl } from "../../lib/pokemon/media";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";
import {
  formatClock, groups, isOver, nameIndex, readTyped,
  type Grouping, type NameAllAction, type NameAllFocus, type NameAllPuzzle, type NameAllState,
} from "./logic";

const CSS = `
.nta { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; font-size: 14px; }
.nta-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 0 0 8px; }
.nta-bar input { flex: 1 1 180px; min-width: 0; font-size: 16px; padding: 8px 10px; box-sizing: border-box; }
.nta-bar input.outside { outline: 2px solid var(--warn); }
.nta-count, .nta-clock { font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.nta-count strong { font-size: 18px; }
.nta-clock.low { color: var(--danger); }
.nta-giveup.armed { background: var(--danger); color: #fff; }
.nta-status { flex: 1 0 100%; min-height: 20px; display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 13px; }
.nta-status img { width: 28px; height: 28px; image-rendering: pixelated; margin: -4px 0; }
.nta-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--border); }
.nta-group { content-visibility: auto; contain-intrinsic-size: auto 400px; }
.nta-group h3 { margin: 10px 2px 4px; font-size: 13px; font-weight: 600; color: var(--text-dim); display: flex; gap: 8px; }
.nta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 3px; }
.nta-slot { position: relative; height: 74px; border-radius: 6px; background: var(--cell); border: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; justify-content: flex-end; overflow: hidden; box-sizing: border-box; }
.nta-slot .num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-dim); font-family: var(--mono); font-size: 12px; }
.nta-slot .sil { position: absolute; left: 50%; top: 2px; width: 56px; height: 56px; transform: translateX(-50%); background: var(--text-dim); -webkit-mask: var(--m) center / contain no-repeat; mask: var(--m) center / contain no-repeat; }
.nta-slot img { position: absolute; left: 50%; top: 0; width: 56px; height: 56px; transform: translateX(-50%); image-rendering: pixelated; }
.nta-slot .nm { position: relative; width: 100%; padding: 0 2px 2px; box-sizing: border-box; text-align: center; font-size: 10.5px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nta-slot.named { background: color-mix(in srgb, var(--accent) 16%, var(--cell)); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.nta-slot.missed { border-color: var(--danger); border-style: dashed; }
.nta-slot.missed .nm { color: var(--danger); }
.nta-slot.flash { animation: nta-flash .7s; }
.nta-slot.focus { box-shadow: 0 0 0 2px var(--hint); }
@keyframes nta-flash { 0% { box-shadow: 0 0 0 3px var(--focus); } 100% { box-shadow: 0 0 0 0 transparent; } }
`;

const settings = defineSchema({
  group: {
    type: "enum", label: "group the board", default: "gen",
    options: [
      { value: "gen", label: "by generation" },
      { value: "type", label: "by first type" },
      { value: "none", label: "not at all" },
    ],
  },
});

const dex = (it: PokemonItem) => `#${String(it.species).padStart(4, "0")}`;

export function makeView(
  def: { id: string },
  dataset: () => PokemonDataset | undefined,
): View<NameAllPuzzle, NameAllState, NameAllAction, null, typeof settings> {
  return {
    id: "name-them-all.board",
    name: "board",
    puzzle: def,
    settings,
    controls: [
      { how: "type a name", what: "it counts as soon as it is spelled right" },
      { how: "give up", what: "end the game and see the ones you missed (tap twice)" },
    ],
    legend: [
      { sample: `<span style="display:inline-block;width:22px;height:22px;border-radius:4px;background:color-mix(in srgb, var(--accent) 16%, var(--cell));border:1px solid color-mix(in srgb, var(--accent) 45%, var(--border))"></span>`, meaning: "named" },
      { sample: `<span style="display:inline-block;width:22px;height:22px;border-radius:4px;background:var(--cell);border:1px dashed var(--danger)"></span>`, meaning: "missed, shown when the game ends" },
    ],
    mount(root, { session, settings }) {
      style("name-them-all", CSS);
      const d = dataset();
      const p = session.puzzle;
      const byId = new Map((d?.items() ?? []).map((it) => [it.id, it]));
      const pool = p.pool.map((id) => byId.get(id)).filter((x): x is PokemonItem => !!x);
      const index = nameIndex(pool);
      const all = nameIndex(d?.items() ?? []);

      const input = h("input", {
        type: "text", placeholder: "type a pokémon", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
        "aria-label": "pokémon name", enterkeyhint: "done",
      });
      const count = h("span", { class: "nta-count", "aria-live": "off" });
      const clock = h("span", { class: "nta-clock", hidden: !p.limitMs });
      const giveUp = h("button", { class: "nta-giveup", type: "button" }, "give up");
      const status = h("div", { class: "nta-status", "aria-live": "polite" });
      const scroll = h("div", { class: "nta-scroll" });
      const el = h("div", { class: "nta" }, h("div", { class: "nta-bar" }, input, count, clock, giveUp, status), scroll);
      root.append(el);

      // --- the board ---
      const slots = new Map<string, HTMLElement>();
      const heads: { el: HTMLElement; items: PokemonItem[] }[] = [];
      const sil = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const m = e.target as HTMLElement;
          const url = byId.get(m.dataset.id!) ? mediaUrl(byId.get(m.dataset.id!)!, "sprite") : null;
          if (url) m.style.setProperty("--m", `url("${url}")`);
          sil.unobserve(m);
        }
      }, { root: scroll, rootMargin: "300px" });
      for (const g of groups(pool, settings.group as Grouping, d!)) {
        const tally = h("span");
        const head = g.label ? h("h3", null, h("span", null, g.label), tally) : null;
        if (head) heads.push({ el: tally, items: g.items });
        const grid = h("div", { class: "nta-grid" }, g.items.map((it) => {
          const slot = h("div", { class: "nta-slot", "data-id": it.id, "aria-label": dex(it) });
          slots.set(it.id, slot);
          return slot;
        }));
        scroll.append(h("section", { class: "nta-group" }, head, grid));
      }
      const shown = new Map<string, string>();
      const paint = (it: PokemonItem, how: "open" | "named" | "missed") => {
        const slot = slots.get(it.id)!;
        if (shown.get(it.id) === how) return;
        shown.set(it.id, how);
        slot.className = `nta-slot${how === "open" ? "" : ` ${how}`}`;
        slot.replaceChildren();
        if (how === "open") {
          slot.setAttribute("aria-label", dex(it));
          if (p.slots === "number") slot.append(h("span", { class: "num" }, dex(it)));
          else if (p.slots === "silhouette") {
            const m = h("span", { class: "sil", "data-id": it.id });
            slot.append(m);
            sil.observe(m);
          }
          return;
        }
        slot.setAttribute("aria-label", `${dex(it)} ${it.name}${how === "missed" ? ", missed" : ""}`);
        const url = mediaUrl(it, "sprite");
        if (url) slot.append(h("img", { loading: "lazy", decoding: "async", crossorigin: "anonymous", src: url, alt: "", draggable: "false" }));
        slot.append(h("span", { class: "nm", title: it.name }, it.name));
      };

      const render = () => {
        const s = session.state;
        const named = new Set(s.named);
        for (const it of pool) paint(it, named.has(it.id) ? "named" : s.ended ? "missed" : "open");
        count.replaceChildren(h("strong", null, String(s.named.length)), ` / ${p.pool.length}`);
        for (const g of heads) g.el.textContent = `${g.items.filter((it) => named.has(it.id)).length}/${g.items.length}`;
        const over = isOver(p, s);
        input.disabled = over;
        giveUp.hidden = over;
        const f = session.activeHint?.focus as NameAllFocus | undefined;
        for (const [id, slot] of slots) slot.classList.toggle("focus", !!f?.ids.includes(id));
        if (f?.ids[0]) slots.get(f.ids[0])?.scrollIntoView({ block: "nearest" });
        tick();
      };

      // --- typing ---
      /** What was typed for a name accepted while it was still the start of another (Mew in Mewtwo). */
      let carried: string | null = null;
      const flash = (ids: readonly string[]) => {
        for (const id of ids) {
          const slot = slots.get(id);
          if (!slot) continue;
          slot.classList.remove("flash");
          void slot.offsetWidth;
          slot.classList.add("flash");
        }
      };
      const say = (it: PokemonItem | null, text: string) => {
        const url = it ? mediaUrl(it, "sprite") : null;
        status.replaceChildren(...(url ? [h("img", { src: url, crossorigin: "anonymous", alt: "" })] : []), text);
      };
      const onInput = () => {
        if (isOver(p, session.state)) return;
        const done = () => new Set(session.state.named);
        let text = input.value;
        let r = readTyped(text, index, all, done());
        if (carried !== null && !text.startsWith(carried)) carried = null;
        if (carried !== null && !r.name.length && !r.known.length && !r.longer) {
          // the player went on to another name: drop the one already counted
          text = text.slice(carried.length).replace(/^\s+/, "");
          input.value = text;
          carried = null;
          r = readTyped(text, index, all, done());
        }
        input.classList.toggle("outside", r.outside && !r.longer);
        if (r.name.length) {
          session.dispatch({ type: "name", ids: r.name });
          flash(r.name);
          const it = byId.get(r.name[0]!)!;
          say(it, it.name);
          if (r.longer) carried = text;
          else input.value = "";
        } else if (r.known.length) {
          flash(r.known);
          say(byId.get(r.known[0]!) ?? null, `${byId.get(r.known[0]!)?.name ?? ""}: already named`);
          if (!r.longer) input.value = "";
        } else if (r.outside && !r.longer) {
          status.replaceChildren("not in this round");
        }
      };
      input.addEventListener("input", onInput);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { input.value = ""; carried = null; input.classList.remove("outside"); }
        else if (e.key === "Enter") { e.preventDefault(); }
      });

      // --- giving up and the clock ---
      let armed: ReturnType<typeof setTimeout> | null = null;
      const disarm = () => { if (armed) clearTimeout(armed); armed = null; giveUp.classList.remove("armed"); giveUp.textContent = "give up"; };
      giveUp.addEventListener("click", () => {
        if (!armed) {
          giveUp.classList.add("armed");
          giveUp.textContent = "sure? tap again";
          armed = setTimeout(disarm, 3000);
          return;
        }
        disarm();
        session.dispatch({ type: "end" });
      });
      function tick() {
        if (!p.limitMs) return;
        const left = p.limitMs - session.elapsedMs();
        const over = isOver(p, session.state);
        clock.textContent = formatClock(p.limitMs - (session.finishedAtMs ?? session.elapsedMs()));
        clock.classList.toggle("low", !over && left <= 30_000);
        if (left <= 0 && !over) {
          session.dispatch({ type: "end" });
          status.replaceChildren("time's up");
        }
      }
      const timer = setInterval(tick, 250);

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
        session.hooks.solved.tap(render, { owner: "view" }),
      ];
      render();
      if (!isOver(p, session.state)) queueMicrotask(() => input.focus({ preventScroll: true }));

      const rects = (ids: Iterable<string>) => [...ids].flatMap((id) => { const r = slots.get(id)?.getBoundingClientRect(); return r ? [r] : []; });
      return {
        aspect: Math.min(1.6, Math.max(0.6, window.innerWidth / Math.max(1, window.innerHeight - 140))),
        locate: (focus) => rects((focus as NameAllFocus | undefined)?.ids ?? []),
        locateChange: (a, b) => {
          const x = a as NameAllState, y = b as NameAllState;
          const was = new Set(x.named);
          return rects(y.named.filter((id) => !was.has(id)));
        },
        destroy() {
          clearInterval(timer);
          disarm();
          sil.disconnect();
          offs.forEach((f) => f());
          el.remove();
        },
      };
    },
  };
}
