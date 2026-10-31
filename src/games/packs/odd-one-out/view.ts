import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, inputIs, style } from "../../core/dom";
import type { DataItem, View } from "../../core/types";
import { applyLook } from "../../lib/dataset/look";
import { type DataSource, cellCount, type OddRound, idAt, isOver, mistakesMade, roundDone, type OddAction, type OddFocus, type OddInteraction, type OddPuzzle, type OddState } from "./logic";

/** How long a found (or missed) odd one stays showing before the next grid comes in. */
const HOLD_MS = 800;

const CSS = `
.fs { container-type: size; width: 100%; height: 100%; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; padding: 4px; font-family: var(--font); color: var(--text); user-select: none; -webkit-user-select: none; }
.fs-bar { padding-right: 40px; display: flex; gap: 12px; align-items: center; font-size: 15px; height: 24px; font-variant-numeric: tabular-nums; }
.fs-lives { letter-spacing: 1px; color: var(--danger, #c33); }
.fs-lives .gone { opacity: .25; }
.fs-clock { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
.fs-clock > div { height: 100%; background: var(--accent); transform-origin: left; }
.fs-clock.low > div { background: var(--danger, #c33); }
.fs-grid { flex: 1; min-height: 0; aspect-ratio: 1; max-width: 100%; margin: 0 auto; display: grid; gap: 4px; touch-action: manipulation; }
.fs-cell { position: relative; border: 0; padding: 0; border-radius: 10%; background: var(--cell); overflow: hidden; cursor: pointer; outline: none; }
.fs-cell { container-type: size; }
.fs-cell .fs-pic { position: absolute; inset: 4%; overflow: hidden; pointer-events: none; }
.fs-cell img { position: absolute; image-rendering: pixelated; pointer-events: none; opacity: 0; transition: opacity .15s; }
.fs-cell .fs-pic.flip { transform: scaleX(-1); }
.fs.ready .fs-cell img { opacity: 1; }
@media (hover: hover) { .fs-cell:hover { box-shadow: inset 0 0 0 2px var(--border); } }
.fs-cell.wrong { cursor: default; }
.fs-cell.wrong img { opacity: .3 !important; filter: grayscale(1); }
.fs-cell.wrong::after { content: "✕"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 60cqmin; color: var(--danger, #c33); font-weight: 800; }
.fs-cell.found { box-shadow: inset 0 0 0 4px var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); animation: fs-pop .5s; }
.fs-cell.missed { box-shadow: inset 0 0 0 4px var(--danger, #c33); animation: fs-pop .5s; }
.fs-cell.found::before, .fs-cell.missed::before { content: "✨"; position: absolute; right: 6%; top: 4%; font-size: 14px; }
.fs-cell.hint { box-shadow: inset 0 0 0 3px var(--hint); }
.fs-cell.cursor:not(.found):not(.missed) { box-shadow: inset 0 0 0 3px var(--focus); }
${inputIs("pointer")} .fs-cell.cursor:not(.hint):not(.found):not(.missed) { box-shadow: none; }
.fs-cell.shake { animation: fs-shake .3s; }
@keyframes fs-pop { 50% { transform: scale(1.08); } }
@keyframes fs-shake { 25%, 75% { transform: translateX(-4px); } 50% { transform: translateX(4px); } }
.fs-wait { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-dim); font-size: 14px; pointer-events: none; }
.fs-gridwrap { position: relative; flex: 1; min-height: 0; display: flex; }
`;

const BINDINGS = {
  "odd-one-out.left": { label: "cursor left", category: "odd one out", keys: ["ArrowLeft", "a"] },
  "odd-one-out.right": { label: "cursor right", category: "odd one out", keys: ["ArrowRight", "d"] },
  "odd-one-out.up": { label: "cursor up", category: "odd one out", keys: ["ArrowUp", "w"] },
  "odd-one-out.down": { label: "cursor down", category: "odd one out", keys: ["ArrowDown", "s"] },
  "odd-one-out.pick": { label: "pick", category: "odd one out", keys: ["space", "Enter"], description: "pick the one under the keyboard cursor" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const now = () => performance.now();

interface Box { x0: number; y0: number; x1: number; y1: number }
const boxCache = new Map<string, Box | null>();

/** The box (fractions of the image) around a sprite's drawn pixels; null when it can't be read. */
function boxOf(img: HTMLImageElement): Box | null {
  if (boxCache.has(img.src)) return boxCache.get(img.src)!;
  let out: Box | null = null;
  try {
    const w = img.naturalWidth, hgt = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = hgt;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, hgt).data;
    let x0 = w, y0 = hgt, x1 = -1, y1 = -1;
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3]! < 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 >= 0) out = { x0: x0 / w, y0: y0 / hgt, x1: (x1 + 1) / w, y1: (y1 + 1) / hgt };
  } catch {
    out = null;
  }
  boxCache.set(img.src, out);
  return out;
}

export function makeView(data: DataSource, puzzle: { id: string }): View<OddPuzzle, OddState, OddAction, OddInteraction> {
  return {
    id: "odd-one-out.grid",
    name: "grid",
    puzzle,
    controls: [{ how: "click or tap a picture", what: "pick it as the odd one" }],
    legend: [
      { sample: `<span style="color:var(--danger,#c33);font-weight:800">✕</span>`, meaning: "a wrong pick (a mistake)" },
      { sample: `<span style="color:var(--danger,#c33)">♥♥<span style="opacity:.25">♥</span></span>`, meaning: "mistakes you can still make" },
      { sample: `<span style="display:inline-block;width:40px;height:8px;border-radius:99px;background:var(--accent)"></span>`, meaning: "time left this round" },
    ],
    mount(root, { session }) {
      style("odd-one-out", CSS);
      const d = data.get(session.puzzle.dataset);
      const byId = new Map((d?.items() ?? []).map((it) => [it.id, it]));
      const p = session.puzzle;

      const lives = h("span", { class: "fs-lives" });
      const label = h("span");
      const clockFill = h("div");
      const clock = h("div", { class: "fs-clock" }, clockFill);
      const bar = h("div", { class: "fs-bar" }, label, lives, p.time ? clock : null);
      const grid = h("div", { class: "fs-grid", role: "grid" });
      const wait = h("div", { class: "fs-wait" });
      const box = h("div", { class: "fs" }, bar, h("div", { class: "fs-gridwrap" }, grid, wait));
      root.append(box);
      const unlook = applyLook(d, box);

      /** The round on screen: lags the state by HOLD_MS after a round ends, so the find can be seen. */
      let shown = session.state.rounds.length - 1;
      let holdUntil = 0;
      let holdTimer = 0;
      let built = -1;
      let ready = false;
      /** session.elapsedMs() when the shown round's pictures had all loaded. */
      let startedAt = 0;
      let timedOut = -1;
      let cells: HTMLButtonElement[] = [];

      const odd = d?.media?.[p.variant], plain = d?.media?.[p.plain];
      const url = (it: DataItem | undefined, isOdd: boolean) => (it ? (isOdd ? odd : plain)?.url(it) ?? null : null);

      /** Fit each cell's picture to its item: the box around what both its pictures draw, the same for every cell of an item so none stands out by position. */
      const frame = (r: OddRound, loaded: Map<string, HTMLImageElement>) => {
        const boxes = new Map<string, Box>();
        for (const id of new Set(r.ids)) {
          const it = byId.get(id);
          let b: Box | null = null;
          for (const isOdd of [false, true]) {
            const im = loaded.get(url(it, isOdd) ?? "");
            const bb = im ? boxOf(im) : null;
            if (bb) b = b ? { x0: Math.min(b.x0, bb.x0), y0: Math.min(b.y0, bb.y0), x1: Math.max(b.x1, bb.x1), y1: Math.max(b.y1, bb.y1) } : bb;
          }
          boxes.set(id, b ?? { x0: 0, y0: 0, x1: 1, y1: 1 });
        }
        cells.forEach((cell, c) => {
          const img = cell.querySelector("img");
          const b = boxes.get(idAt(r, c));
          if (!img || !b) return;
          const side = Math.max(b.x1 - b.x0, b.y1 - b.y0);
          const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
          const k = 100 / side;
          img.style.width = img.style.height = `${k}%`;
          img.style.left = `${50 - cx * k}%`;
          img.style.top = `${50 - cy * k}%`;
        });
      };

      const build = (i: number) => {
        built = i;
        ready = false;
        box.classList.remove("ready");
        const r = p.rounds[i]!;
        grid.style.gridTemplateColumns = `repeat(${r.size}, 1fr)`;
        grid.style.gridTemplateRows = `repeat(${r.size}, 1fr)`;
        const flips = new Set(r.flips);
        const urls = new Set<string>();
        cells = Array.from({ length: cellCount(r) }, (_, c) => {
          const src = url(byId.get(idAt(r, c)), c === r.odd);
          if (src) urls.add(src);
          const b = h("button", { type: "button", class: "fs-cell", "data-cell": c, tabindex: "-1", "aria-label": `row ${Math.floor(c / r.size) + 1}, column ${(c % r.size) + 1}` },
            src ? h("span", { class: `fs-pic${flips.has(c) ? " flip" : ""}` }, h("img", { src, alt: "", crossorigin: "anonymous", draggable: "false" })) : null);
          return b;
        });
        grid.replaceChildren(...cells);
        // the round starts (and its clock runs) once every picture is in
        let left = urls.size;
        const loaded = new Map<string, HTMLImageElement>();
        wait.textContent = "";
        const waitTimer = window.setTimeout(() => { if (built === i && !ready) wait.textContent = "loading…"; }, 400);
        const one = () => {
          if (--left > 0 || built !== i) return;
          clearTimeout(waitTimer);
          wait.textContent = "";
          ready = true;
          frame(r, loaded);
          startedAt = session.elapsedMs();
          box.classList.add("ready");
          render();
        };
        if (!left) one();
        for (const u of urls) {
          const im = new Image();
          im.crossOrigin = "anonymous";
          im.onload = () => { loaded.set(u, im); one(); };
          im.onerror = () => { clearTimeout(waitTimer); if (built === i) wait.textContent = "a picture didn't load; check the connection"; };
          im.src = u;
        }
        // fetch the next round's pictures meanwhile
        const nx = p.rounds[i + 1];
        if (nx) for (const id of new Set(nx.ids)) for (const isOdd of [false, true]) {
          const u = url(byId.get(id), isOdd);
          if (u) { const im = new Image(); im.crossOrigin = "anonymous"; im.src = u; }
        }
      };

      const render = () => {
        const st = session.state;
        const i = shown;
        if (built !== i) build(i);
        const r = p.rounds[i]!;
        const play = st.rounds[i] ?? { wrong: [] };
        const over = isOver(p, st);
        const wrong = new Set(play.wrong);
        const hint = session.activeHint?.focus as OddFocus | undefined;
        const hinted = new Set(i === st.rounds.length - 1 ? hint?.cells ?? [] : []);
        const cur = session.interaction.cursor;
        cells.forEach((b, c) => {
          const isShiny = c === r.odd;
          b.className = "fs-cell"
            + (wrong.has(c) ? " wrong" : "")
            + (isShiny && play.found ? " found" : "")
            + (isShiny && !play.found && (play.timedOut || over) ? " missed" : "")
            + (hinted.has(c) ? " hint" : "")
            + (c === cur ? " cursor" : "");
        });
        const left = p.mistakes - mistakesMade(st);
        label.textContent = `${i + 1} / ${p.rounds.length}`;
        lives.replaceChildren(...Array.from({ length: p.mistakes }, (_, k) => h("span", { class: k < left ? "" : "gone" }, "♥")));
        lives.setAttribute("aria-label", `${Math.max(0, left)} more mistakes allowed`);
        lives.hidden = p.mistakes === 0;
      };

      const active = () => ready && !session.locked && now() >= holdUntil && shown === session.state.rounds.length - 1 && !isOver(p, session.state);

      const pick = (cell: number) => {
        if (!active()) return;
        session.setInteraction((x) => ({ ...x, cursor: cell }));
        const before = session.state;
        session.dispatch({ type: "pick", cell });
        if (session.state !== before && !session.state.rounds[shown]?.found) {
          const b = cells[cell];
          b?.classList.remove("shake");
          void b?.offsetWidth;
          b?.classList.add("shake");
        }
      };

      grid.addEventListener("pointerdown", (e) => {
        const v = (e.target as Element).closest("[data-cell]")?.getAttribute("data-cell");
        if (v == null || e.button !== 0) return;
        e.preventDefault();
        pick(Number(v));
      });

      const onChange = () => {
        const st = session.state;
        const last = st.rounds.length - 1;
        clearTimeout(holdTimer);
        if (last > shown && roundDone(st.rounds[shown] ?? { wrong: [] })) {
          // keep the finished grid up a moment, then the next
          holdUntil = now() + HOLD_MS;
          render();
          holdTimer = window.setTimeout(() => {
            shown = session.state.rounds.length - 1;
            session.setInteraction((x) => ({ ...x, cursor: Math.min(x.cursor, cellCount(p.rounds[shown]!) - 1) }));
            render();
          }, HOLD_MS);
          return;
        }
        shown = last;
        render();
      };

      // the clock: a frame loop only while a timed round is running
      let raf = 0;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        if (!p.time) return;
        const total = p.time * 1000;
        const running = active();
        const used = running ? session.elapsedMs() - startedAt : 0;
        const frac = Math.max(0, 1 - used / total);
        clockFill.style.transform = `scaleX(${running || !ready ? frac : 0})`;
        clock.classList.toggle("low", frac < 0.25);
        if (running && used >= total && timedOut !== shown) {
          timedOut = shown;
          session.dispatch({ type: "timeout" });
        }
      };
      if (p.time) raf = requestAnimationFrame(tick);

      const move = (dx: number, dy: number) => () => session.setInteraction((x) => {
        const n = p.rounds[shown]!.size;
        const cx = Math.min(n - 1, Math.max(0, (x.cursor % n) + dx));
        const cy = Math.min(n - 1, Math.max(0, Math.floor(x.cursor / n) + dy));
        return { ...x, cursor: cy * n + cx };
      });

      const offs = [
        session.hooks.change.tap(onChange, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (list: number[]) => list.map((c) => cells[c]?.getBoundingClientRect()).filter((x): x is DOMRect => !!x);
      return {
        aspect: 0.93,
        endDelayMs: HOLD_MS,
        // the biggest grid, counted in double cells so a sprite never gets smaller than two minimum cells
        cells: (() => { const n = Math.max(...p.rounds.map((r) => r.size)) * 2; return { cols: n, rows: n + 1 }; })(),
        commands: bindCommands(BINDINGS, {
          "odd-one-out.left": move(-1, 0),
          "odd-one-out.right": move(1, 0),
          "odd-one-out.up": move(0, -1),
          "odd-one-out.down": move(0, 1),
          "odd-one-out.pick": () => pick(session.interaction.cursor),
        }, { "odd-one-out.pick": { menu: "board" } }),
        target: () => session.interaction.cursor,
        locate: (focus) => rects((focus as OddFocus | undefined)?.cells ?? []),
        destroy() {
          offs.forEach((f) => f());
          clearTimeout(holdTimer);
          cancelAnimationFrame(raf);
          unlook();
          box.remove();
        },
      };
    },
  };
}
