import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import type { CommandDef, View } from "../../core/types";
import { entryAt, entryOf, hitCode, reflectCode } from "./beam";
import { ballCount, beamLabels, canCheck, type BlackboxAction, type BlackboxFocus, type BlackboxInteraction, type BlackboxPuzzle, type BlackboxState } from "./logic";

const CSS = `
.blackbox-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.blackbox-board .arena { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.blackbox-board .arena.locked { fill: color-mix(in srgb, var(--text) 14%, var(--cell)); }
.blackbox-board .ring { fill: var(--surface-2, var(--cell)); stroke: var(--border); stroke-width: 0.25; cursor: pointer; }
.blackbox-board .ring.fired { cursor: default; }
.blackbox-board .ring.pair { fill: color-mix(in srgb, var(--accent) 30%, var(--cell)); }
.blackbox-board .ring.wrong { fill: var(--danger-soft); stroke: var(--danger); stroke-width: 0.6; }
.blackbox-board .ring.revealed { stroke: var(--warn); stroke-width: 0.6; }
.blackbox-board .arrow { fill: var(--text-dim); opacity: 0.45; pointer-events: none; }
.blackbox-board .label { fill: var(--text); font: 600 4.2px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.blackbox-board .ball { fill: var(--text); pointer-events: none; }
.blackbox-board .ball.real { fill: none; stroke: var(--accent); stroke-width: 0.8; }
.blackbox-board .ball.preview, .blackbox-board .label.preview { opacity: 0.45; }
.blackbox-board .faded { opacity: 0.25; }
.blackbox-board .check { fill: var(--accent-soft, var(--cell)); stroke: var(--accent); stroke-width: 0.5; cursor: pointer; }
.blackbox-board .check-label { fill: var(--text); font: 600 3.2px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.blackbox-board .count { fill: var(--text-dim); font: 500 3.2px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.blackbox-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.blackbox-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.blackbox-board .labels text { fill: var(--text-dim); font: 500 3.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.blackbox-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
[data-input="pointer"] .blackbox-board .cursor { display: none; }
`;

const SIZE = 10;
const LABEL = 6;

const BINDINGS: BindingSchema = {
  "blackbox.act": { label: "fire, place ball or check", category: "black box", keys: ["Enter"], description: "fire the laser at the selected edge square, put a ball in (or take it out of) the selected cell, or check your balls from the corner" },
  "blackbox.lock": { label: "lock", category: "black box", keys: ["space"], description: "lock the selected cell as certainly empty (or unlock it). on an edge square, lock or unlock that whole row or column" },
  "blackbox.check": { label: "check balls", category: "black box", keys: ["c"], description: "have your balls checked (once you've placed the right number)" },
  "blackbox.left": { label: "cursor left", category: "black box", keys: ["ArrowLeft", "a"] },
  "blackbox.right": { label: "cursor right", category: "black box", keys: ["ArrowRight", "d"] },
  "blackbox.up": { label: "cursor up", category: "black box", keys: ["ArrowUp", "w"] },
  "blackbox.down": { label: "cursor down", category: "black box", keys: ["ArrowDown", "s"] },
};

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;
  const ring = (fill = "var(--surface-2, var(--cell))", extra = "") => `<rect width="10" height="10" fill="${fill}" stroke="var(--border)" stroke-width="0.25" ${extra}/>`;
  const cell = (fill = "var(--cell)") => `<rect width="10" height="10" fill="${fill}" stroke="var(--border)" stroke-width="0.25"/>`;
  const label = (t: string) => `<text x="5" y="5.3" fill="var(--text)" font-size="4.2" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${t}</text>`;
  return [
    { sample: svg(ring() + `<path d="M5 3l2 3H3z" fill="var(--text-dim)" opacity="0.45"/>`), meaning: "an edge square: click to fire a laser in from here" },
    { sample: svg(ring() + label("3")), meaning: "a laser that came out somewhere else: the same number marks both ends" },
    { sample: svg(ring() + label("H")), meaning: "a hit: the laser ran straight into a ball" },
    { sample: svg(ring() + label("R")), meaning: "a reflection: the laser came back out where it went in" },
    { sample: svg(cell() + `<circle cx="5" cy="5" r="3" fill="var(--text)"/>`), meaning: "your guess of a ball" },
    { sample: svg(cell("color-mix(in srgb, var(--text) 14%, var(--cell))")), meaning: "a locked cell: your note that it's empty" },
    { sample: svg(ring("var(--danger-soft)", `stroke="var(--danger)" stroke-width="0.6"`)), meaning: "after a check: a laser your balls would send somewhere else" },
    { sample: svg(cell() + `<circle cx="5" cy="5" r="3" fill="none" stroke="var(--accent)" stroke-width="0.8"/>`), meaning: "where the balls really were (shown at the end)" },
    { sample: svg(`<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.9"/>`), meaning: "hint: a cell or laser it's about" },
    { sample: svg(`<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.6" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the lasers behind it" },
    { sample: svg(`<rect x="0.3" y="0.3" width="9.4" height="9.4" rx="1" fill="none" stroke="var(--focus)" stroke-width="0.6"/>`), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

export function blackboxView(board: Board): View<BlackboxPuzzle, BlackboxState, BlackboxAction, BlackboxInteraction> {
  return {
    id: "blackbox.svg",
    name: "box",
    puzzle: "blackbox",
    controls: [
      { how: "click or tap an edge square", what: "fire a laser in from there" },
      { how: "point at a fired edge square", what: "highlights the other end of its beam" },
      { how: "click or tap a cell inside", what: "put a ball there, or take it away" },
      { how: "right-click a cell (or an edge square), or hold on a touch screen", what: "lock the cell (or its whole row or column) as empty, or unlock it" },
      { how: "click the corner square once you've placed the balls", what: "check them" },
    ],
    legend: legend(),
    mount(root, { session }) {
      style("blackbox", CSS);
      const p = session.puzzle;
      const W = p.w + 2, H = p.h + 2;
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : 0.5);
      const vbW = W * SIZE + m("left") + m("right"), vbH = H * SIZE + m("top") + m("bottom");
      const svg = s("svg", { viewBox: `${-m("left")} ${-m("top")} ${vbW} ${vbH}`, class: "blackbox-board", role: "grid", "aria-label": `black box, ${p.w} by ${p.h}` });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: (x + 1) * SIZE + SIZE / 2, y: -LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: (x + 1) * SIZE + SIZE / 2, y: H * SIZE + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -LABEL / 2, y: (y + 1) * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: W * SIZE + LABEL / 2, y: (y + 1) * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      svg.append(labels);
      const base = s("g"), marks = s("g"), over = s("g");
      const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
      svg.append(base, marks, over, cursor);
      root.append(svg);

      const rects: SVGRectElement[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const inside = x >= 1 && x <= p.w && y >= 1 && y <= p.h;
        const e = entryOf(p.w, p.h, x, y);
        if (!inside && e < 0) continue;
        base.append(rects[y * W + x] = s("rect", { x: x * SIZE, y: y * SIZE, width: SIZE, height: SIZE, class: inside ? "arena" : "ring" }));
      }
      const check = s("rect", { x: 0.8, y: 0.8, width: SIZE - 1.6, height: SIZE - 1.6, rx: 1.5, class: "check" });
      const checkLabel = s("text", { x: SIZE / 2, y: SIZE / 2 + 0.2, class: "check-label" }, "check");
      const countLabel = s("text", { x: SIZE / 2, y: SIZE / 2 + 0.2, class: "count" });
      base.append(check, checkLabel, countLabel);

      let hoverEntry = -1, hoverCell = -1;
      let preview: BlackboxState | null = null;
      const L = 2 * (p.w + p.h);
      const ringXY = (e: number) => entryAt(p.w, p.h, e);
      const arrow = (e: number) => {
        const { x, y, dir } = ringXY(e);
        const cx = x * SIZE + SIZE / 2, cy = y * SIZE + SIZE / 2;
        const pts = [[0, 1.6], [-1.6, -1], [1.6, -1]].map(([a, b]) => {
          const ang = (dir * Math.PI) / 2 + Math.PI;
          return `${(cx + a! * Math.cos(ang) - b! * Math.sin(ang)).toFixed(2)},${(cy + a! * Math.sin(ang) + b! * Math.cos(ang)).toFixed(2)}`;
        });
        return s("polygon", { points: pts.join(" "), class: "arrow" });
      };

      const render = () => {
        const st = session.state;
        const labels = beamLabels(p, st);
        const pvLabels = preview ? beamLabels(p, preview) : null;
        const shotText = (v: number, e: number, lab: Map<number, number>) => (v === hitCode(p.w, p.h) ? "H" : v === reflectCode(p.w, p.h) ? "R" : String(lab.get(e) ?? ""));
        const pair = new Set<number>();
        if (hoverEntry >= 0 && st.shots[hoverEntry] !== -1) {
          pair.add(hoverEntry);
          if (st.shots[hoverEntry]! < hitCode(p.w, p.h)) pair.add(st.shots[hoverEntry]!);
        }
        const wrong = new Set<number>();
        for (const e of st.wrong) {
          wrong.add(e);
          if (st.shots[e]! >= 0 && st.shots[e]! < hitCode(p.w, p.h)) wrong.add(st.shots[e]!);
        }
        while (marks.firstChild) marks.firstChild.remove();
        for (let e = 0; e < L; e++) {
          const { x, y } = ringXY(e);
          const r = rects[y * W + x]!;
          const v = st.shots[e]!;
          r.classList.toggle("fired", v !== -1);
          r.classList.toggle("pair", pair.has(e));
          r.classList.toggle("wrong", wrong.has(e));
          r.classList.toggle("revealed", st.revealed.includes(e));
          const pv = preview ? preview.shots[e]! : v;
          const label = (t: string, cls: string) => marks.append(s("text", { x: x * SIZE + SIZE / 2, y: y * SIZE + SIZE / 2 + 0.2, class: cls }, t));
          if (v === -1 && pv !== -1) label(shotText(pv, e, pvLabels!), "label preview");
          else if (v === -1) marks.append(arrow(e));
          else label(shotText(v, e, labels), pv === -1 ? "label faded" : "label");
        }
        for (let c = 0; c < p.w * p.h; c++) {
          const x = (c % p.w) + 1, y = Math.floor(c / p.w) + 1;
          rects[y * W + x]!.classList.toggle("locked", (preview ?? st).locks[c]!);
          const ball = st.guesses[c] || !!preview?.guesses[c];
          const cls = !preview || preview.guesses[c] === st.guesses[c] ? "ball" : st.guesses[c] ? "ball faded" : "ball preview";
          if (ball) marks.append(s("circle", { cx: x * SIZE + SIZE / 2, cy: y * SIZE + SIZE / 2, r: 3, class: cls }));
          if ((st.solved || preview?.solved) && p.balls.includes(c)) marks.append(s("circle", { cx: x * SIZE + SIZE / 2, cy: y * SIZE + SIZE / 2, r: 3.6, class: st.solved ? "ball real" : "ball real preview" }));
        }
        const ready = canCheck(p, st);
        check.style.display = ready ? "" : "none";
        checkLabel.style.display = ready ? "" : "none";
        countLabel.style.display = ready ? "none" : "";
        countLabel.textContent = st.solved ? "✓" : `${ballCount(st)}/${p.minBalls === p.maxBalls ? p.minBalls : `${p.minBalls}-${p.maxBalls}`}`;
        while (over.firstChild) over.firstChild.remove();
        const focus = session.activeHint?.focus as BlackboxFocus | undefined;
        if (focus) {
          for (const e of focus.entries ?? []) {
            const { x, y } = ringXY(e);
            over.append(s("rect", { x: x * SIZE + 0.5, y: y * SIZE + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: focus.cells?.length ? "focus why" : "focus" }));
          }
          for (const c of focus.cells ?? []) {
            const x = (c % p.w) + 1, y = Math.floor(c / p.w) + 1;
            over.append(s("rect", { x: x * SIZE + 0.5, y: y * SIZE + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: "focus" }));
          }
        }
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String((cur % W) * SIZE + 0.3));
        cursor.setAttribute("y", String(Math.floor(cur / W) * SIZE + 0.3));
      };

      const at = (e: PointerEvent): number => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return -1;
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
      };
      /** Locks or unlocks the cells of the row or column behind an edge square, by majority. */
      const lockLine = (x: number, y: number) => {
        const cells = y === 0 || y === H - 1
          ? Array.from({ length: p.h }, (_, r) => r * p.w + (x - 1))
          : Array.from({ length: p.w }, (_, c) => (y - 1) * p.w + c);
        const locked = cells.filter((c) => session.state.locks[c]).length;
        session.dispatch({ type: "lock", cells, value: locked <= cells.length / 2 });
      };
      const act = (pos: number, secondary: boolean) => {
        const x = pos % W, y = Math.floor(pos / W);
        if (x === 0 && y === 0) {
          if (!secondary) session.dispatch({ type: "check" });
          return;
        }
        const e = entryOf(p.w, p.h, x, y);
        if (e >= 0) {
          if (secondary) lockLine(x, y);
          else session.dispatch({ type: "fire", entry: e });
          return;
        }
        if (x < 1 || y < 1 || x > p.w || y > p.h) return;
        const c = (y - 1) * p.w + (x - 1);
        if (secondary) session.dispatch({ type: "lock", cells: [c], value: !session.state.locks[c] });
        else session.dispatch({ type: "ball", cells: [c], value: !session.state.guesses[c] });
      };
      let pressTimer = 0, pressPos = -1;
      const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const pos = at(e);
        if (pos < 0) return;
        e.preventDefault();
        session.setInteraction((i) => ({ ...i, cursor: pos }));
        if (session.locked) return;
        if (e.pointerType === "touch") {
          pressPos = pos;
          pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            navigator.vibrate?.(15);
            act(pressPos, true);
            pressPos = -1;
          }, 450);
          return;
        }
        act(pos, e.button === 2);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerType !== "touch") return;
        if (pressTimer && pressPos >= 0) { cancelPress(); act(pressPos, false); }
        pressPos = -1;
      };
      const onMove = (e: PointerEvent) => {
        const pos = at(e);
        if (e.pointerType === "touch") {
          if (pressTimer && pos !== pressPos) { cancelPress(); pressPos = -1; }
          return;
        }
        const ent = pos < 0 ? -1 : entryOf(p.w, p.h, pos % W, Math.floor(pos / W));
        const x = pos % W, y = Math.floor(pos / W);
        const cell = pos >= 0 && x >= 1 && y >= 1 && x <= p.w && y <= p.h ? (y - 1) * p.w + (x - 1) : -1;
        if (ent !== hoverEntry || cell !== hoverCell) {
          hoverEntry = ent;
          hoverCell = cell;
          render();
        }
      };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerleave", () => { hoverEntry = hoverCell = -1; render(); });

      const move = (dx: number, dy: number) => () => session.setInteraction((i) => {
        const x = Math.min(W - 1, Math.max(0, (i.cursor % W) + dx));
        const y = Math.min(H - 1, Math.max(0, Math.floor(i.cursor / W) + dy));
        return { ...i, cursor: y * W + x };
      });
      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) { cancelPress(); pressPos = -1; }
          render();
        }, { owner: "view" }),
      ];
      render();

      const boxRect = (x: number, y: number) => {
        const r = rects[y * W + x];
        return r ? [r.getBoundingClientRect()] : [];
      };
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "blackbox.act": () => act(session.interaction.cursor, false),
        "blackbox.lock": () => act(session.interaction.cursor, true),
        "blackbox.check": () => session.dispatch({ type: "check" }),
        "blackbox.left": move(-1, 0),
        "blackbox.right": move(1, 0),
        "blackbox.up": move(0, -1),
        "blackbox.down": move(0, 1),
      }, {
        "blackbox.lock": { menu: "board" },
        "blackbox.check": { menu: "board", when: () => canCheck(p, session.state) },
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: vbW / vbH,
        cells: { cols: W, rows: H },
        commands,
        target: () => (hoverCell >= 0 ? { cell: hoverCell } : { cell: (() => {
          const c = session.interaction.cursor, x = c % W, y = Math.floor(c / W);
          return x >= 1 && y >= 1 && x <= p.w && y <= p.h ? (y - 1) * p.w + (x - 1) : -1;
        })() }),
        preview: (st) => {
          preview = st as BlackboxState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as BlackboxFocus | undefined;
          if (!f) return [];
          return [
            ...(f.cells ?? []).flatMap((c) => boxRect((c % p.w) + 1, Math.floor(c / p.w) + 1)),
            ...(f.entries ?? []).flatMap((e) => { const r = ringXY(e); return boxRect(r.x, r.y); }),
          ];
        },
        locateChange: (a, b) => {
          const x = a as BlackboxState, y = b as BlackboxState;
          const out: DOMRect[] = [];
          for (let c = 0; c < p.w * p.h; c++) if (x.guesses[c] !== y.guesses[c] || x.locks[c] !== y.locks[c]) out.push(...boxRect((c % p.w) + 1, Math.floor(c / p.w) + 1));
          for (let e = 0; e < L; e++) if (x.shots[e] !== y.shots[e]) { const r = ringXY(e); out.push(...boxRect(r.x, r.y)); }
          return out;
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
