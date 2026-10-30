import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, inputIs, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { sprite } from "../../lib/pokemon/ui";
import { alreadyGuessed, board, found, groupSize, isLost, isOver, mistakesMade, needDataset, oneAway, TIER_COLORS, type ConnAction, type ConnInteraction, type ConnPuzzle, type ConnState, type Dataset } from "./logic";

const CSS = `
.pkc { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 6px; container-type: size; user-select: none; -webkit-user-select: none; }
.pkc-board { flex: 1; min-height: 0; display: grid; gap: 6px; }
.pkc-group { border-radius: 8px; color: #111; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2px 6px; min-height: 0; overflow: hidden; }
.pkc-group b { font-size: clamp(12px, 3.6cqmin, 18px); text-transform: uppercase; letter-spacing: .02em; }
.pkc-group span { font-size: clamp(10px, 2.8cqmin, 14px); }
.pkc-group.missed { opacity: .75; outline: 2px dashed rgb(0 0 0 / .35); outline-offset: -4px; }
.pkc-tile { min-width: 0; min-height: 0; border-radius: 8px; border: none; background: var(--surface-2, var(--cell)); color: var(--text); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2px; font: inherit; overflow: hidden; transition: transform .1s; }
.pkc-tile img, .pkc-tile .pk-sprite { width: 80%; flex: 1; min-height: 0; }
.pkc-tile .nm { font-size: clamp(9px, 2.6cqmin, 14px); font-weight: 600; line-height: 1.1; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pkc.names-only .pkc-tile .nm { white-space: normal; overflow-wrap: anywhere; font-size: clamp(10px, 3.2cqmin, 17px); }
.pkc-tile.sel { background: color-mix(in srgb, var(--text) 75%, var(--bg)); color: var(--bg); }
.pkc-tile:disabled { cursor: default; }
${inputIs("keyboard")} .pkc-tile.cur { outline: 3px solid var(--focus); outline-offset: -2px; }
.pkc-tile.shake { animation: pkc-shake .35s; }
@keyframes pkc-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.pkc-status { flex: none; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 22px; font-size: 14px; color: var(--text-dim); }
.pkc-dots { display: inline-flex; gap: 5px; }
.pkc-dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--text-dim); }
.pkc-dots i.used { background: transparent; border: 1px solid var(--border); box-sizing: border-box; }
.pkc-note { color: var(--text); font-weight: 600; }
.pkc-bar { flex: none; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
.pkc-bar button { border-radius: 99px; padding: 6px 16px; font: inherit; }
`;

const BINDINGS = {
  "pokemon-connections.left": { label: "tile to the left", category: "pokémon connections", keys: ["ArrowLeft"] },
  "pokemon-connections.right": { label: "tile to the right", category: "pokémon connections", keys: ["ArrowRight"] },
  "pokemon-connections.up": { label: "tile above", category: "pokémon connections", keys: ["ArrowUp"] },
  "pokemon-connections.down": { label: "tile below", category: "pokémon connections", keys: ["ArrowDown"] },
  "pokemon-connections.toggle": { label: "select or deselect", category: "pokémon connections", keys: ["space"] },
  "pokemon-connections.submit": { label: "submit", category: "pokémon connections", keys: ["Enter"], description: "hand in the selected pokémon as a group" },
  "pokemon-connections.shuffle": { label: "shuffle", category: "pokémon connections", keys: ["s"] },
  "pokemon-connections.deselect": { label: "deselect all", category: "pokémon connections", keys: ["Escape", "d"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const settings = defineSchema({
  tiles: {
    type: "enum", label: "tiles show", default: "both",
    options: [{ value: "both", label: "picture and name" }, { value: "names", label: "names only" }, { value: "sprites", label: "pictures only" }],
  },
});

const swatch = (tier: number) => `<svg viewBox="0 0 30 14"><rect x="1" y="1" width="28" height="12" rx="3" fill="${TIER_COLORS[tier]}"/></svg>`;

export function connectionsView(get: Dataset): View<ConnPuzzle, ConnState, ConnAction, ConnInteraction, typeof settings> {
  return {
    id: "pokemon-connections.tiles",
    name: "tiles",
    puzzle: { id: "pokemon-connections" },
    settings,
    controls: [
      { how: "click or tap pokémon", what: "select them (again to deselect)" },
      { how: "submit", what: "hand in the selected pokémon as a group" },
    ],
    legend: [
      { sample: swatch(0) + swatch(1) + swatch(2) + swatch(3), meaning: "groups found, easiest (yellow) to hardest (purple)" },
      { sample: `<svg viewBox="0 0 30 14"><rect x="1" y="1" width="28" height="12" rx="3" fill="${TIER_COLORS[3]}" opacity=".75" stroke="rgb(0 0 0 / .35)" stroke-dasharray="2 1.5"/></svg>`, meaning: "a group you didn't find, shown at the end" },
      { sample: `<svg viewBox="0 0 30 14"><circle cx="7" cy="7" r="4" fill="var(--text-dim)"/><circle cx="18" cy="7" r="3.5" fill="none" stroke="var(--border)"/></svg>`, meaning: "mistakes left, and used" },
    ],
    mount(root, { session, settings: opts }) {
      style("pokemon-connections", CSS);
      const p = session.puzzle;
      const bd = board(needDataset(get), p);
      const k = groupSize(p);
      const el = h("div", { class: `pkc${opts.tiles === "names" ? " names-only" : ""}` });
      const grid = h("div", { class: "pkc-board", style: `grid-template-columns: repeat(${k}, minmax(0, 1fr)); grid-template-rows: repeat(${p.groups.length}, minmax(0, 1fr))` });
      const status = h("div", { class: "pkc-status", "aria-live": "polite" });
      const btn = (label: string, command: string, run: () => void) => h("button", { type: "button", "data-command": command, onclick: run }, label);
      const shuffleB = btn("shuffle", "pokemon-connections.shuffle", () => shuffle());
      const clearB = btn("deselect all", "pokemon-connections.deselect", () => deselect());
      const submitB = btn("submit", "pokemon-connections.submit", () => submit());
      submitB.classList.add("primary");
      el.append(grid, status, h("div", { class: "pkc-bar" }, shuffleB, clearB, submitB));
      root.append(el);

      const tiles = new Map<string, HTMLButtonElement>();
      for (const id of p.items) {
        const it = bd.byId.get(id);
        const t = h("button", { type: "button", class: "pkc-tile", "data-id": id, "aria-pressed": "false" },
          it && opts.tiles !== "names" ? sprite(it, { size: 96 }) : null,
          opts.tiles !== "sprites" ? h("span", { class: "nm" }, it?.name ?? id) : null);
        if (opts.tiles === "sprites") t.setAttribute("aria-label", it?.name ?? id);
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
          return h("div", { class: `pkc-group${order.includes(g) ? "" : " missed"}`, style: `grid-column: 1 / -1; background: ${TIER_COLORS[grp.tier] ?? TIER_COLORS[0]}` },
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
        const note = fin ? null : sel.length === k && alreadyGuessed(st, sel) ? "already guessed" : oneAway(p, st) && st.guesses.length === lastSeen ? "one away…" : null;
        status.replaceChildren(
          h("span", null, "mistakes left"),
          h("span", { class: "pkc-dots", "aria-label": String(Math.max(0, left)) }, Array.from({ length: p.mistakes }, (_, i) => h("i", { class: i < left ? undefined : "used" }))),
          ...(note ? [h("span", { class: "pkc-note" }, note)] : []),
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
        const t = (e.target as Element).closest<HTMLElement>(".pkc-tile");
        if (t?.dataset.id) toggle(t.dataset.id);
      };
      grid.addEventListener("click", onClick);

      const move = (d: number, rows: boolean) => () => session.setInteraction((i) => {
        const n = live().length;
        if (!n) return i;
        const step = rows ? d * k : d;
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
        aspect: k / (p.groups.length * (opts.tiles === "names" ? 0.55 : 0.95) + 0.9),
        endDelayMs: 500,
        commands: bindCommands(BINDINGS, {
          "pokemon-connections.left": move(-1, false),
          "pokemon-connections.right": move(1, false),
          "pokemon-connections.up": move(-1, true),
          "pokemon-connections.down": move(1, true),
          "pokemon-connections.toggle": () => { const id = live()[session.interaction.cursor]; if (id) toggle(id); },
          "pokemon-connections.submit": submit,
          "pokemon-connections.shuffle": shuffle,
          "pokemon-connections.deselect": deselect,
        }, {
          "pokemon-connections.toggle": { menu: "board" },
          "pokemon-connections.submit": { menu: "board", when: () => !over() && session.interaction.selected.length === k },
          "pokemon-connections.shuffle": { menu: "board", when: () => !over() },
          "pokemon-connections.deselect": { menu: "board", when: () => session.interaction.selected.length > 0 },
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
          el.remove();
        },
      };
    },
  };
}
