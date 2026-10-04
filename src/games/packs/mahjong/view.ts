import { animate, ease, type Animation } from "../../core/anim";
import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { canMatch, type MahjongAction, type MahjongFocus, type MahjongInteraction, type MahjongPuzzle, type MahjongState } from "./logic";
import { boardOf, isFree } from "./solver";
import { faceSvg, KINDS, tileName } from "./tiles";

/** Board units per half-tile step across and down, and the lift per layer. */
const X = 3.6, Y = 4.8, D = 1.2;
const TW = 2 * X, TH = 2 * Y;
const PAD = 1.5;
let mounts = 0;

const CSS = `
.mj-board { display: block; width: 100%; height: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.mj-board .side { fill: var(--mahjong-side, color-mix(in srgb, var(--mahjong-face, #f4efe2) 70%, #6b5b3e)); stroke: var(--mahjong-edge, rgb(0 0 0 / 0.35)); stroke-width: 0.12; }
.mj-board .face { fill: var(--mahjong-face, #f4efe2); stroke: var(--mahjong-edge, rgb(0 0 0 / 0.35)); stroke-width: 0.12; }
.mj-board .tile { cursor: pointer; }
.mj-board.dim .tile.blocked .shade { fill: rgb(0 0 0 / 0.22); }
.mj-board .shade { fill: transparent; pointer-events: none; }
.mj-board .tile.sel .shade { fill: color-mix(in srgb, var(--accent) 30%, transparent); }
.mj-board .tile.sel .face { stroke: var(--accent); stroke-width: 0.5; }
.mj-board .tile.leaving { opacity: 0.3; }
.mj-board .ghost { opacity: 0.45; pointer-events: none; }
.mj-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.6; pointer-events: none; }
.mj-board .mark.look { stroke-dasharray: 1 0.7; stroke-width: 0.45; }
.mj-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.5; pointer-events: none; }
[data-input="pointer"] .mj-board .cursor { display: none; }
`;

const settings = defineSchema({
  dim: { type: "bool", label: "shade tiles that aren't free", default: true },
  labels: { type: "bool", label: "corner labels on tiles", default: false, description: "a short code (3D for 3 dots, EW for east wind…) for telling tiles apart without the pictures" },
});

const BINDINGS: BindingSchema = {
  "mahjong.left": { label: "cursor left", category: "mahjong", keys: ["ArrowLeft", "a"] },
  "mahjong.right": { label: "cursor right", category: "mahjong", keys: ["ArrowRight", "d"] },
  "mahjong.up": { label: "cursor up", category: "mahjong", keys: ["ArrowUp", "w"] },
  "mahjong.down": { label: "cursor down", category: "mahjong", keys: ["ArrowDown", "s"] },
  "mahjong.pick": { label: "pick tile", category: "mahjong", keys: ["space", "Enter"], description: "pick the tile under the cursor; picking a second matching free tile takes the pair" },
};

const sample = (k: number, extra = "") =>
  `<svg viewBox="-0.3 -0.3 ${TW + D + 0.6} ${TH + D + 0.6}" style="height: 2.4em"><rect x="${D}" y="${D}" width="${TW}" height="${TH}" rx="0.7" fill="var(--mahjong-side, #c9bc9c)"/><rect width="${TW}" height="${TH}" rx="0.7" fill="var(--mahjong-face, #f4efe2)" stroke="rgb(0 0 0 / 0.35)" stroke-width="0.12"/><g transform="scale(${TW / 10} ${TH / 13})">${faceSvg(k, false)}</g>${extra}</svg>`;

export const mahjongView: View<MahjongPuzzle, MahjongState, MahjongAction, MahjongInteraction> = {
  id: "mahjong.svg",
  name: "tiles",
  puzzle: "mahjong",
  settings,
  controls: [
    { how: "click or tap a free tile", what: "pick it; then click a free tile that matches it to take the pair" },
    { how: "click the picked tile again", what: "put it back" },
  ],
  legend: () => [
    { sample: sample(2), meaning: "3 dots" },
    { sample: sample(12), meaning: "4 bamboo" },
    { sample: sample(24), meaning: "7 characters" },
    { sample: sample(27), meaning: "east wind (then south 南, west 西, north 北)" },
    { sample: sample(31), meaning: "red dragon (green 發, white is an empty frame)" },
    { sample: sample(34), meaning: "a flower: any flower matches any other" },
    { sample: sample(38), meaning: "a season: any season matches any other" },
    { sample: sample(5, `<rect width="${TW}" height="${TH}" rx="0.7" fill="rgb(0 0 0 / 0.22)"/>`), meaning: "a shaded tile isn't free yet" },
    { sample: sample(5, `<rect x="-0.2" y="-0.2" width="${TW + 0.4}" height="${TH + 0.4}" rx="0.8" fill="none" stroke="var(--hint)" stroke-width="0.6"/>`), meaning: "hint: the pair to take" },
  ],
  mount(root, { session, settings }) {
    style("mahjong", CSS);
    const p = session.puzzle;
    const board = boardOf(p.spots);
    const n = p.spots.length;
    const maxZ = Math.max(...p.spots.map((q) => q[2]));
    const minX = Math.min(...p.spots.map((q) => q[0])) * X - maxZ * D - PAD;
    const minY = Math.min(...p.spots.map((q) => q[1])) * Y - maxZ * D - PAD;
    const maxX = Math.max(...p.spots.map((q) => q[0])) * X + TW + D + PAD;
    const maxY = Math.max(...p.spots.map((q) => q[1])) * Y + TH + D + PAD;
    const W = maxX - minX, H = maxY - minY;
    const svg = s("svg", { viewBox: `${minX} ${minY} ${W} ${H}`, class: `mj-board${settings.dim ? " dim" : ""}`, role: "application", "aria-label": `mahjong solitaire, ${n} tiles` });
    const id = `mj${++mounts}`;
    const defs = s("defs");
    defs.innerHTML = Array.from({ length: KINDS }, (_, k) => `<symbol id="${id}-${k}" viewBox="0 0 10 13">${faceSvg(k, !!settings.labels)}</symbol>`).join("");
    const pos = (i: number) => { const [x, y, z] = p.spots[i]!; return { x: x * X - z * D, y: y * Y - z * D }; };
    const tileEl = (i: number, cls = "tile") => {
      const { x, y } = pos(i);
      return s("g", { class: cls, "data-spot": i, "aria-label": tileName(p.tiles[i]!), transform: `translate(${x} ${y})` },
        s("rect", { class: "side", x: D, y: D, width: TW, height: TH, rx: 0.7 }),
        s("rect", { class: "face", width: TW, height: TH, rx: 0.7 }),
        s("use", { href: `#${id}-${p.tiles[i]}`, width: TW, height: TH }),
        s("rect", { class: "shade", width: TW, height: TH, rx: 0.7 }));
    };
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => p.spots[a]![2] - p.spots[b]![2] || (p.spots[a]![0] + p.spots[a]![1]) - (p.spots[b]![0] + p.spots[b]![1]));
    const tiles: SVGGElement[] = [];
    const tileLayer = s("g");
    for (const i of order) { tiles[i] = tileEl(i); tileLayer.append(tiles[i]!); }
    const ghostLayer = s("g", { class: "ghost" }), overlay = s("g");
    const cursor = s("rect", { width: TW + 0.6, height: TH + 0.6, rx: 0.9, class: "cursor" });
    svg.append(defs, tileLayer, ghostLayer, overlay, cursor);
    root.append(svg);

    let preview: MahjongState | null = null;
    let anim: Animation | null = null;
    let shownGone = session.state.gone.slice();

    const outline = (i: number, cls: string) => {
      const { x, y } = pos(i);
      overlay.append(s("rect", { x: x - 0.3, y: y - 0.3, width: TW + 0.6, height: TH + 0.6, rx: 0.9, class: cls }));
    };

    const render = () => {
      const gone = session.state.gone;
      const sel = session.interaction.selected;
      for (let i = 0; i < n; i++) {
        const t = tiles[i]!;
        t.style.display = shownGone[i] ? "none" : "";
        t.classList.toggle("blocked", !gone[i] && !isFree(board, gone, i));
        t.classList.toggle("sel", i === sel);
        t.classList.toggle("leaving", !!preview && !gone[i] && !!preview.gone[i]);
      }
      ghostLayer.replaceChildren();
      if (preview) for (const i of order) if (gone[i] && !preview.gone[i]) ghostLayer.append(tileEl(i, "tile"));
      overlay.replaceChildren();
      const f = session.activeHint?.focus as MahjongFocus | undefined;
      for (const i of f?.tiles ?? []) outline(i, "mark");
      for (const i of f?.look ?? []) outline(i, "mark look");
      const c = session.interaction.cursor;
      const { x, y } = pos(c);
      cursor.setAttribute("x", String(x - 0.3));
      cursor.setAttribute("y", String(y - 0.3));
      cursor.style.display = gone[c] ? "none" : "";
    };

    /** Fade out tiles that just went, fade in tiles that came back. */
    const settle = () => {
      anim?.cancel();
      const gone = session.state.gone;
      const out: number[] = [], back: number[] = [];
      for (let i = 0; i < n; i++) {
        if (gone[i] && !shownGone[i]) out.push(i);
        if (!gone[i] && shownGone[i]) back.push(i);
      }
      shownGone = gone.map((g, i) => (out.includes(i) ? 0 : g));
      render();
      if (!out.length && !back.length) return;
      anim = animate(220, (t) => {
        for (const i of out) { tiles[i]!.style.opacity = String(1 - t); }
        for (const i of back) { tiles[i]!.style.opacity = String(t); }
      }, ease.out);
      void anim.then(() => {
        for (const i of [...out, ...back]) tiles[i]!.style.opacity = "";
        shownGone = session.state.gone.slice();
        render();
      });
    };

    const pick = (i: number) => {
      if (session.locked || session.state.gone[i]) return;
      session.setInteraction((it) => ({ ...it, cursor: i }));
      if (!isFree(board, session.state.gone, i)) {
        const t = tiles[i]!;
        const base = t.getAttribute("transform")!;
        anim = animate(240, (q) => t.setAttribute("transform", `${base} translate(${Math.sin(q * Math.PI * 4) * (1 - q) * 0.8} 0)`), ease.linear);
        void anim.then(() => t.setAttribute("transform", base));
        return;
      }
      const sel = session.interaction.selected;
      if (sel === i) { session.setInteraction((it) => ({ ...it, selected: -1 })); return; }
      if (sel >= 0 && canMatch(p, session.state, sel, i)) {
        session.setInteraction((it) => ({ ...it, selected: -1 }));
        session.dispatch({ type: "match", a: sel, b: i });
        return;
      }
      session.setInteraction((it) => ({ ...it, selected: i }));
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as Element).closest("[data-spot]");
      if (!el || el.closest(".ghost")) return;
      e.preventDefault();
      pick(Number(el.getAttribute("data-spot")));
    };
    svg.addEventListener("pointerdown", onDown);

    const center = (i: number) => { const { x, y } = pos(i); return { x: x + TW / 2, y: y + TH / 2 }; };
    const moveCursor = (dx: number, dy: number) => () => session.setInteraction((it) => {
      const from = center(it.cursor);
      let best = it.cursor, bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (session.state.gone[i] || i === it.cursor) continue;
        const c = center(i);
        const along = (c.x - from.x) * dx + (c.y - from.y) * dy;
        if (along <= 0.5) continue;
        const across = Math.abs((c.x - from.x) * dy) + Math.abs((c.y - from.y) * dx);
        const d = along + across * 2 - (isFree(board, session.state.gone, i) ? 1 : 0);
        if (d < bestD) { bestD = d; best = i; }
      }
      return { ...it, cursor: best };
    });

    const offs = [
      session.hooks.change.tap(({ cause }) => {
        if (cause !== "action") session.setInteraction((it) => (it.selected >= 0 ? { ...it, selected: -1 } : it));
        settle();
      }, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    if (session.state.gone[session.interaction.cursor]) {
      const first = session.state.gone.findIndex((g) => !g);
      if (first >= 0) session.setInteraction((it) => ({ ...it, cursor: first }));
    }
    render();

    if (session.depth === 0 && !session.solved) {
      anim = animate(700, (t) => {
        order.forEach((i, k) => {
          const q = Math.min(1, Math.max(0, (t * 700 - (k / n) * 450) / 250));
          tiles[i]!.style.opacity = String(q);
        });
      }, ease.linear);
      void anim.then(() => { for (const t of tiles) t.style.opacity = ""; });
    }

    const rects = (list: Iterable<number>) => [...new Set(list)].map((i) => tiles[i]!.querySelector(".face")!.getBoundingClientRect());
    return {
      aspect: W / H,
      cells: { cols: Math.round(W / X), rows: Math.round(H / X) },
      commands: bindCommands(BINDINGS, {
        "mahjong.left": moveCursor(-1, 0),
        "mahjong.right": moveCursor(1, 0),
        "mahjong.up": moveCursor(0, -1),
        "mahjong.down": moveCursor(0, 1),
        "mahjong.pick": () => pick(session.interaction.cursor),
      }),
      target: () => session.interaction.cursor,
      preview: (st) => {
        preview = st as MahjongState | null;
        render();
      },
      locate: (focus) => {
        const f = focus as MahjongFocus | undefined;
        return rects([...(f?.tiles ?? []), ...(f?.look ?? [])]);
      },
      locateChange: (a, b) => {
        const x = (a as MahjongState).gone, y = (b as MahjongState).gone;
        return x.flatMap((g, i) => (g !== y[i] ? [i] : [])).map((i) => {
          const r = svg.getScreenCTM();
          const { x: px, y: py } = pos(i);
          if (!r) return new DOMRect();
          const a0 = new DOMPoint(px, py).matrixTransform(r), b0 = new DOMPoint(px + TW, py + TH).matrixTransform(r);
          return new DOMRect(a0.x, a0.y, b0.x - a0.x, b0.y - a0.y);
        });
      },
      destroy() {
        anim?.cancel();
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};
