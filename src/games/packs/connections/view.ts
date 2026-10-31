import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, inputIs, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { DataItem, Dataset, Media, View } from "../../core/types";
import { applyLook } from "../../lib/dataset/look";
import { alreadyGuessed, board, found, groupSize, isLost, isOver, mistakesMade, needDataset, oneAway, TIER_COLORS, type ConnAction, type ConnInteraction, type ConnPuzzle, type ConnState, type DataSource } from "./logic";

// tiles, selection and the status line read the dataset's look tokens (see DatasetLook), with the plain theme's as defaults
const CSS = `
.cn { width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; container-type: size; user-select: none; -webkit-user-select: none; color: var(--text); font-family: var(--font, inherit); }
.cn.has-look { padding: 10px; border-radius: 12px; }
.cn-board { flex: 1; min-height: 0; display: grid; gap: 6px; }
.cn-group { border-radius: var(--tile-radius, 8px); border: var(--tile-border, none); box-shadow: var(--tile-shadow, none); color: #111; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2px 6px; min-height: 0; overflow: hidden; }
.cn-group b { font-size: clamp(12px, 3.6cqmin, 18px); text-transform: uppercase; letter-spacing: .02em; }
.cn-group span { font-size: clamp(10px, 2.8cqmin, 14px); }
.cn-group.missed { opacity: .75; outline: 2px dashed rgb(0 0 0 / .35); outline-offset: -4px; }
.cn-tile { min-width: 0; min-height: 0; border-radius: var(--tile-radius, 8px); border: var(--tile-border, none); box-shadow: var(--tile-shadow, none); background: var(--tile-bg, var(--surface-2, var(--cell))); color: var(--tile-text, var(--text)); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2px; font: inherit; overflow: hidden; transition: transform .1s; }
.cn-tile .cn-pic { width: 80%; flex: 1; min-height: 0; object-fit: contain; }
.cn-tile .cn-pic.pixel { image-rendering: pixelated; }
.cn-tile .cn-pic.missing { display: flex; align-items: center; justify-content: center; font-size: 11px; opacity: .6; border: 1px dashed currentColor; border-radius: 6px; box-sizing: border-box; }
.cn-tile .nm { font-size: clamp(9px, 2.6cqmin, 14px); font-weight: 600; line-height: 1.1; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cn.names-only .cn-tile .nm { white-space: normal; overflow-wrap: anywhere; font-size: clamp(10px, 3.2cqmin, 17px); }
.cn-tile.sel { background: var(--panel-bg, color-mix(in srgb, var(--text) 75%, var(--bg))); color: var(--panel-text, var(--bg)); }
.cn-tile:disabled { cursor: default; }
${inputIs("keyboard")} .cn-tile.cur { outline: 3px solid var(--focus); outline-offset: -2px; }
.cn-tile.shake { animation: cn-shake .35s; }
@keyframes cn-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.cn-status { flex: none; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 22px; font-size: 14px; color: var(--text-dim); }
.cn.has-look .cn-bar { background: var(--panel-bg); border: var(--panel-border); border-radius: var(--panel-radius); padding: 6px 10px; }
.cn.has-look .cn-status { background: var(--panel-bg); color: var(--panel-text); border: var(--panel-border); border-radius: var(--panel-radius); padding: 4px 10px; }
.cn-dots { display: inline-flex; gap: 5px; }
.cn-dots i { width: 10px; height: 10px; border-radius: 50%; background: currentColor; }
.cn-dots i.used { background: transparent; border: 1px solid currentColor; opacity: .5; box-sizing: border-box; }
.cn-note { font-weight: 600; }
.cn-bar { flex: none; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
.cn-bar button { border-radius: 99px; padding: 6px 16px; font: inherit; }
`;

const BINDINGS = {
  "connections.left": { label: "tile to the left", category: "connections", keys: ["ArrowLeft"] },
  "connections.right": { label: "tile to the right", category: "connections", keys: ["ArrowRight"] },
  "connections.up": { label: "tile above", category: "connections", keys: ["ArrowUp"] },
  "connections.down": { label: "tile below", category: "connections", keys: ["ArrowDown"] },
  "connections.toggle": { label: "select or deselect", category: "connections", keys: ["space"] },
  "connections.submit": { label: "submit", category: "connections", keys: ["Enter"], description: "hand in the selected ones as a group" },
  "connections.shuffle": { label: "shuffle", category: "connections", keys: ["s"] },
  "connections.deselect": { label: "deselect all", category: "connections", keys: ["Escape", "d"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const settings = defineSchema({
  tiles: {
    type: "enum", label: "tiles show", default: "both",
    description: "on a dataset without pictures, names only",
    options: [{ value: "both", label: "picture and name" }, { value: "names", label: "names only" }, { value: "sprites", label: "pictures only" }],
  },
});

const swatch = (tier: number) => `<svg viewBox="0 0 30 14"><rect x="1" y="1" width="28" height="12" rx="3" fill="${TIER_COLORS[tier]}"/></svg>`;

/** The picture tiles show: a small one, so pixel art (a sprite) before smooth art; null when the dataset has none. */
function tileMedia(d: Dataset): Media | null {
  const ms = Object.values(d.media ?? {}).filter((m) => m.type === "image");
  return ms.find((m) => m.pixel) ?? ms[0] ?? null;
}

function pic(m: Media, it: DataItem): HTMLElement {
  const url = m.url(it);
  if (!url) return h("span", { class: "cn-pic missing", role: "img", "aria-label": it.name }, "no picture");
  return h("img", { class: `cn-pic${m.pixel ? " pixel" : ""}`, src: url, crossorigin: "anonymous", alt: it.name, decoding: "async", draggable: "false" });
}

export function connectionsView(data: DataSource): View<ConnPuzzle, ConnState, ConnAction, ConnInteraction, typeof settings> {
  return {
    id: "connections.tiles",
    name: "tiles",
    puzzle: { id: "connections" },
    settings,
    controls: [
      { how: "click or tap tiles", what: "select them (again to deselect)" },
      { how: "submit", what: "hand in the selected ones as a group" },
    ],
    legend: [
      { sample: swatch(0) + swatch(1) + swatch(2) + swatch(3), meaning: "groups found, easiest (yellow) to hardest (purple)" },
      { sample: `<svg viewBox="0 0 30 14"><rect x="1" y="1" width="28" height="12" rx="3" fill="${TIER_COLORS[3]}" opacity=".75" stroke="rgb(0 0 0 / .35)" stroke-dasharray="2 1.5"/></svg>`, meaning: "a group you didn't find, shown at the end" },
      { sample: `<svg viewBox="0 0 30 14"><circle cx="7" cy="7" r="4" fill="var(--text-dim)"/><circle cx="18" cy="7" r="3.5" fill="none" stroke="var(--border)"/></svg>`, meaning: "mistakes left, and used" },
    ],
    mount(root, { session, settings: opts }) {
      style("connections", CSS);
      const p = session.puzzle;
      const d = needDataset(data, p.dataset);
      const bd = board(d, p);
      const media = tileMedia(d);
      const show = media ? opts.tiles : "names";
      const k = groupSize(p);
      const el = h("div", { class: `cn${show === "names" ? " names-only" : ""}` });
      const grid = h("div", { class: "cn-board", style: `grid-template-columns: repeat(${k}, minmax(0, 1fr)); grid-template-rows: repeat(${p.groups.length}, minmax(0, 1fr))` });
      const status = h("div", { class: "cn-status", "aria-live": "polite" });
      const btn = (label: string, command: string, run: () => void) => h("button", { type: "button", "data-command": command, onclick: run }, label);
      const shuffleB = btn("shuffle", "connections.shuffle", () => shuffle());
      const clearB = btn("deselect all", "connections.deselect", () => deselect());
      const submitB = btn("submit", "connections.submit", () => submit());
      submitB.classList.add("primary");
      el.append(grid, status, h("div", { class: "cn-bar" }, shuffleB, clearB, submitB));
      root.append(el);
      const unlook = applyLook(d, el);

      const tiles = new Map<string, HTMLButtonElement>();
      for (const id of p.items) {
        const it = bd.byId.get(id);
        const t = h("button", { type: "button", class: "cn-tile", "data-id": id, "aria-pressed": "false" },
          it && media && show !== "names" ? pic(media, it) : null,
          show !== "sprites" ? h("span", { class: "nm" }, it?.name ?? id) : null);
        if (show === "sprites") t.setAttribute("aria-label", it?.name ?? id);
        t.title = it?.name ?? id;
        tiles.set(id, t);
      }

      const doneIds = () => new Set(found(p, session.state).flatMap((g) => p.groups[g]!.items));
      const live = () => (session.interaction.order ?? p.items).filter((id) => !doneIds().has(id));
      const over = () => isOver(p, session.state) || session.finished;

      const render = () => {
        const st = session.state;
        const fin = over();
        const order = found(p, st);
        const shown = fin && isLost(p, st) ? [...order, ...p.groups.map((_, g) => g).filter((g) => !order.includes(g))] : order;
        const bars = shown.map((g) => {
          const grp = p.groups[g]!;
          return h("div", { class: `cn-group${order.includes(g) ? "" : " missed"}`, style: `grid-column: 1 / -1; background: ${TIER_COLORS[grp.tier] ?? TIER_COLORS[0]}` },
            h("b", null, bd.links[g]!.label), h("span", null, grp.items.map((id) => bd.byId.get(id)?.name ?? id).join(", ")));
        });
        const rest = fin && isLost(p, st) ? [] : live();
        const sel = session.interaction.selected;
        const cur = Math.min(session.interaction.cursor, Math.max(0, rest.length - 1));
        grid.replaceChildren(...bars, ...rest.map((id, i) => {
          const t = tiles.get(id)!;
          const on = sel.includes(id);
          t.classList.toggle("sel", on);
          t.classList.toggle("cur", i === cur);
          t.setAttribute("aria-pressed", String(on));
          t.disabled = fin;
          return t;
        }));
        const left = p.mistakes - mistakesMade(p, st);
        const note = fin ? null : st.guesses.length === lastSeen && oneAway(p, st) ? "one away…" : sel.length === k && alreadyGuessed(st, sel) ? "already guessed" : null;
        status.replaceChildren(
          h("span", null, "mistakes left"),
          h("span", { class: "cn-dots", "aria-label": String(Math.max(0, left)) }, Array.from({ length: p.mistakes }, (_, i) => h("i", { class: i < left ? undefined : "used" }))),
          ...(note ? [h("span", { class: "cn-note" }, note)] : []),
        );
        submitB.disabled = fin || sel.length !== k || alreadyGuessed(st, sel);
        clearB.disabled = fin || !sel.length;
        shuffleB.disabled = fin;
      };
      // "one away" shows until the selection changes after the guess that earned it
      let lastSeen = session.state.guesses.length;

      const toggle = (id: string) => {
        if (over()) return;
        session.setInteraction((i) => {
          const on = i.selected.includes(id);
          if (!on && i.selected.length >= k) return i;
          return { ...i, selected: on ? i.selected.filter((x) => x !== id) : [...i.selected, id], cursor: Math.max(0, live().indexOf(id)) };
        });
        lastSeen = -1;
        render();
      };
      const deselect = () => { session.setInteraction((i) => ({ ...i, selected: [] })); };
      const shuffle = () => {
        const order = (session.interaction.order ?? p.items).slice();
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        session.setInteraction((i) => ({ ...i, order }));
      };
      const submit = () => {
        const sel = session.interaction.selected;
        if (over() || sel.length !== k || alreadyGuessed(session.state, sel)) return;
        const before = found(p, session.state).length;
        const ok = session.dispatch({ type: "guess", items: sel.slice() });
        if (!ok) return;
        lastSeen = session.state.guesses.length;
        if (found(p, session.state).length > before) session.setInteraction((i) => ({ ...i, selected: [], cursor: 0 }));
        else {
          for (const id of sel) {
            const t = tiles.get(id)!;
            t.classList.remove("shake");
            void t.offsetWidth;
            t.classList.add("shake");
          }
          render();
        }
      };

      const onClick = (e: MouseEvent) => {
        const t = (e.target as Element).closest<HTMLElement>(".cn-tile");
        if (t?.dataset.id) toggle(t.dataset.id);
      };
      grid.addEventListener("click", onClick);

      const move = (dir: number, rows: boolean) => () => session.setInteraction((i) => {
        const n = live().length;
        if (!n) return i;
        const step = rows ? dir * k : dir;
        const next = i.cursor + step;
        return { ...i, cursor: next < 0 || next >= n ? i.cursor : next };
      });

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      return {
        aspect: k / (p.groups.length * (show === "names" ? 0.55 : 0.95) + 0.9),
        endDelayMs: 500,
        commands: bindCommands(BINDINGS, {
          "connections.left": move(-1, false),
          "connections.right": move(1, false),
          "connections.up": move(-1, true),
          "connections.down": move(1, true),
          "connections.toggle": () => { const id = live()[session.interaction.cursor]; if (id) toggle(id); },
          "connections.submit": submit,
          "connections.shuffle": shuffle,
          "connections.deselect": deselect,
        }, {
          "connections.toggle": { menu: "board" },
          "connections.submit": { menu: "board", when: () => !over() && session.interaction.selected.length === k },
          "connections.shuffle": { menu: "board", when: () => !over() },
          "connections.deselect": { menu: "board", when: () => session.interaction.selected.length > 0 },
        }),
        target: () => live()[session.interaction.cursor] ?? null,
        locate: () => [],
        locateChange: (a, b) => {
          const x = a as ConnState, y = b as ConnState;
          const g = y.guesses[y.guesses.length - 1];
          return y.guesses.length > x.guesses.length && g ? g.flatMap((id) => (tiles.get(id)?.isConnected ? [tiles.get(id)!.getBoundingClientRect()] : [])) : [];
        },
        destroy() {
          offs.forEach((f) => f());
          unlook();
          el.remove();
        },
      };
    },
  };
}
