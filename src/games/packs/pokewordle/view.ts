import { h, style } from "../../core/dom";
import type { View } from "../../core/types";
import { VERDICT_CSS } from "../../lib/dataset/ui";
import { mediaUrl } from "../../lib/pokemon/media";
import type { PokemonDataset } from "../../lib/pokemon/types";
import {
  isOver, submitError, wordsOf,
  type WordleAction, type WordleFocus, type WordlePuzzle, type WordleState,
} from "./logic";

const FLIP_MS = 320, STAGGER_MS = 110;
const CSS = `
.pw { container-type: size; position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 6px; user-select: none; -webkit-user-select: none; }
.pw { --k: clamp(30px, 8.5cqh, 56px); --t: min(62px, calc((100cqw - (var(--L) - 1) * 5px) / var(--L)), calc((100cqh - 3 * var(--k) - 16px - 34px - 34px - (var(--G) - 1) * 5px) / var(--G))); }
.pw-grid { display: grid; grid-template-columns: repeat(var(--L), var(--t)); grid-auto-rows: var(--t); gap: 5px; margin-top: 34px; }
.pw-tile { display: flex; align-items: center; justify-content: center; border: 2px solid var(--border); border-radius: 4px; box-sizing: border-box; font: 700 calc(var(--t) * .52) var(--font); text-transform: uppercase; line-height: 1; }
.pw-tile.typed { border-color: var(--text-dim); animation: pw-pop .1s; }
.pw-tile.v-match, .pw-tile.v-partial, .pw-tile.v-miss { border-color: transparent; }
.pw-tile.flip { animation: pw-flip ${FLIP_MS}ms ease-in both; animation-delay: calc(var(--i) * ${STAGGER_MS}ms); }
.pw-tile.cursor { border-color: var(--focus); }
.pw-tile.focus { box-shadow: 0 0 0 2px var(--hint); }
.pw-row.focus .pw-tile { box-shadow: 0 0 0 2px var(--hint-soft, var(--hint)); }
.pw-row { display: contents; }
.pw-grid.shake { animation: pw-shake .35s; }
.pw-status { min-height: 34px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; text-align: center; }
.pw-status.err { color: var(--danger); }
.pw-status img { width: 40px; height: 40px; image-rendering: pixelated; }
.pw-status strong { font-size: 16px; }
.pw-status.end { animation: pw-in .25s both; }
@keyframes pw-in { from { opacity: 0; transform: translateY(4px); } }
.pw-kb { width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 5px; }
.pw-kb div { display: flex; gap: 4px; justify-content: center; }
.pw-kb button { flex: 1 1 0; min-width: 0; height: var(--k); padding: 0; border-radius: 5px; font: 600 15px var(--font); text-transform: uppercase; touch-action: manipulation; }
.pw-kb button.wide { flex: 1.6 1 0; font-size: 12px; text-transform: none; }
.pw { --verdict-miss-c: var(--verdict-miss, color-mix(in srgb, var(--text-dim) 65%, var(--bg))); }
.pw .v-miss { color: #fff; }
@keyframes pw-flip { 0% { transform: rotateX(0); background: transparent; color: var(--text); border-color: var(--text-dim); } 49% { transform: rotateX(90deg); background: transparent; color: var(--text); border-color: var(--text-dim); } 50% { transform: rotateX(90deg); } 100% { transform: rotateX(0); } }
@keyframes pw-pop { 0% { transform: scale(.9); } 100% { transform: scale(1); } }
@keyframes pw-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
`;

const KEYS = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"];
const CLS = ["v-miss", "v-partial", "v-match"] as const;

const tile = (cls: string, letter = "") => `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:3px;font:700 13px var(--font)" class="${cls}">${letter}</span>`;

export function makeView(def: { id: string }, dataset: () => PokemonDataset | undefined): View<WordlePuzzle, WordleState, WordleAction, null> {
  return {
    id: "pokewordle.board",
    name: "board",
    puzzle: def,
    controls: [
      { how: "type, or tap the keys", what: "spell a guess" },
      { how: "enter", what: "hand the guess in" },
    ],
    legend: [
      { sample: tile("v-match", "A"), meaning: "this letter is here in the name" },
      { sample: tile("v-partial", "B"), meaning: "the name has this letter somewhere else" },
      { sample: tile("v-miss", "C"), meaning: "the name doesn't have this letter (or not this many)" },
    ],
    mount(root, { session }) {
      style("pokewordle", CSS + VERDICT_CSS);
      const p = session.puzzle;
      const L = session.state.row.length;
      const words = (() => { const d = dataset(); return d ? wordsOf(d) : null; })();

      const grid = h("div", { class: "pw-grid", role: "grid", "aria-label": `${p.guesses} guesses of ${L} letters` });
      const rows: HTMLElement[][] = [];
      const rowEls: HTMLElement[] = [];
      for (let r = 0; r < p.guesses; r++) {
        const tiles = Array.from({ length: L }, () => h("span", { class: "pw-tile", role: "gridcell" }));
        const row = h("div", { class: "pw-row", role: "row" }, tiles);
        rows.push(tiles);
        rowEls.push(row);
        grid.append(row);
      }
      const status = h("div", { class: "pw-status", role: "status", "aria-live": "polite" });
      const keys = new Map<string, HTMLButtonElement>();
      const kb = h("div", { class: "pw-kb" }, KEYS.map((line) => h("div", null, line.split("").map((k) => {
        const label = k === "+" ? "enter" : k === "-" ? "⌫" : k;
        const b = h("button", { type: "button", class: k === "+" || k === "-" ? "wide" : undefined, "aria-label": k === "-" ? "delete" : label }, label);
        // a tapped key keeps no focus, so Enter afterwards hands the guess in rather than pressing the key again
        b.addEventListener("pointerdown", (e) => e.preventDefault());
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => press(k === "+" ? "Enter" : k === "-" ? "Backspace" : k));
        keys.set(k, b);
        return b;
      }))));
      const el = h("div", { class: "pw", style: `--L: ${L}; --G: ${p.guesses}` }, grid, status, kb);
      root.append(el);

      let message: { text: string; err: boolean } | null = null;
      /** The guess just handed in, whose tiles turn over one by one. */
      let flipping = -1;
      const render = () => {
        const s = session.state;
        const f = session.activeHint?.focus as WordleFocus | undefined;
        for (let r = 0; r < p.guesses; r++) {
          const g = s.done[r];
          const current = r === s.done.length && !isOver(p, s);
          rowEls[r]!.classList.toggle("focus", !!f?.rows.includes(r));
          rows[r]!.forEach((t, i) => {
            const ch = g ? g.word[i]! : current ? s.row[i]! : "";
            if (t.textContent !== ch) t.textContent = ch;
            t.className = `pw-tile${g ? ` ${CLS[g.marks[i]!]}` : ch ? " typed" : ""}${r === flipping ? " flip" : ""}${current && f?.slots.includes(i) ? " focus" : ""}${current && i === s.at ? " cursor" : ""}`;
            t.style.setProperty("--i", String(i));
            t.setAttribute("aria-label", g ? `${ch}, ${["not in the name", "elsewhere", "right"][g.marks[i]!]}` : ch || "empty");
          });
        }
        const best = new Map<string, number>();
        for (const g of s.done) g.word.split("").forEach((c, i) => best.set(c, Math.max(best.get(c) ?? -1, g.marks[i]!)));
        for (const [k, b] of keys) {
          const m = best.get(k);
          b.className = `${k === "+" || k === "-" ? "wide" : ""}${m === undefined ? "" : ` ${CLS[m]}`}`;
        }
        status.className = "pw-status";
        status.replaceChildren();
        if (isOver(p, s) || session.finished) {
          // the answer appears once the last guess has turned over
          status.className = "pw-status end";
          status.style.animationDelay = flipping === s.done.length - 1 ? `${L * STAGGER_MS + FLIP_MS}ms` : "0ms";
          const it = words?.byId.get(p.answer);
          const url = it ? mediaUrl(it, "sprite") : null;
          status.append(...(url ? [h("img", { src: url, crossorigin: "anonymous", alt: "" })] : []), h("strong", null, it?.name ?? ""));
        } else if (message) {
          status.classList.toggle("err", message.err);
          status.append(message.text);
        }
      };

      const type = (a: WordleAction) => { session.dispatch(a); };
      const press = (key: string) => {
        if (session.finished || isOver(p, session.state)) return;
        message = null;
        if (key === "Enter") {
          const why = words ? submitError(words, p, session.state) : "the pokémon data pack isn't loaded";
          if (why) {
            message = { text: why, err: true };
            grid.classList.remove("shake");
            void grid.offsetWidth;
            grid.classList.add("shake");
            render();
            return;
          }
          if (session.dispatch({ type: "submit" })) flipping = session.state.done.length - 1;
        } else if (key === "Backspace") type({ type: "back" });
        else if (/^[a-z]$/i.test(key)) type({ type: "letter", ch: key.toLowerCase() });
        render();
      };
      // While the board is up, letters, Backspace and Enter spell the guess wherever focus is, ahead of
      // the page's own one-key shortcuts (the keybinds hub listens on window, after this). Text boxes
      // keep their keys, and so does a control reached with the keyboard (Enter presses it).
      const onKey = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
        if (!(e.key === "Enter" || e.key === "Backspace" || /^[a-z]$/i.test(e.key))) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        if (e.key === "Enter" && t && t !== document.body && !el.contains(t) && t.matches(":focus-visible")) return;
        if (!el.isConnected || session.finished || isOver(p, session.state)) return;
        e.preventDefault();
        e.stopPropagation();
        press(e.key);
      };
      document.addEventListener("keydown", onKey, { capture: true });

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
        session.hooks.solved.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (f: WordleFocus) => [
        ...f.rows.flatMap((r) => rows[r] ? [rows[r]!.map((t) => t.getBoundingClientRect())].map((rs) => new DOMRect(rs[0]!.left, rs[0]!.top, rs[rs.length - 1]!.right - rs[0]!.left, rs[0]!.height)) : []),
        ...f.slots.flatMap((i) => { const t = rows[session.state.done.length]?.[i]; return t ? [t.getBoundingClientRect()] : []; }),
      ];
      return {
        endDelayMs: L * STAGGER_MS + FLIP_MS,
        aspect: (() => {
          // the board's shape as drawn at the width it is likely to get: tiles, status line, keyboard
          const w = Math.min(560, window.innerWidth - 24);
          const t = Math.min(62, (w - (L - 1) * 5) / L);
          const k = Math.min(56, Math.max(30, 0.085 * window.innerHeight));
          return Math.min(1.2, Math.max(0.5, w / (p.guesses * (t + 5) + 84 + 3 * (k + 5))));
        })(),
        locate: (focus) => rects((focus as WordleFocus | undefined) ?? { slots: [], rows: [] }),
        locateChange: (a, b) => {
          const x = a as WordleState, y = b as WordleState;
          if (y.done.length > x.done.length) return rects({ slots: [], rows: [y.done.length - 1] });
          const changed = y.row.flatMap((c, i) => (c !== x.row[i] ? [i] : []));
          return rects({ slots: changed, rows: [] });
        },
        destroy() {
          document.removeEventListener("keydown", onKey, { capture: true });
          offs.forEach((f) => f());
          el.remove();
        },
      };
    },
  };
}

