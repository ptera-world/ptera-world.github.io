import { bindCommands, bindingsOver, handlersOver, oneBased, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { guess, COLOUR_NAMES, canSubmit, isOver, type GuessAction, type GuessFocus, type GuessInteraction, type GuessPuzzle, type GuessState } from "./logic";

const FILLS = [
  "var(--cell)",
  "var(--guess-1, hsl(0 70% 55%))",
  "var(--guess-2, hsl(50 90% 55%))",
  "var(--guess-3, hsl(130 50% 45%))",
  "var(--guess-4, hsl(215 70% 55%))",
  "var(--guess-5, hsl(28 90% 55%))",
  "var(--guess-6, hsl(275 50% 55%))",
  "var(--guess-7, hsl(25 45% 38%))",
  "var(--guess-8, hsl(195 75% 72%))",
  "var(--guess-9, hsl(95 55% 70%))",
  "var(--guess-10, hsl(330 75% 75%))",
] as const;

const CSS = `
.guess-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.guess-board .row { fill: transparent; }
.guess-board .row.current { fill: color-mix(in srgb, var(--accent) 14%, transparent); }
.guess-board .hole { fill: var(--cell); stroke: var(--border); stroke-width: 0.3; }
.guess-board .peg { stroke: color-mix(in srgb, var(--text) 45%, transparent); stroke-width: 0.35; }
.guess-board .peg.selected { stroke: var(--focus); stroke-width: 0.9; }
.guess-board .num { fill: #000; opacity: 0.6; font: 600 3.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.guess-board .hold { fill: none; stroke: var(--text); stroke-width: 0.6; stroke-dasharray: 1 0.7; pointer-events: none; }
.guess-board .score { stroke: var(--border); stroke-width: 0.25; fill: var(--cell); }
.guess-board .score.black { fill: var(--text); stroke: var(--text); }
.guess-board .score.white { fill: var(--bg); stroke: var(--text); stroke-width: 0.4; }
.guess-board .submit { fill: transparent; stroke: var(--accent); stroke-width: 0.5; stroke-dasharray: 1 0.8; cursor: pointer; }
.guess-board .submit.ready { fill: color-mix(in srgb, var(--accent) 25%, transparent); stroke-dasharray: none; }
.guess-board .hidden { fill: var(--surface-2, var(--border)); }
.guess-board .q { fill: var(--text-dim); font: 600 4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.guess-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.8; pointer-events: none; }
.guess-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.5; }
.guess-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
.guess-board .preview { opacity: 0.5; }
.guess-board .faded { opacity: 0.25; }
${inputIs("pointer")} .guess-board .cursor { display: none; }
`;

const settings = defineSchema({
  numbers: { type: "bool", label: "number the colors on the pegs", default: false },
});

const P = 10;
const R = 3.6;
const TRAY = 12;
const GAP = 3;

const BINDINGS = {
  "guess.place": { label: "place color", category: "guess", keys: ["space"], description: "put the selected color in the selected position of your guess (again to take it out)" },
  "guess.submit": { label: "mark guess", category: "guess", keys: ["Enter"], description: "hand in the guess to be marked" },
  "guess.clear": { label: "clear peg", category: "guess", keys: ["Backspace", "Delete", "d"], description: "take the peg out of the selected position" },
  "guess.hold": { label: "hold peg", category: "guess", keys: ["h"], description: "keep the selected peg's color for your next guess, or stop keeping it" },
  "guess.prev-colour": { label: "previous color", category: "guess", keys: ["ArrowUp", "w"] },
  "guess.next-colour": { label: "next color", category: "guess", keys: ["ArrowDown", "s"] },
  "guess.left": { label: "previous position", category: "guess", keys: ["ArrowLeft", "a"] },
  "guess.right": { label: "next position", category: "guess", keys: ["ArrowRight"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

/** Digit keys put that color straight into the selected position (0 is color 10). */
const [, ...PEG_COLOURS] = COLOUR_NAMES;
const COLOURS = oneBased(PEG_COLOURS);
const DIGIT_BINDINGS = bindingsOver("guess.colour-", COLOURS, (c) => (
  { label: `place ${COLOUR_NAMES[c]}`, category: "guess", keys: [String(c % 10)], hidden: true }
));

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof DIGIT_BINDINGS> {}
}

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string, w = 10) => `<svg viewBox="-0.5 -0.5 ${w + 1} 11">${body}</svg>`;
  const peg = (c: number, cx = 5) => `<circle cx="${cx}" cy="5" r="${R}" fill="${FILLS[c]}" stroke="var(--text)" stroke-opacity="0.45" stroke-width="0.35"/>`;
  return [
    { sample: svg(peg(1) + peg(4, 15), 20), meaning: "pegs: the tray on the left holds every color" },
    { sample: svg(`<circle cx="5" cy="5" r="1.5" fill="var(--text)" stroke="var(--text)"/>`), meaning: "a black mark: one peg is the right color in the right place" },
    { sample: svg(`<circle cx="5" cy="5" r="1.5" fill="var(--bg)" stroke="var(--text)" stroke-width="0.4"/>`), meaning: "a white mark: one more peg is a right color, but in the wrong place" },
    { sample: svg(peg(3) + `<circle cx="5" cy="5" r="${R + 1}" fill="none" stroke="var(--text)" stroke-width="0.6" stroke-dasharray="1 0.7"/>`), meaning: "a held peg: it stays for your next guess" },
    { sample: svg(`<rect x="1" y="1" width="8" height="8" rx="2" fill="color-mix(in srgb, var(--accent) 25%, transparent)" stroke="var(--accent)" stroke-width="0.5"/>`), meaning: "mark: click here when your guess is complete" },
    { sample: svg(peg(2) + `<circle cx="5" cy="5" r="${R}" fill="none" stroke="var(--focus)" stroke-width="0.9"/>`), meaning: "the selected color" },
    { sample: svg(peg(5) + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.8"/>`), meaning: "hint: a peg it sets" },
    { sample: svg(`<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.5" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the guesses behind it" },
  ];
}

export function guessView(): View<GuessPuzzle, GuessState, GuessAction, GuessInteraction, typeof settings> {
  return {
    id: "guess.svg",
    name: "board",
    puzzle: guess,
    settings,
    controls: [
      { how: "click or tap a color in the tray, then a position in your guess", what: "put that color there (again to take it out)" },
      { how: "drag a peg from the tray or an earlier guess onto your guess", what: "put that color there; drag a peg off your guess to remove it" },
      { how: "right-click a peg in your guess, or hold it on a touch screen", what: "hold it: it stays for your next guess" },
      { how: "click the box at the end of your guess", what: "hand it in to be marked" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("guess", CSS);
      const p = session.puzzle;
      const rowsN = Math.max(p.guesses + 1, p.colours);
      const scoreCols = Math.ceil(p.pegs / 2);
      const boardX = TRAY + GAP;
      const scoreX = boardX + p.pegs * P + 2;
      const width = scoreX + scoreCols * 4 + 6;
      const height = rowsN * P + 1;
      const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "guess-board", role: "grid", "aria-label": `guess, ${p.pegs} pegs, ${p.colours} colors` });
      const rowsL = s("g"), trayL = s("g"), pegsL = s("g"), over = s("g");
      const cursor = s("rect", { width: P - 0.6, height: P - 0.6, rx: 2, class: "cursor" });
      svg.append(rowsL, trayL, pegsL, over, cursor);
      root.append(svg);

      const rowY = (r: number) => r * P + 0.5;
      const pegX = (i: number) => boardX + i * P + P / 2;
      const trayPegs = Array.from({ length: p.colours }, (_, c) => {
        const el = s("circle", { cx: TRAY / 2, cy: rowY(c) + P / 2, r: R, class: "peg", fill: FILLS[c + 1], "data-colour": c + 1 });
        trayL.append(el);
        if (settings.numbers) trayL.append(s("text", { x: TRAY / 2, y: rowY(c) + P / 2 + 0.2, class: "num" }, String(c + 1)));
        return el;
      });

      let drag: { colour: number; from: { row: number; slot: number } | null; pointerId: number; moved: boolean; x: number; y: number } | null = null;
      let preview: GuessState | null = null;
      const ghost = s("circle", { r: R, class: "peg", style: "pointer-events: none; display: none" });
      svg.append(ghost);

      const render = () => {
        const st = session.state;
        const over_ = isOver(p, st);
        const cur = st.done.length;
        const pvDone = preview?.done.length ?? cur;
        while (rowsL.firstChild) rowsL.firstChild.remove();
        while (pegsL.firstChild) pegsL.firstChild.remove();
        const pegAt = (x: number, y: number, c: number, extra = "") => {
          pegsL.append(c ? s("circle", { cx: x, cy: y, r: R, class: `peg${extra}`, fill: FILLS[c] }) : s("circle", { cx: x, cy: y, r: R * 0.45, class: "hole" }));
          if (c && settings.numbers) pegsL.append(s("text", { x, y: y + 0.2, class: "num" }, String(c)));
        };
        for (let r = 0; r < p.guesses; r++) {
          const y = rowY(r);
          rowsL.append(s("rect", { x: boardX - 1, y, width: width - boardX + 0.5, height: P, rx: 2, class: `row${r === cur && !over_ ? " current" : ""}` }));
          const marked = r < cur ? st.done[r] : r < pvDone ? preview!.done[r] : undefined;
          const look = r < cur ? (r >= pvDone ? " faded" : "") : r < pvDone ? " preview" : "";
          const building = r === cur && !over_ && pvDone === cur;
          const shown = marked ? marked.code : building ? (preview?.row ?? st.row) : null;
          for (let i = 0; i < p.pegs; i++) {
            pegAt(pegX(i), y + P / 2, shown?.[i] ?? 0, building && preview && preview.row[i] !== st.row[i] ? " preview" : look);
            if (r === cur && !over_ && st.holds[i]) pegsL.append(s("circle", { cx: pegX(i), cy: y + P / 2, r: R + 1, class: "hold" }));
          }
          if (marked) {
            const g = marked;
            for (let k = 0; k < p.pegs; k++) {
              const cls = (k < g.black ? "score black" : k < g.black + g.white ? "score white" : "score") + look;
              pegsL.append(s("circle", { cx: scoreX + 2 + (k % scoreCols) * 4, cy: y + 3 + Math.floor(k / scoreCols) * 4, r: 1.3, class: cls }));
            }
          } else if (r === cur && !over_) {
            pegsL.append(s("rect", { x: scoreX, y: y + 1, width: scoreCols * 4, height: P - 2, rx: 2, class: `submit${canSubmit(p, st.row) ? " ready" : ""}`, "data-submit": 1 }));
          }
        }
        const solY = rowY(p.guesses);
        for (let i = 0; i < p.pegs; i++) {
          if (over_) pegAt(pegX(i), solY + P / 2, p.code[i]!);
          else {
            pegsL.append(s("rect", { x: pegX(i) - R, y: solY + P / 2 - R, width: 2 * R, height: 2 * R, rx: 1, class: "hidden" }));
            pegsL.append(s("text", { x: pegX(i), y: solY + P / 2 + 0.2, class: "q" }, "?"));
          }
        }
        trayPegs.forEach((el, c) => el.classList.toggle("selected", session.interaction.colour === c + 1));
        while (over.firstChild) over.firstChild.remove();
        const focus = session.activeHint?.focus as GuessFocus | undefined;
        if (focus) {
          for (const r of focus.rows ?? []) over.append(s("rect", { x: boardX - 0.5, y: rowY(r) + 0.3, width: p.pegs * P + scoreCols * 4 + 3, height: P - 0.6, rx: 2, class: "focus why" }));
          for (const i of focus.slots ?? []) over.append(s("rect", { x: pegX(i) - P / 2 + 0.5, y: rowY(cur) + 0.5, width: P - 1, height: P - 1, rx: 2, class: "focus" }));
        }
        cursor.style.display = over_ ? "none" : "";
        cursor.setAttribute("x", String(pegX(session.interaction.slot) - P / 2 + 0.3));
        cursor.setAttribute("y", String(rowY(cur) + 0.3));
      };

      const pointAt = (e: PointerEvent) => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return { x: 0, y: 0, tray: -1, row: -1, slot: -1, submit: false };
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const r = Math.floor((pt.y - 0.5) / P);
        const tray = pt.x < TRAY && r >= 0 && r < p.colours ? r + 1 : 0;
        const slot = Math.floor((pt.x - boardX) / P);
        const inBoard = r >= 0 && r < p.guesses && slot >= 0 && slot < p.pegs;
        const submit = r === session.state.done.length && pt.x >= scoreX && pt.x <= scoreX + scoreCols * 4 + 2;
        return { x: pt.x, y: pt.y, tray, row: inBoard ? r : -1, slot: inBoard ? slot : -1, submit };
      };
      const place = (slot: number, colour: number) => session.dispatch({ type: "peg", index: slot, colour });
      let pressTimer = 0;
      const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const at = pointAt(e);
        e.preventDefault();
        if (session.locked || isOver(p, session.state)) return;
        const cur = session.state.done.length;
        if (at.submit) { session.dispatch({ type: "submit" }); return; }
        if (at.tray) {
          session.setInteraction((i) => ({ ...i, colour: at.tray }));
          drag = { colour: at.tray, from: null, pointerId: e.pointerId, moved: false, x: at.x, y: at.y };
        } else if (at.row >= 0) {
          if (at.row === cur) session.setInteraction((i) => ({ ...i, slot: at.slot }));
          if (at.row === cur && e.button === 2) { session.dispatch({ type: "hold", index: at.slot }); return; }
          const colour = at.row < cur ? session.state.done[at.row]!.code[at.slot]! : at.row === cur ? session.state.row[at.slot]! : 0;
          drag = { colour, from: { row: at.row, slot: at.slot }, pointerId: e.pointerId, moved: false, x: at.x, y: at.y };
          if (at.row === cur && e.pointerType === "touch") {
            pressTimer = window.setTimeout(() => {
              pressTimer = 0;
              if (!drag || drag.moved) return;
              navigator.vibrate?.(15);
              session.dispatch({ type: "hold", index: at.slot });
              drag = null;
            }, 450);
          }
        } else return;
        svg.setPointerCapture?.(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const at = pointAt(e);
        if (Math.hypot(at.x - drag.x, at.y - drag.y) > 2) { drag.moved = true; cancelPress(); }
        if (drag.moved && drag.colour) {
          ghost.style.display = "";
          ghost.setAttribute("cx", String(at.x));
          ghost.setAttribute("cy", String(at.y));
          ghost.setAttribute("fill", FILLS[drag.colour]!);
        }
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;
        const pending = pressTimer !== 0;
        cancelPress();
        ghost.style.display = "none";
        const at = pointAt(e);
        const cur = session.state.done.length;
        if (!d.moved) {
          if (e.pointerType === "touch" && !pending && d.from?.row === cur) return;
          if (d.from && d.from.row === cur) {
            const c = session.interaction.colour;
            place(d.from.slot, session.state.row[d.from.slot] === c ? 0 : c);
          }
          return;
        }
        if (at.row === cur && d.colour) {
          session.setInteraction((i) => ({ ...i, slot: at.slot }));
          place(at.slot, d.colour);
        } else if (d.from?.row === cur && at.row !== cur) place(d.from.slot, 0);
      };
      const onCancel = () => { drag = null; cancelPress(); ghost.style.display = "none"; };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) onCancel();
          render();
        }, { owner: "view" }),
      ];
      render();

      const slot = () => session.interaction.slot;
      const commands: CommandDef[] = [...bindCommands(BINDINGS, {
        "guess.place": () => place(slot(), session.state.row[slot()] === session.interaction.colour ? 0 : session.interaction.colour),
        "guess.submit": () => session.dispatch({ type: "submit" }),
        "guess.clear": () => place(slot(), 0),
        "guess.hold": () => session.dispatch({ type: "hold", index: slot() }),
        "guess.prev-colour": () => session.setInteraction((i) => ({ ...i, colour: Math.max(1, i.colour - 1) })),
        "guess.next-colour": () => session.setInteraction((i) => ({ ...i, colour: Math.min(p.colours, i.colour + 1) })),
        "guess.left": () => session.setInteraction((i) => ({ ...i, slot: Math.max(0, i.slot - 1) })),
        "guess.right": () => session.setInteraction((i) => ({ ...i, slot: Math.min(p.pegs - 1, i.slot + 1) })),
      }, {
        "guess.submit": { menu: "board", when: () => canSubmit(p, session.state.row) && !isOver(p, session.state) },
        "guess.hold": { menu: "board" },
        "guess.clear": { menu: "board" },
      }), ...bindCommands(DIGIT_BINDINGS, handlersOver("guess.colour-", COLOURS, (c) => () => {
        if (c > p.colours) return;
        session.setInteraction((x) => ({ ...x, colour: c }));
        place(slot(), c);
        session.setInteraction((x) => ({ ...x, slot: Math.min(p.pegs - 1, x.slot + 1) }));
      }))];
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: width / height,
        cells: { cols: Math.ceil(width / P), rows: rowsN },
        commands,
        target: () => ({ slot: slot() }),
        preview: (st) => {
          preview = st as GuessState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as GuessFocus | undefined;
          if (!f) return [];
          const box = svg.getBoundingClientRect();
          const scale = box.width / width;
          const rect = (x: number, y: number, w: number, h: number) => new DOMRect(box.x + x * scale, box.y + y * scale, w * scale, h * scale);
          const cur = Math.min(session.state.done.length, p.guesses - 1);
          return [
            ...(f.slots ?? []).map((i) => rect(pegX(i) - P / 2, rowY(cur), P, P)),
            ...(f.rows ?? []).map((r) => rect(boardX, rowY(r), p.pegs * P, P)),
          ];
        },
        locateChange: (a, b) => {
          const x = a as GuessState, y = b as GuessState;
          const box = svg.getBoundingClientRect();
          const scale = box.width / width;
          const r = Math.min(Math.max(x.done.length, y.done.length) - (y.done.length > x.done.length ? 1 : 0), p.guesses - 1);
          return [new DOMRect(box.x + boardX * scale, box.y + rowY(r) * scale, p.pegs * P * scale, P * scale)];
        },
        destroy() {
          cancelPress();
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
