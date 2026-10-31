import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { clear, h, style } from "../../core/dom";
import type { CommandDef, DataAttribute, DataItem, DataValue, Dataset, PuzzleRef, View } from "../../core/types";
import { formatValue, type Feedback } from "../../lib/dataset/compare";
import { applyLook } from "../../lib/dataset/look";
import { VERDICT_CSS, arrow, nameEntry, verdictClass } from "../../lib/dataset/ui";
import { CLUE_CSS, pictureClue, soundClue, textClue, type PictureClue } from "./clue";
import { givenLabel, guessError, revealText } from "./def";
import {
  board, currentRound, easeLevel, foundCount, guessesOf, inRounds, isOpen, isOver, kind, revealsShown, roundOver, shownAnswers, EARLIER, LATER, NEAR,
  type Mark, type WordleAction, type WordleFocus, type WordleInteraction, type WordlePuzzle, type WordleState,
} from "./engine";
import type { Entry, Kind } from "./kinds";
import { ABSENT, BLANK, ELSEWHERE, RIGHT } from "./marks";
import { POSITIONAL, spelled, symbolsName, type DataSource, type Look } from "./params";

const FLIP_MS = 300, STAGGER_MS = 90;
/** Gap between tiles, and between boards. */
const GAP = 5, BOARD_GAP = 14;
/** Above this many boards, an overview of every board picks the one shown in full. */
const OVERVIEW = 32;

/** Peg colors for codes, as theme tokens (the palette every view shares). */
const PEG = (c: string) => `var(--guess-${c}, var(--palette-${((Number(c) - 1) % 8) + 1}))`;
/** Wordle's absent: a dark tile, unlike a tile not played yet. */
const ABSENT_C = "var(--verdict-miss, color-mix(in srgb, var(--text-dim) 70%, var(--bg)))";

const CSS = `
.wd { --verdict-miss-c: ${ABSENT_C}; width: 100%; height: 100%; display: flex; flex-direction: column; gap: 8px; min-height: 0; user-select: none; -webkit-user-select: none; }
.wd .v-miss { color: #fff; }
.wd-top { display: flex; gap: 8px; align-items: center; flex: none; min-height: 40px; padding-right: 40px; }
.wd-top .name-entry { flex: 1; max-width: none; }
.wd-status { color: var(--text-dim); white-space: nowrap; }
.wd-status.err { color: var(--danger); white-space: normal; }
.wd-target { font: 700 1.6em var(--font); }
.wd-boards { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; display: grid; gap: ${BOARD_GAP}px; align-content: start; justify-content: safe center; grid-template-columns: repeat(var(--bc, 1), max-content); }
.wd-board { display: flex; flex-direction: column; gap: 4px; align-items: center; border-radius: 10px; padding: 3px; }
.wd-board.pick { cursor: pointer; }
.wd-board[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: 1px; }
.wd-board.solved .wd-rows { opacity: .6; }
.wd-board.closed { opacity: .4; }
.wd-given { color: var(--text-dim); font-size: .9em; text-align: center; }
.wd-rows { display: grid; gap: ${GAP}px; grid-template-columns: var(--cols); align-items: stretch; justify-content: safe center; }
.wd-row { display: contents; }
.wd-t { display: flex; align-items: center; justify-content: center; width: var(--t); height: var(--t); box-sizing: border-box; border: 2px solid var(--border); border-radius: calc(var(--t) * .1); font: 700 calc(var(--t) * .52) var(--font); text-transform: uppercase; line-height: 1; }
.wd-t.move { width: calc(var(--t) * 1.7); text-transform: none; font-size: calc(var(--t) * .34); }
.wd-t.peg { border-radius: 50%; border-width: 3px; }
.wd-t.typed { border-color: var(--text-dim); }
.wd-t.v-match, .wd-t.v-partial, .wd-t.v-miss, .wd-t.v-near { border-color: transparent; }
.wd-t.peg.v-match { box-shadow: inset 0 0 0 calc(var(--t) * .12) var(--verdict-match-c); }
.wd-t.peg.v-partial { box-shadow: inset 0 0 0 calc(var(--t) * .12) var(--verdict-near-c); }
.wd-t.peg.v-miss { box-shadow: none; }
.wd-t .dir { font-size: .6em; margin-left: 1px; }
.wd-t.flip { animation: wd-flip ${FLIP_MS}ms ease-in both; animation-delay: calc(var(--i) * ${STAGGER_MS}ms); }
.wd-t.v-near { background: color-mix(in srgb, var(--verdict-near-c) 55%, var(--verdict-miss-c)); color: #000; }
.wd-counts { display: flex; align-items: center; gap: calc(var(--t) * .1); min-width: calc(var(--t) * 1.6); padding: 0 calc(var(--t) * .15); font: 600 calc(var(--t) * .45) var(--font); }
.wd-counts i { width: calc(var(--t) * .3); height: calc(var(--t) * .3); border-radius: 50%; border: 1.5px solid var(--text); box-sizing: border-box; }
.wd-counts i.right { background: var(--text); }
.wd-counts i.else { background: var(--bg); }
.wd-name { position: sticky; left: 0; z-index: 1; background: var(--bg); display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 4.5em; max-width: 8em; font-size: .9em; line-height: 1.1; text-align: center; overflow: hidden; }
.wd-name img { width: 2.6em; height: 2.6em; image-rendering: pixelated; object-fit: contain; margin: -.3em 0 -.2em; }
.wd-name span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wd-a { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 3em; min-width: 5em; padding: 2px 4px; box-sizing: border-box; border-radius: 6px; line-height: 1.15; overflow-wrap: anywhere; }
.wd-a .ar { font-weight: 700; font-size: 1.15em; }
.wd-a .m.x { text-decoration: line-through; opacity: .6; }
.wd-a .chip { display: block; border-radius: 99px; padding: 0 7px; margin: 1px 0; color: #fff; text-shadow: 0 1px 1px rgb(0 0 0 / .6); }
.wd-a .chip.x { opacity: .75; text-decoration: line-through; text-decoration-thickness: 2px; }
.wd-a .slot-2 { box-shadow: 0 0 0 2px var(--verdict-match-c); } .wd-a .slot-1 { box-shadow: 0 0 0 2px var(--verdict-near-c); } .wd-a .slot-0 { opacity: .5; text-decoration: line-through; }
.wd-th { color: var(--text-dim); font-size: .9em; display: flex; align-items: end; justify-content: center; text-align: center; padding-bottom: 2px; }
.wd-row.answer > * { outline: 2px dashed var(--danger); outline-offset: -2px; }
.wd-row.hint > * { box-shadow: 0 0 0 2px var(--hint); }
.wd-row.new > .wd-a { animation: wd-flip .35s ease-out both; animation-delay: calc(var(--i) * 70ms); }
.wd-kb { flex: none; width: 100%; max-width: 560px; align-self: center; display: flex; flex-direction: column; gap: 5px; }
.wd-kb div { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; }
.wd-kb button { flex: 1 1 0; min-width: 2em; height: clamp(34px, 6.5vh, 54px); padding: 0 4px; border-radius: 6px; font: 600 1.05em var(--font); text-transform: uppercase; touch-action: manipulation; }
.wd-kb.moves button { flex: 0 1 auto; text-transform: none; min-width: 3.4em; }
.wd-kb button.wide { flex: 1.6 1 0; text-transform: none; font-size: .9em; }
.wd-kb button.peg { border-radius: 50%; flex: 0 0 auto; width: clamp(34px, 6.5vh, 54px); }
.wd-kb button.peg.v-miss { opacity: .35; }
.wd-over { flex: none; display: flex; flex-wrap: wrap; gap: 4px; max-height: 28%; overflow: auto; align-content: start; }
.wd-over button { display: flex; gap: 1px; padding: 3px; border-radius: 4px; background: var(--surface); border: 1px solid var(--border); }
.wd-over button[aria-pressed="true"] { outline: 2px solid var(--accent); }
.wd-over button i { width: 7px; height: 7px; border-radius: 1px; background: var(--border); }
.wd-over button i.v-match { background: var(--verdict-match-c); } .wd-over button i.v-partial { background: var(--verdict-near-c); }
/* a dataset's look (lib/dataset/look): its tokens, read here with these defaults */
.wd.has-look { padding: 10px; box-sizing: border-box; border-radius: 12px; color: var(--text); font-family: var(--font); --verdict-miss-c: var(--verdict-miss, ${ABSENT_C}); }
.has-look .wd-top { background: var(--panel-bg, transparent); border: var(--panel-border, none); border-radius: var(--panel-radius, 0); color: var(--panel-text, inherit); padding: 8px 48px 8px 10px; }
.has-look .wd-status { color: var(--panel-text, var(--text-dim)); }
.has-look .wd-a, .has-look .wd-name { border: var(--tile-border, none); border-radius: var(--tile-radius, 6px); box-shadow: var(--tile-shadow, none); min-width: 4.4em; min-height: 4.4em; }
.has-look .wd-a { color: var(--verdict-text, inherit); }
.has-look .wd-a.v-match, .has-look .wd-a.v-partial, .has-look .wd-a.v-miss, .has-look .wd-t[class*=v-] { text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 0 2px 0 #000; }
.has-look .wd-a { position: relative; }
.has-look .wd-a .ar { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 3.4em; line-height: 1; opacity: .3; }
.has-look .wd-a > :not(.ar) { position: relative; }
.has-look .wd-a .chip { border: 2px solid rgb(0 0 0 / .5); }
.has-look .wd-name { background: var(--tile-bg, var(--bg)); color: var(--tile-text, inherit); position: static; }
.has-look .wd-name img { width: 3em; height: 3em; }
.has-look .wd-th { color: var(--text); border-bottom: var(--head-bar, none); text-shadow: 0 2px 0 rgb(0 0 0 / .45); margin-bottom: 4px; }
.has-look .wd-t { border: var(--tile-border, 2px solid var(--border)); box-shadow: var(--tile-shadow, none); }
.has-look .wd-t:not([class*=v-]) { background: rgb(255 255 255 / .35); color: var(--tile-text, inherit); }
.has-look .wd-t.v-match, .has-look .wd-t.v-partial, .has-look .wd-t.v-miss { color: var(--verdict-text, #fff); }
.has-look .wd-given, .has-look .wd-answer { text-shadow: 0 2px 0 rgb(0 0 0 / .45); }
.has-look .wd-stage { border: var(--panel-border, none); box-sizing: border-box; background: var(--stage-bg, var(--wd-stage)); }
.has-look .wd-fact { background: var(--panel-bg, var(--surface-2)); color: var(--panel-text, inherit); }
@keyframes wd-flip { 0% { transform: rotateX(0); } 50% { transform: rotateX(90deg); } 100% { transform: rotateX(0); } }
@media (prefers-reduced-motion: reduce) { .wd-t.flip, .wd-row.new > .wd-a { animation: none; } }
`;

const BINDINGS = {
  "wordle.next-board": { label: "next board", category: "wordle", keys: ["PageDown", "alt+ArrowRight"] },
  "wordle.prev-board": { label: "previous board", category: "wordle", keys: ["PageUp", "alt+ArrowLeft"] },
  "wordle.name": { label: "type a guess", category: "wordle", keys: ["slash"], description: "move to the name box", hidden: true },
  "wordle.next": { label: "next round", category: "wordle", keys: ["Enter"], description: "after a round is found or missed" },
  "wordle.pass": { label: "give up on this round", category: "wordle", description: "show the answer (counts as missed)" },
  "wordle.play": { label: "play the sound", category: "wordle", keys: ["shift+Enter"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const tileSample = (bg: string, text = "", fg = "#fff", extra = "") => `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:4px;background:${bg};color:${fg};font:700 13px var(--font);${extra}">${text}</span>`;
const MATCH = "var(--verdict-match-c)", NEAR_C = "var(--verdict-near-c)";

/** What the marks on this puzzle's boards mean, and only those. */
function legendFor(data: DataSource, p: WordlePuzzle): { sample: string; meaning: string }[] {
  const s = p.s;
  const k = kind(data, p);
  const sym = symbolsName(s, data).replace(/s$/, "");
  const out: { sample: string; meaning: string }[] = [];
  if (spelled(s) && k.length) {
    const ab = s.secret === "codes" && s.symbols === "colors";
    const t = (bg: string, txt: string, fg = "#fff") => (ab ? tileSample(bg, "", fg, "border-radius:50%") : tileSample(bg, txt, fg));
    switch (s.marks) {
      case "positions":
        out.push({ sample: t(MATCH, "A"), meaning: `this ${sym} is in this place` });
        out.push({ sample: t(NEAR_C, "B", "#000"), meaning: `the answer has this ${sym} somewhere else (marked only as many times as it has it)` });
        out.push({ sample: t(ABSENT_C, "C"), meaning: `the answer doesn't have this ${sym} (or not this many)` });
        break;
      case "greens": case "killer":
        out.push({ sample: t(MATCH, "A"), meaning: `this ${sym} is in this place` });
        out.push({ sample: t(ABSENT_C, "C"), meaning: s.marks === "killer" ? "not here: elsewhere in the answer or not in it, you aren't told which" : "not here" });
        break;
      case "order":
        out.push({ sample: t(MATCH, "A"), meaning: `this ${sym} is in this place` });
        out.push({ sample: tileSample(ABSENT_C, "D▲"), meaning: `the answer's ${sym} here comes later (▲) or earlier (▼) in order` });
        break;
      case "warm":
        out.push({ sample: t(MATCH, "A"), meaning: `this ${sym} is in this place` });
        out.push({ sample: tileSample(`color-mix(in srgb, ${NEAR_C} 55%, ${ABSENT_C})`, "B", "#000"), meaning: `the answer's ${sym} here is within ${s.near} places of it in order` });
        out.push({ sample: t(ABSENT_C, "C"), meaning: "further than that" });
        break;
      case "counts":
        out.push({ sample: `<span style="display:inline-flex;gap:3px"><i style="width:11px;height:11px;border-radius:50%;background:var(--text);display:inline-block"></i><i style="width:11px;height:11px;border-radius:50%;border:1.5px solid var(--text);box-sizing:border-box;display:inline-block"></i></span>`, meaning: `filled: a ${sym} in the right place; hollow: one in the answer but elsewhere. not which ones` });
        break;
      case "shared":
        out.push({ sample: tileSample("transparent", "2", "var(--text)"), meaning: `how many ${sym}s the guess shares with the answer, wherever they are` });
        break;
      case "exact":
        out.push({ sample: tileSample("transparent", "2", "var(--text)"), meaning: `how many ${sym}s are in the right place; not which` });
        break;
    }
  }
  if (k.attrs.length) {
    out.push({ sample: tileSample(MATCH, "✓"), meaning: "this value is the answer's" });
    out.push({ sample: tileSample(NEAR_C, "~", "#000"), meaning: `${s.close.length ? "close, or " : ""}a list sharing some members but not all` });
    out.push({ sample: tileSample(ABSENT_C, "↑"), meaning: "wrong; the arrow says the answer's number is higher (↑) or lower (↓)" });
    out.push({ sample: `<span style="text-decoration:line-through;opacity:.6">fire</span>`, meaning: "a member of a list the answer doesn't have" });
    if (s.slots) out.push({ sample: `<span style="box-shadow:0 0 0 2px var(--verdict-near-c);padding:0 4px;border-radius:9px">fire</span>`, meaning: "lists in order: the answer has it, in the other slot (outlined green: this slot)" });
  }
  if (s.lies === "one") out.push({ sample: tileSample(NEAR_C, "?", "#000"), meaning: "one mark in every row is false, except on the row that finds the answer" });
  return out;
}

/** A dataset item's small picture, if its dataset has one (its first pixel-art image, else its first image). */
function picture(d: Dataset | undefined, it: DataItem | undefined): HTMLElement | null {
  const ms = Object.values(d?.media ?? {}).filter((m) => m.type === "image");
  const m = ms.find((x) => x.pixel) ?? ms[0];
  const url = it && m?.url(it);
  return url ? h("img", { src: url, crossorigin: "anonymous", alt: "", draggable: "false" }) : null;
}

const valueColor = (a: DataAttribute, v: string): string | undefined => a.values?.find((x) => x.value === v)?.color;

/** One attribute cell: the guess's value, marked. */
function attrCell(a: DataAttribute, v: DataValue, fb: Feedback | null, slots: number[] | null | undefined): HTMLElement {
  const el = h("div", { class: `wd-a ${fb ? verdictClass(fb) : ""}`, title: `${a.label}: ${formatValue(a, v)}` });
  if (a.kind === "set" && Array.isArray(v)) {
    const shared = new Set(fb?.shared ?? []);
    if (!v.length) el.append("none");
    (v as string[]).forEach((m, i) => {
      const label = a.values?.find((x) => x.value === m)?.label ?? m;
      const color = valueColor(a, m);
      const off = slots ? ` slot-${slots[i]}` : fb && !shared.has(m) ? " x" : "";
      el.append(color ? h("span", { class: `chip${off}`, style: `background: ${color}` }, label) : h("span", { class: `m${off}` }, label));
    });
    return el;
  }
  const ar = fb ? arrow(fb) : "";
  if (ar) el.append(h("span", { class: "ar", "aria-label": fb!.dir === "higher" ? "higher" : "lower" }, ar));
  const color = typeof v === "string" ? valueColor(a, v) : undefined;
  el.append(color ? h("span", { class: "chip", style: `background: ${color}` }, formatValue(a, v)) : h("span", null, formatValue(a, v)));
  return el;
}

const posClass = (x: number | undefined): string => (x === undefined ? "" : x === RIGHT ? "v-match" : x === ELSEWHERE ? "v-partial" : x === NEAR ? "v-near" : "v-miss");

export function wordleView(data: DataSource, puzzle: PuzzleRef): View<WordlePuzzle, WordleState, WordleAction, WordleInteraction> {
  return {
    id: "wordle.board",
    name: "board",
    puzzle,
    controls: (p) => {
      const k = kind(data, p);
      return [
        k.named
          ? { how: "type a name, then pick it from the list (or press enter)", what: "guess" }
          : { how: k.next([]) ? "tap the moves in order, then enter" : "type, or tap the keys, then enter", what: "guess" },
        ...(p.boards.length > 1 ? [{ how: "click or tap a board", what: "pick the board hard mode and hints follow" }] : []),
      ];
    },
    legend: (p) => legendFor(data, p),
    mount(root, { session }) {
      style("dataset-verdicts", VERDICT_CSS);
      style("wordle", CSS + CLUE_CSS);
      const p = session.puzzle;
      const k: Kind = kind(data, p);
      const s = p.s;
      const d = k.data;
      const many = p.boards.length > 1;
      const spell = spelled(s) && k.length > 0;
      const typed = !k.named;
      const peg = s.secret === "codes" && s.symbols === "colors";
      const moves = !!k.next([]);
      const target = p.boards[0]?.target;
      const overview = p.boards.length > OVERVIEW;
      const showsCounts = spell && !POSITIONAL.has(s.marks);
      const rounds = inRounds(p);
      const pictured = p.boards.some((b) => b.clue?.look);
      const cur = () => currentRound(p, session.state);
      const roundDone = () => rounds && roundOver(data, p, session.state, cur());

      const status = h("span", { class: "wd-status", role: "status", "aria-live": "polite" });
      const entry = k.named ? nameEntry<DataItem>({
        items: () => k.named!,
        pick: (it) => submit({ item: it.id }),
        used: (it) => guessesOf(p, session.state, rounds ? cur() : 0).some((g) => g.item === it.id),
        // a picture by each name would give a picture clue away
        icon: (it) => (pictured ? null : picture(d, it)),
        placeholder: `guess ${d?.noun ? `a ${d.noun.one}` : "one"}`,
      }) : null;
      const nextBtn = h("button", { type: "button", class: "primary", "data-command": "wordle.next", onclick: () => session.dispatch({ type: "next" }) }, "next round");
      const passBtn = h("button", { type: "button", "data-command": "wordle.pass", onclick: () => session.dispatch({ type: "pass" }) }, "give up");
      const top = h("div", { class: "wd-top" }, target !== undefined ? h("span", { class: "wd-target", title: "the number to reach" }, `= ${target}`) : null, entry?.el ?? null, rounds ? passBtn : null, rounds ? nextBtn : null, status);
      const over = overview ? h("div", { class: "wd-over", role: "group", "aria-label": "boards, closest to found first" }) : null;
      const boardsEl = h("div", { class: "wd-boards" });
      const kb = typed ? h("div", { class: `wd-kb${moves ? " moves" : ""}` }) : null;
      const el = h("div", { class: "wd" }, top, over, boardsEl, kb);
      root.append(el);
      const unlook = applyLook(d, el);

      let message: { text: string; err: boolean } | null = null;
      let flipping = -1;

      const select = (b: number) => {
        if (b < 0 || b >= p.boards.length || !isOpen(data, p, session.state, b)) return;
        session.setInteraction((i) => ({ ...i, board: b }));
      };
      const shownBoard = () => Math.min(session.interaction.board, p.boards.length - 1);

      const submit = (e: Entry): boolean => {
        const why = guessError(data, p, session.state, e, shownBoard());
        if (why) { message = { text: why, err: true }; render(); return false; }
        message = null;
        const n = session.state.guesses.length;
        session.dispatch({ type: "guess", entry: e, board: shownBoard() } as WordleAction);
        if (session.state.guesses.length > n) flipping = n;
        entry?.clear();
        render();
        return true;
      };
      const press = (key: string) => {
        if (session.finished || isOver(data, p, session.state)) return;
        message = null;
        if (key === "Enter" && roundDone()) { session.dispatch({ type: "next" }); render(); return; }
        if (key === "Enter") {
          const row = session.state.row;
          if (row.some((c) => c === "")) { message = { text: "not enough", err: true }; render(); return; }
          const why = guessError(data, p, session.state, { seq: row.slice() }, shownBoard());
          if (why) { message = { text: why, err: true }; render(); return; }
          const n = session.state.guesses.length;
          session.dispatch({ type: "submit", board: shownBoard() } as WordleAction);
          if (session.state.guesses.length > n) flipping = n;
        } else if (key === "Backspace") session.dispatch({ type: "back" });
        else session.dispatch({ type: "type", sym: key });
        render();
      };

      // --- one board ---
      const tileOf = (sym: string, x: number | undefined, extra: string): HTMLElement => {
        const t = h("span", { class: `wd-t ${posClass(x)}${peg ? " peg" : moves ? " move" : ""} ${extra}` });
        if (peg) {
          if (sym && sym !== BLANK) t.style.background = PEG(sym);
          if (x !== undefined) t.title = ["absent", "elsewhere", "right"][x] ?? "";
        } else {
          t.append(sym === BLANK ? "" : sym);
          if (x === EARLIER || x === LATER) t.append(h("span", { class: "dir", "aria-label": x === EARLIER ? "the answer's is earlier" : "the answer's is later" }, x === EARLIER ? "▼" : "▲"));
        }
        return t;
      };
      const countsOf = (m: Mark | null): HTMLElement => {
        const el = h("span", { class: "wd-counts" });
        const c = m?.counts;
        if (!c) return el;
        el.title = s.marks === "counts" ? `${c[0]} right, ${c[1]} elsewhere` : s.marks === "shared" ? `${c[0]} shared` : `${c[0]} right`;
        if (s.marks === "counts") {
          for (let i = 0; i < c[0]!; i++) el.append(h("i", { class: "right" }));
          for (let i = 0; i < c[1]!; i++) el.append(h("i", { class: "else" }));
          if (!c[0] && !c[1]) el.append("0");
        } else el.append(String(c[0]));
        return el;
      };

      /** Boards too many to show every row at a readable size show only the rows played and the one being typed. */
      let compact = false;
      /** Rows each board shows: every guess allowed when they fit (Wordle's empty rows), else the guesses so far and the one being typed. */
      const rowsPerBoard = (full = !compact): number => {
        const st = session.state;
        const n = guessesOf(p, st, rounds ? cur() : 0).length;
        if (k.attrs.length || !spell) return n + 1;
        if (full && s.limit && s.limit <= 21) return Math.max(s.limit, n) + (isOver(data, p, st) || roundDone() ? 1 : 0);
        return n + 2;
      };

      // --- clues: kept per board across renders, so a picture loads once and eases in place ---
      type Stage = { el: HTMLElement; pic?: PictureClue; sound?: ReturnType<typeof soundClue>; level: number; whole: boolean };
      const stages = new Map<number, Stage>();
      const answerItem = (b: number) => { const id = p.boards[b]!.answers[0]?.item; return id ? k.itemOf(id) : undefined; };
      const boardOver = (b: number) => board(data, p, session.state, b).solvedAt >= 0 || (rounds ? roundOver(data, p, session.state, b) : isOver(data, p, session.state));
      const stageOf = (b: number): Stage | null => {
        const c = p.boards[b]!.clue;
        const it = answerItem(b);
        if (!c || !it || !d) return null;
        let x = stages.get(b);
        if (!x) {
          const el = h("div", { class: "wd-stage" });
          x = { el, level: -1, whole: false };
          const m = c.id.startsWith("media:") ? d.media?.[c.id.slice(6)] : undefined;
          if (m?.type === "image") { x.pic = pictureClue(m, it, (c.look ?? "whole") as Look, c.spot); el.append(x.pic.el); }
          else if (m) { x.sound = soundClue(m, it); el.classList.add("audio"); el.append(x.sound.el); }
          else { el.classList.add("text"); el.append(textClue(d, it, c.id.slice(5))); }
          stages.set(b, x);
        }
        const level = easeLevel(data, p, session.state, b), whole = boardOver(b);
        if (x.level !== level || x.whole !== whole) {
          const eased = x.level >= 0 && level > x.level && !whole;
          const acted = x.level >= 0;
          x.pic?.set(level, whole);
          x.sound?.show(level, whole);
          // a sound plays by itself once the player has done something (a browser won't play one before)
          if (x.sound && acted && !whole) x.sound.play();
          if (eased) { x.el.classList.remove("shake"); void x.el.offsetWidth; x.el.classList.add("shake"); }
          x.level = level; x.whole = whole;
        }
        return x;
      };
      const playSound = () => { const x = stages.get(rounds ? cur() : shownBoard()); x?.sound?.play(); };

      const renderBoard = (b: number): HTMLElement => {
        const st = session.state;
        const v = board(data, p, st, b);
        const open = isOpen(data, p, st, b);
        const done = isOver(data, p, st);
        const focus = session.activeHint?.focus as WordleFocus | undefined;
        const box = h("div", {
          class: `wd-board${many ? " pick" : ""}${v.solvedAt >= 0 ? " solved" : ""}${!open ? " closed" : ""}`,
          ...(many ? { "aria-pressed": String(shownBoard() === b), onclick: () => select(b) } : {}),
        });
        if (p.boards[b]!.given) box.append(h("div", { class: "wd-given" }, givenLabel(d?.attributes ?? [], p.boards[b]!.given)));
        if (!open) { box.append(h("div", { class: "wd-given" }, "opens once the board before it is found")); return box; }
        const stage = stageOf(b);
        if (stage) {
          stage.el.classList.toggle("small", many && !rounds && !overview);
          box.append(stage.el);
          const it = answerItem(b)!;
          if (boardOver(b)) box.append(h("div", { class: `wd-answer${v.solvedAt < 0 ? " miss" : ""}` }, it.name));
        }
        const facts = boardOver(b) ? p.s.reveals : revealsShown(data, p, st, b);
        const it = answerItem(b);
        if (facts.length && it && d) box.append(h("div", { class: "wd-facts" }, facts.map((id) => h("span", { class: "wd-fact" }, revealText(d.attributes, it, id)))));
        const cols: string[] = [];
        if (k.named) cols.push("auto");
        if (spell) for (let i = 0; i < k.length; i++) cols.push("auto");
        if (showsCounts) cols.push("auto");
        for (const _ of k.attrs) cols.push("minmax(5em, auto)");
        const rows = h("div", { class: "wd-rows", role: "table" });
        rows.style.setProperty("--cols", cols.join(" "));
        if (k.attrs.length) {
          if (k.named) rows.append(h("div", { class: "wd-th" }));
          if (spell) for (let i = 0; i < k.length; i++) rows.append(h("div", { class: "wd-th" }));
          if (showsCounts) rows.append(h("div", { class: "wd-th" }));
          for (const a of k.attrs) rows.append(h("div", { class: "wd-th", title: a.description ?? a.label }, a.label));
        }
        const row = (g: Entry | null, m: Mark | null, r: number, cls: string, typedRow?: string[]) => {
          const line = h("div", { class: `wd-row ${cls}${focus?.board === b && r >= 0 && focus.rows?.includes(r) ? " hint" : ""}`, role: "row" });
          if (k.named) {
            const it = g?.item ? k.itemOf(g.item) : undefined;
            line.append(h("div", { class: "wd-name" }, picture(d, it), h("span", null, it?.name ?? (g ? k.label(g) : ""))));
          }
          if (spell) {
            const q = typedRow ?? (g ? k.seqOf(g) ?? [] : []);
            for (let i = 0; i < k.length; i++) {
              const t = tileOf(q[i] ?? "", m?.pos?.[i], `${typedRow && q[i] ? "typed" : ""}${r === flipping && m ? " flip" : ""}`);
              t.style.setProperty("--i", String(i));
              line.append(t);
            }
          }
          if (showsCounts) line.append(countsOf(m));
          k.attrs.forEach((a, i) => {
            const c = attrCell(a, g ? k.valuesOf(g)?.[a.id] ?? null : null, m?.attrs?.[i] ?? null, m?.slots?.[i]);
            c.style.setProperty("--i", String(i));
            line.append(c);
          });
          rows.append(line);
        };
        // attribute tables read newest first, like a list; spellings fill down, like Wordle
        const shown = guessesOf(p, st, b).slice(0, v.marks.length).map((g, r) => ({ g, r }));
        const live = v.solvedAt < 0 && !done && !(rounds && roundOver(data, p, st, b));
        if (k.attrs.length) {
          if (boardOver(b) && v.solvedAt < 0) for (const a of shownAnswers(data, p, st, b)) row(a, null, -1, "answer");
          for (const { g, r } of shown.reverse()) row(g, v.marks[r]!, r, r === flipping ? "new" : "");
        } else {
          for (const { g, r } of shown) row(g, v.marks[r]!, r, "");
          if (live && typed) row(null, null, shown.length, "current", st.row);
          let n = shown.length + (live && typed ? 1 : 0);
          if (boardOver(b) && v.solvedAt < 0) for (const a of shownAnswers(data, p, st, b)) { row(a, null, -1, "answer"); n++; }
          // empty rows to fill, for spellings typed out (not for names picked from a list)
          if (live && typed) for (const want = rowsPerBoard(); n < want; n++) row(null, null, n, "");
        }
        box.append(rows);
        return box;
      };

      /** Tile size and boards per row that make every board fit, as large as allowed. */
      const fit = (count: number) => {
        if (k.attrs.length || !spell) { boardsEl.style.setProperty("--t", "2.6em"); boardsEl.style.setProperty("--bc", "1"); return; }
        const W = boardsEl.clientWidth || 600, H = boardsEl.clientHeight || 500;
        const unit = (moves ? 1.7 : 1) * k.length + (showsCounts ? 1.9 : 0);
        const solve = (rowsN: number) => {
          let best = { t: 0, bc: 1 };
          for (let bc = 1; bc <= count; bc++) {
            const br = Math.ceil(count / bc);
            const tw = ((W - (bc - 1) * BOARD_GAP) / bc - 8 - (k.length - 1) * GAP) / unit;
            const th = ((H - (br - 1) * BOARD_GAP) / br - 8 - (rowsN - 1) * GAP) / rowsN;
            const t = Math.min(62, tw, th);
            if (t > best.t) best = { t, bc };
          }
          return best;
        };
        const extra = p.boards[0]?.given ? 0.8 : 0;
        let best = solve(rowsPerBoard(true) + extra);
        compact = best.t < 18;
        if (compact) best = solve(rowsPerBoard(false) + extra);
        if (best.t < 18) {
          // too many to fit: a readable size, as many per row as the width takes, and the rest scrolls
          const t = 18;
          best = { t, bc: Math.max(1, Math.min(count, Math.floor((W + BOARD_GAP) / (unit * t + (k.length - 1) * GAP + 8 + BOARD_GAP)))) };
        }
        boardsEl.style.setProperty("--t", `${Math.floor(best.t)}px`);
        boardsEl.style.setProperty("--bc", String(best.bc));
      };

      // --- keyboard ---
      const keyMarks = (): Map<string, number> => {
        // the best mark each symbol has had on the shown board (false marks would mislead, so none then)
        const best = new Map<string, number>();
        if (!spell || !POSITIONAL.has(s.marks) || s.lies === "one" || s.marks === "order") return best;
        const v = board(data, p, session.state, shownBoard());
        const rank = (x: number) => (x === RIGHT ? 3 : x === ELSEWHERE || x === NEAR ? 2 : x === ABSENT ? 1 : 0);
        v.marks.forEach((m, r) => (k.seqOf(session.state.guesses[r]!) ?? []).forEach((c, i) => {
          const x = m.pos?.[i];
          if (x !== undefined && (best.get(c) === undefined || rank(x) > rank(best.get(c)!))) best.set(c, x);
        }));
        return best;
      };
      const renderKeys = () => {
        if (!kb) return;
        clear(kb);
        const st = session.state;
        const at = st.row.indexOf("");
        const next = k.next(st.row.slice(0, at < 0 ? st.row.length : at));
        const marks = keyMarks();
        const key = (sym: string, label = sym, cls = "") => {
          const b = h("button", { type: "button", class: `${cls} ${posClass(marks.get(sym))}`, "aria-label": label === "⌫" ? "delete" : label });
          if (peg && /^\d+$/.test(sym)) { b.classList.add("peg"); b.style.background = PEG(sym); b.title = `color ${sym}`; }
          else b.append(label);
          // a tapped key keeps no focus, so Enter afterwards hands the guess in rather than pressing the key again
          b.addEventListener("pointerdown", (e) => e.preventDefault());
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => press(sym));
          return b;
        };
        const rows = next ? [next.slice()] : k.keys.map((r) => r.slice());
        kb.append(...rows.map((r) => h("div", null, r.map((c) => (c === BLANK ? key(c, "blank", "wide") : key(c))))), h("div", null, key("Enter", "enter", "wide"), key("Backspace", "⌫", "wide")));
      };

      // --- a thousand boards ---
      const renderOverview = () => {
        if (!over) return;
        clear(over);
        // closest to found first; found boards leave (Kilordle)
        const known = p.boards.map((_, b) => {
          const v = board(data, p, session.state, b);
          const best = Array.from({ length: k.length }, (_, i) => Math.max(-1, ...v.marks.map((m) => (m.pos?.[i] === RIGHT ? 2 : m.pos?.[i] === ELSEWHERE ? 1 : -1))));
          return { b, v, best, score: best.reduce((n, x) => n + Math.max(0, x), 0) };
        }).filter((x) => x.v.solvedAt < 0).sort((x, y) => y.score - x.score || x.b - y.b);
        for (const x of known) {
          over.append(h("button", { type: "button", "aria-pressed": String(shownBoard() === x.b), title: `board ${x.b + 1}`, onclick: () => select(x.b) },
            x.best.map((m) => h("i", { class: m === 2 ? "v-match" : m === 1 ? "v-partial" : "" }))));
        }
      };

      const render = () => {
        const st = session.state;
        const done = isOver(data, p, st);
        entry?.setDisabled(done || session.locked);
        status.className = `wd-status${message?.err ? " err" : ""}`;
        const found = foundCount(data, p, st);
        const used = guessesOf(p, st, rounds ? cur() : 0).length;
        status.textContent = message?.text ?? [
          ...(rounds ? [s.streak ? `round ${cur() + 1}` : `round ${cur() + 1}/${p.boards.length}`] : []),
          ...(many ? [`${found}${rounds && s.streak ? "" : `/${p.boards.length}`} found`] : []),
          ...(s.limit && !done && !roundDone() ? [`${Math.max(0, s.limit - used)} left`] : []),
        ].join(" · ");
        if (rounds) {
          const over = roundDone();
          nextBtn.hidden = !over || done;
          passBtn.hidden = over || done;
          entry?.setDisabled(done || over || session.locked);
          if (entry) entry.el.hidden = over;
        }
        clear(boardsEl);
        if (overview && board(data, p, st, shownBoard()).solvedAt >= 0) {
          // the shown board was found: show the closest one left
          const next = p.boards.findIndex((_, b) => board(data, p, st, b).solvedAt < 0);
          if (next >= 0 && next !== shownBoard()) { select(next); return; }
        }
        const show = rounds ? [cur()] : overview ? [shownBoard()] : p.boards.map((_, b) => b);
        fit(show.length);
        for (const b of show) boardsEl.append(renderBoard(b));
        renderOverview();
        renderKeys();
        flipping = -1;
      };
      // a new size may change which rows fit, so the boards are drawn again
      let lastSize = "";
      const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
        const size = `${boardsEl.clientWidth}x${boardsEl.clientHeight}`;
        if (size !== lastSize) { lastSize = size; render(); }
      });
      ro?.observe(boardsEl);

      // While the board is up, typing spells the guess wherever focus is, ahead of the page's one-key
      // shortcuts. Text boxes keep their keys, and so does a control reached with the keyboard.
      const onKey = (e: KeyboardEvent) => {
        if (!typed || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        if (e.key === "Enter" && t && t !== document.body && !el.contains(t) && t.matches(":focus-visible")) return;
        if (!el.isConnected || session.finished || isOver(data, p, session.state)) return;
        const all = new Set(k.keys.flat());
        const at = session.state.row.indexOf("");
        const next = k.next(session.state.row.slice(0, at < 0 ? session.state.row.length : at));
        let key = e.key;
        if (peg && /^[0-9]$/.test(key)) key = key === "0" ? "10" : key;
        else if (/^[A-Z]$/.test(key) && !all.has(key)) key = key.toLowerCase();
        if (!(key === "Enter" || key === "Backspace" || all.has(key) || next?.includes(key))) return;
        e.preventDefault();
        e.stopPropagation();
        press(key);
      };
      document.addEventListener("keydown", onKey, { capture: true });

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();
      if (entry && !isOver(data, p, session.state)) entry.focus();

      const step = (dir: number) => {
        const open = p.boards.map((_, i) => i).filter((i) => isOpen(data, p, session.state, i));
        if (!open.length) return;
        const at = open.indexOf(session.interaction.board);
        select(open[(at + dir + open.length) % open.length]!);
      };
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "wordle.next-board": () => step(1),
        "wordle.prev-board": () => step(-1),
        "wordle.name": () => entry?.focus(),
        "wordle.next": () => session.dispatch({ type: "next" }),
        "wordle.pass": () => session.dispatch({ type: "pass" }),
        "wordle.play": playSound,
      }, {
        "wordle.next": { menu: "board", when: () => roundDone() && !isOver(data, p, session.state) },
        "wordle.pass": { menu: "board", danger: true, when: () => rounds && !roundDone() && !isOver(data, p, session.state) },
        "wordle.play": { menu: "board", captureInput: true, when: () => [...stages.values()].some((x) => x.sound) },
        "wordle.next-board": { captureInput: true, when: () => many && !rounds },
        "wordle.prev-board": { captureInput: true, when: () => many && !rounds },
        "wordle.name": { when: () => !!entry },
      });

      const rect = (e: Element | null | undefined) => (e ? [e.getBoundingClientRect()] : []);
      return {
        get aspect() {
          // the boards fill the space they get: rows grow down, and the keyboard sits below
          const w = innerWidth, hgt = innerHeight;
          return w < 700 ? Math.min(1, Math.max(0.45, w / Math.max(1, hgt - 140))) : many && !overview && !rounds ? 1.5 : k.attrs.length ? 1.3 : 0.85;
        },
        endDelayMs: spell ? k.length * STAGGER_MS + FLIP_MS : (k.attrs.length + 1) * 70 + 350,
        commands,
        target: () => ({ board: session.interaction.board }),
        locate: (focus) => {
          const f = focus as WordleFocus | undefined;
          return f ? rect(boardsEl.children[overview ? 0 : f.board]) : [];
        },
        locateChange: () => rect(boardsEl.children[overview ? 0 : shownBoard()]),
        destroy() {
          document.removeEventListener("keydown", onKey, { capture: true });
          for (const x of stages.values()) x.sound?.stop();
          ro?.disconnect();
          unlook();
          offs.forEach((f) => f());
          el.remove();
        },
      };
    },
  };
}
