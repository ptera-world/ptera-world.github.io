import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, style } from "../../core/dom";
import type { CommandDef, View } from "../../core/types";
import { nameEntry, VERDICT_CSS } from "../../lib/dataset/ui";
import { mediaUrl } from "../../lib/pokemon/media";
import { sprite } from "../../lib/pokemon/ui";
import type { PokemonItem } from "../../lib/pokemon/types";
import { bandOf, heatOf, isSolved, type ClosenessAction, type ClosenessDef, type ClosenessPuzzle, type ClosenessState, type Scored } from "./logic";
import { mapFor } from "./map";

const CSS = `
.pc-box { container-type: size; width: 100%; height: 100%; }
.pc-root { width: 100%; height: 100%; box-sizing: border-box; display: grid; gap: 8px;
  grid-template: "entry" auto "map" min(100cqw, 50cqh) "list" minmax(0, 1fr) / minmax(0, 1fr); }
@container (min-aspect-ratio: 6/5) {
  .pc-root { grid-template: "map entry" auto "map list" minmax(0, 1fr) / minmax(0, 1fr) minmax(250px, 38%); }
}
/* the right end of the top row stays clear for the shell's board menu button */
.pc-entry { grid-area: entry; display: flex; align-items: center; gap: 10px; min-width: 0; padding-right: 40px; }
.pc-entry .name-entry { flex: 1; max-width: none; }
.pc-count { color: var(--text-dim); font-size: 13px; white-space: nowrap; }
.pc-map { grid-area: map; position: relative; min-height: 0; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; }
.pc-map canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.pc-wait { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-dim); font-size: 13px; pointer-events: none; }
.pc-zoom { position: absolute; right: 6px; top: 6px; display: flex; flex-direction: column; gap: 4px; }
.pc-zoom button { width: 30px; height: 30px; padding: 0; border-radius: 6px; font-size: 16px; line-height: 1; }
.pc-tip { position: absolute; z-index: 2; display: none; align-items: center; gap: 6px; padding: 4px 8px 4px 4px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); box-shadow: 0 4px 14px rgb(0 0 0 / .25); font-size: 13px; white-space: nowrap; transform: translate(-50%, calc(-100% - 12px)); }
.pc-tip.on { display: flex; }
.pc-tip .pk-sprite { width: 40px; height: 40px; }
.pc-tip .pc-tip-rank { color: var(--text-dim); }
.pc-tip button { padding: 2px 10px; }
.pc-list { grid-area: list; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; padding-right: 2px; }
.pc-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) 60px 46px 40px; align-items: center; gap: 6px; padding: 1px 6px 1px 2px; border-radius: 7px; background: var(--surface); border: 1px solid transparent; cursor: pointer; font-size: 14px; }
.pc-row.latest { border-color: var(--accent); margin-bottom: 6px; }
.pc-row.sel { border-color: var(--focus); }
.pc-row .pk-sprite { width: 36px; height: 36px; }
.pc-row .pc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-row .pc-name small { color: var(--text-dim); margin-left: 4px; }
.pc-bar { height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
.pc-bar > i { display: block; height: 100%; border-radius: 4px; }
.pc-rank, .pc-temp { text-align: right; font-variant-numeric: tabular-nums; }
.pc-temp { color: var(--text-dim); font-size: 12px; }
.pc-found { background: var(--verdict-match-c); }
.pc-hot { background: var(--pc-hot, color-mix(in srgb, var(--verdict-match-c) 80%, var(--surface))); }
.pc-warm { background: var(--pc-warm, var(--verdict-near-c)); }
.pc-cold { background: var(--pc-cold, #d0473b); }
@container (max-width: 360px) { .pc-row { grid-template-columns: 32px minmax(0, 1fr) 40px 42px 36px; font-size: 13px; } }
`;

const BINDINGS = {
  "pokemon-closeness.type": { label: "type a guess", category: "closeness", keys: ["slash"], description: "put the cursor in the guess box" },
  "pokemon-closeness.zoom-in": { label: "zoom the map in", category: "closeness", keys: ["shift+equal", "equal"] },
  "pokemon-closeness.zoom-out": { label: "zoom the map out", category: "closeness", keys: ["minus"] },
  "pokemon-closeness.zoom-reset": { label: "show the whole map", category: "closeness", keys: ["0"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const BAND_SAMPLE = (cls: string) => `<span class="${cls}" style="display:inline-block;width:18px;height:10px;border-radius:5px"></span>`;

/** Heat colour: from blue (cold) through yellow to red (hot). */
function heatRgb(t: number): [number, number, number] {
  const stops: [number, number, number, number][] = [[0, 70, 110, 220], [0.5, 240, 200, 60], [0.8, 240, 120, 40], [1, 220, 40, 40]];
  for (let k = 1; k < stops.length; k++) {
    const [b, ...c1] = stops[k]!, [a, ...c0] = stops[k - 1]!;
    if (t <= b) {
      const f = (t - a) / (b - a);
      return [0, 1, 2].map((i) => Math.round(c0[i]! + (c1[i]! - c0[i]!) * f)) as [number, number, number];
    }
  }
  return [220, 40, 40];
}

export function closenessView(game: ClosenessDef): View<ClosenessPuzzle, ClosenessState, ClosenessAction, null> {
  return {
    id: "pokemon-closeness.map",
    name: "map",
    puzzle: game.def,
    controls: [
      { how: "type a name and press Enter, or pick it from the list", what: "guess it" },
      { how: "point at a dot on the map", what: "see which pokémon it is" },
      { how: "click or tap a dot, then its guess button", what: "guess that pokémon" },
      { how: "scroll or pinch on the map; drag it", what: "zoom; move around" },
      { how: "click a guess in the list", what: "show it on the map" },
    ],
    legend: [
      { sample: BAND_SAMPLE("pc-found"), meaning: "the answer" },
      { sample: BAND_SAMPLE("pc-hot"), meaning: "hot: among the closest 3%" },
      { sample: BAND_SAMPLE("pc-warm"), meaning: "warm: among the closest 15%" },
      { sample: BAND_SAMPLE("pc-cold"), meaning: "cold: further than that" },
      { sample: `<span style="display:inline-block;width:28px;height:12px;border-radius:6px;background:linear-gradient(90deg, rgb(70 110 220 / .5), rgb(240 200 60 / .6), rgb(220 40 40 / .7))"></span>`, meaning: "glow on the map: how warm the guesses around there are" },
    ],
    mount(root, { session, storage }) {
      style("verdict", VERDICT_CSS);
      style("pokemon-closeness", CSS);
      const p = session.puzzle;
      const sc: Scored = game.scored(p);
      const n = sc.items.length;
      const itemAt = (i: number): PokemonItem => sc.items[i]!;
      const idx = (id: string) => sc.index.get(id)!;
      const over = () => session.finished || isSolved(p, session.state);

      // --- entry ---
      const count = h("span", { class: "pc-count", "aria-live": "polite" });
      const entry = nameEntry<PokemonItem>({
        items: () => sc.items,
        used: (it) => session.state.guesses.includes(it.id),
        icon: (it) => sprite(it, { size: 36 }),
        placeholder: "guess a pokémon",
        pick: (it) => {
          if (session.locked || over()) return false;
          session.dispatch({ type: "guess", id: it.id });
        },
      });
      entry.input.dataset.command = "pokemon-closeness.type";
      const entryEl = h("div", { class: "pc-entry" }, entry.el, count);

      // --- map ---
      const canvas = h("canvas", { "aria-label": "map of every pokémon in the game, alike ones near each other", role: "img" });
      const wait = h("div", { class: "pc-wait" }, "drawing the map…");
      const tipSprite = h("span");
      const tipName = h("strong");
      const tipRank = h("span", { class: "pc-tip-rank" });
      const tipGuess = h("button", { type: "button" }, "guess");
      const tip = h("div", { class: "pc-tip" }, tipSprite, h("span", null, tipName, " ", tipRank), tipGuess);
      const zoomBtn = (cmd: string, label: string, title: string, run: () => void) => h("button", { type: "button", "data-command": cmd, title, "aria-label": title, onclick: run }, label);
      const zoomBox = h("div", { class: "pc-zoom" },
        zoomBtn("pokemon-closeness.zoom-in", "+", "zoom in", () => zoomBy(1.6)),
        zoomBtn("pokemon-closeness.zoom-out", "−", "zoom out", () => zoomBy(1 / 1.6)),
        zoomBtn("pokemon-closeness.zoom-reset", "⤢", "show the whole map", () => resetView()));
      const mapEl = h("div", { class: "pc-map" }, canvas, wait, zoomBox, tip);
      const list = h("div", { class: "pc-list", role: "list", "aria-label": "your guesses, closest first" });
      const wrap = h("div", { class: "pc-root" }, entryEl, mapEl, list);
      const box = h("div", { class: "pc-box" }, wrap);
      root.append(box);

      let xy: Float64Array | null = null;
      let alive = true;
      mapFor(sc, storage).then((m) => {
        if (!alive) return;
        xy = m;
        wait.remove();
        heatDirty = true;
        draw();
      }).catch((e) => { wait.textContent = `the map couldn't be drawn: ${(e as Error).message}`; });

      // view transform: map point (cx, cy) at the canvas centre, zoom z
      let z = 1, cx = 0.5, cy = 0.5;
      let W = 0, H = 0, dpr = 1;
      const scale = () => Math.min(W, H) * 0.92 * z;
      const toScreen = (x: number, y: number): [number, number] => [(x - cx) * scale() + W / 2, (y - cy) * scale() + H / 2];
      const toMap = (sx: number, sy: number): [number, number] => [(sx - W / 2) / scale() + cx, (sy - H / 2) / scale() + cy];
      const clampView = () => {
        z = Math.min(16, Math.max(1, z));
        const half = 0.5 / z;
        cx = Math.min(1 - half * 0.2, Math.max(half * 0.2, cx));
        cy = Math.min(1 - half * 0.2, Math.max(half * 0.2, cy));
        if (z === 1) { cx = 0.5; cy = 0.5; }
      };
      const zoomAt = (f: number, sx = W / 2, sy = H / 2) => {
        const [mx, my] = toMap(sx, sy);
        z *= f;
        clampView();
        const [nx, ny] = toMap(sx, sy);
        cx += mx - nx;
        cy += my - ny;
        clampView();
        draw();
      };
      const zoomBy = (f: number) => zoomAt(f);
      const resetView = () => { z = 1; cx = 0.5; cy = 0.5; draw(); };

      // colours from the theme, read when drawing
      const probe = (cls: string) => {
        const el = h("span", { class: cls, style: "position:absolute;visibility:hidden" });
        wrap.append(el);
        const c = getComputedStyle(el).backgroundColor;
        el.remove();
        return c;
      };
      let colours = { found: "", hot: "", warm: "", cold: "", dot: "", ring: "", focus: "" };
      const readColours = () => {
        const cs = getComputedStyle(wrap);
        colours = {
          found: probe("pc-found"), hot: probe("pc-hot"), warm: probe("pc-warm"), cold: probe("pc-cold"),
          dot: cs.getPropertyValue("--text-dim").trim() || "#888", ring: cs.getPropertyValue("--accent").trim() || "#48f", focus: cs.getPropertyValue("--focus").trim() || "#fa0",
        };
      };

      // the warmth around the guesses: each guess's heat spread with a gaussian, averaged
      // the grid covers a margin around the map so halos at its edge fade out instead of being cut
      const HG = 80, PAD = 0.15, SPAN = 1 + 2 * PAD;
      const heatCanvas = h("canvas", { width: HG, height: HG });
      let heatDirty = true;
      const paintHeat = () => {
        heatDirty = false;
        const g = heatCanvas.getContext("2d");
        if (!g || !xy) return;
        const img = g.createImageData(HG, HG);
        const st = session.state;
        const done = over();
        // after the game: the true warmth of everything; during: what the guesses say
        const pts = done
          ? sc.items.map((_, i) => [xy![2 * i]!, xy![2 * i + 1]!, heatOf(sc.close[i]!.rank, n)] as const)
          : st.guesses.map((id) => { const i = idx(id); return [xy![2 * i]!, xy![2 * i + 1]!, heatOf(sc.close[i]!.rank, n)] as const; });
        const sigma = done ? 0.025 : 0.06;
        const inv = 1 / (2 * sigma * sigma);
        for (let gy = 0; gy < HG; gy++) {
          for (let gx = 0; gx < HG; gx++) {
            const x = -PAD + ((gx + 0.5) / HG) * SPAN, y = -PAD + ((gy + 0.5) / HG) * SPAN;
            let sw = 0, sh = 0, peak = 0;
            for (const [px, py, ht] of pts) {
              const w = Math.exp(-((px - x) ** 2 + (py - y) ** 2) * inv);
              sw += w;
              sh += w * ht;
              if (w * ht > peak) peak = w * ht;
            }
            if (sw < 1e-6) continue;
            const t = sh / sw;
            const [r, gg, b] = heatRgb(t);
            const k = 4 * (gy * HG + gx);
            img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b;
            img.data[k + 3] = Math.round(255 * Math.min(1, sw) * (0.18 + 0.5 * t));
          }
        }
        g.putImageData(img, 0, 0);
      };

      const images = new Map<string, HTMLImageElement>();
      const imageOf = (it: PokemonItem): HTMLImageElement | null => {
        const url = mediaUrl(it, "sprite");
        if (!url) return null;
        let img = images.get(url);
        if (!img) {
          img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => draw();
          img.src = url;
          images.set(url, img);
        }
        return img.complete && img.naturalWidth ? img : null;
      };

      let hover = -1, selected = -1;
      let frame = 0;
      const draw = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = 0; paint(); });
      };
      const paint = () => {
        const g = canvas.getContext("2d");
        if (!g || !W || !H) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        if (!xy) return;
        if (!colours.dot) readColours();
        if (heatDirty) paintHeat();
        const [x0, y0] = toScreen(-PAD, -PAD);
        g.imageSmoothingEnabled = true;
        g.drawImage(heatCanvas, x0, y0, scale() * SPAN, scale() * SPAN);
        const done = over();
        const st = session.state;
        const guessed = new Set(st.guesses.map(idx));
        // every pokémon: a small dot
        g.fillStyle = colours.dot;
        g.globalAlpha = 0.45;
        const r = Math.min(4, 1.6 + z * 0.25);
        for (let i = 0; i < n; i++) {
          if (guessed.has(i)) continue;
          const [sx, sy] = toScreen(xy[2 * i]!, xy[2 * i + 1]!);
          if (sx < -5 || sy < -5 || sx > W + 5 || sy > H + 5) continue;
          g.beginPath();
          g.arc(sx, sy, r, 0, 7);
          g.fill();
        }
        g.globalAlpha = 1;
        // guesses: coloured by band; sprites on the closest few and the latest
        const order = [...guessed].sort((a, b) => sc.close[b]!.rank - sc.close[a]!.rank);
        const latest = st.guesses.length ? idx(st.guesses[st.guesses.length - 1]!) : -1;
        const withSprite = new Set([...order.slice(-8), latest, selected].filter((i) => i >= 0));
        if (done) withSprite.add(sc.answer);
        for (const i of order) {
          const [sx, sy] = toScreen(xy[2 * i]!, xy[2 * i + 1]!);
          g.fillStyle = colours[bandOf(sc.close[i]!.rank, n)];
          g.strokeStyle = "rgb(0 0 0 / .55)";
          g.lineWidth = 1;
          g.beginPath();
          g.arc(sx, sy, r + 2.5, 0, 7);
          g.fill();
          g.stroke();
        }
        const spriteSize = Math.min(64, 36 + z * 3);
        for (const i of [...withSprite].sort((a, b) => sc.close[b]!.rank - sc.close[a]!.rank)) {
          const img = imageOf(itemAt(i));
          if (!img) continue;
          const [sx, sy] = toScreen(xy[2 * i]!, xy[2 * i + 1]!);
          g.drawImage(img, sx - spriteSize / 2, sy - spriteSize * 0.8, spriteSize, spriteSize);
        }
        const ring = (i: number, colour: string, width: number) => {
          if (i < 0) return;
          const [sx, sy] = toScreen(xy![2 * i]!, xy![2 * i + 1]!);
          g.strokeStyle = colour;
          g.lineWidth = width;
          g.beginPath();
          g.arc(sx, sy, r + 6, 0, 7);
          g.stroke();
        };
        if (done) ring(sc.answer, colours.found, 3);
        ring(latest, colours.ring, 2.5);
        ring(selected >= 0 ? selected : hover, colours.focus, 2);
        placeTip();
      };

      const placeTip = () => {
        const i = selected >= 0 ? selected : hover;
        if (i < 0 || !xy) { tip.classList.remove("on"); return; }
        const it = itemAt(i);
        const [sx, sy] = toScreen(xy[2 * i]!, xy[2 * i + 1]!);
        const guessedIt = session.state.guesses.includes(it.id) || over();
        if (tipSprite.dataset.id !== it.id) { tipSprite.dataset.id = it.id; tipSprite.replaceChildren(sprite(it, { size: 40 })); }
        tipName.textContent = it.name;
        tipRank.textContent = guessedIt ? `#${sc.close[i]!.rank}` : "";
        tipGuess.style.display = selected === i && !guessedIt && !session.locked ? "" : "none";
        tip.style.left = `${Math.min(W - 60, Math.max(60, sx))}px`;
        tip.style.top = `${Math.max(64, sy)}px`;
        tip.classList.add("on");
      };
      tipGuess.addEventListener("click", () => {
        if (selected < 0 || session.locked || over()) return;
        session.dispatch({ type: "guess", id: itemAt(selected).id });
        selected = -1;
        draw();
      });

      const nearest = (sx: number, sy: number): number => {
        if (!xy) return -1;
        let best = -1, bd = 14 * 14;
        for (let i = 0; i < n; i++) {
          const [px, py] = toScreen(xy[2 * i]!, xy[2 * i + 1]!);
          const d = (px - sx) ** 2 + (py - sy) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        return best;
      };

      // pointers: one drags the map, two pinch; a press that doesn't move picks the dot under it
      const pointers = new Map<number, { x: number; y: number }>();
      let press: { x: number; y: number; moved: boolean } | null = null;
      let pinch: { d: number } | null = null;
      const local = (e: PointerEvent) => {
        const b = canvas.getBoundingClientRect();
        return { x: e.clientX - b.left, y: e.clientY - b.top };
      };
      canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture?.(e.pointerId);
        const at = local(e);
        pointers.set(e.pointerId, at);
        if (pointers.size === 1) press = { ...at, moved: false };
        else {
          press = null;
          const [a, b] = [...pointers.values()];
          pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
        }
      });
      canvas.addEventListener("pointermove", (e) => {
        const at = local(e);
        const prev = pointers.get(e.pointerId);
        if (!prev) {
          if (e.pointerType === "mouse") {
            const i = nearest(at.x, at.y);
            if (i !== hover) { hover = i; draw(); }
          }
          return;
        }
        pointers.set(e.pointerId, at);
        if (pointers.size >= 2 && pinch) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          if (pinch.d > 0) zoomAt(d / pinch.d, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
          pinch.d = d;
          return;
        }
        if (press && !press.moved && Math.hypot(at.x - press.x, at.y - press.y) > 5) press.moved = true;
        if (press?.moved) {
          const s = scale();
          cx -= (at.x - prev.x) / s;
          cy -= (at.y - prev.y) / s;
          clampView();
          draw();
        }
      });
      const release = (e: PointerEvent, cancelled: boolean) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!cancelled && press && !press.moved && pointers.size === 0) {
          const at = local(e);
          const i = nearest(at.x, at.y);
          selected = i === selected ? -1 : i;
          hover = -1;
          renderList();
          draw();
        }
        if (pointers.size === 0) press = null;
      };
      canvas.addEventListener("pointerup", (e) => release(e, false));
      canvas.addEventListener("pointercancel", (e) => release(e, true));
      canvas.addEventListener("pointerleave", () => { if (hover >= 0) { hover = -1; draw(); } });
      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const at = local(e as unknown as PointerEvent);
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), at.x, at.y);
      }, { passive: false });
      canvas.addEventListener("dblclick", (e) => { const at = local(e as unknown as PointerEvent); zoomAt(2, at.x, at.y); });

      const resize = () => {
        const b = mapEl.getBoundingClientRect();
        dpr = window.devicePixelRatio || 1;
        W = b.width;
        H = b.height;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        paint();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(mapEl);

      // --- list ---
      const row = (id: string, latest: boolean) => {
        const i = idx(id);
        const c = sc.close[i]!;
        const band = bandOf(c.rank, n);
        const el = h("div", { class: `pc-row${latest ? " latest" : ""}${selected === i ? " sel" : ""}`, role: "listitem", title: latest ? "your latest guess" : undefined },
          sprite(itemAt(i), { size: 36 }),
          h("span", { class: "pc-name" }, itemAt(i).name, session.state.hinted.includes(id) ? h("small", null, "hint") : null),
          h("span", { class: "pc-bar" }, h("i", { class: `pc-${band}`, style: `width: ${Math.max(4, Math.round(heatOf(c.rank, n) * 100))}%` })),
          h("span", { class: "pc-rank" }, `#${c.rank}`),
          h("span", { class: "pc-temp" }, `${c.temp}°`));
        el.addEventListener("click", () => { selected = selected === i ? -1 : i; renderList(); draw(); });
        return el;
      };
      const renderList = () => {
        const st = session.state;
        const last = st.guesses[st.guesses.length - 1];
        const sorted = [...st.guesses].sort((a, b) => sc.close[idx(a)]!.rank - sc.close[idx(b)]!.rank);
        list.replaceChildren(...(last && st.guesses.length > 1 ? [row(last, true)] : []), ...sorted.map((id) => row(id, false)));
        const k = st.guesses.length - (st.revealed ? 1 : 0);
        count.textContent = st.revealed ? `revealed after ${k}` : k ? `${k} ${k === 1 ? "guess" : "guesses"}` : "";
        entry.setDisabled(over() || session.locked);
      };

      const update = () => {
        heatDirty = true;
        if (selected >= 0 && session.state.guesses.includes(itemAt(selected).id)) selected = -1;
        renderList();
        draw();
      };
      const offs = [
        session.hooks.change.tap(update, { owner: "view" }),
        session.hooks.refresh.tap(() => { colours.dot = ""; update(); }, { owner: "view" }),
      ];
      renderList();
      if (matchMedia?.("(pointer: fine)").matches && !over()) setTimeout(() => entry.focus(), 0);

      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "pokemon-closeness.type": () => entry.focus(),
        "pokemon-closeness.zoom-in": () => zoomBy(1.6),
        "pokemon-closeness.zoom-out": () => zoomBy(1 / 1.6),
        "pokemon-closeness.zoom-reset": () => resetView(),
      }, {
        "pokemon-closeness.type": { when: () => !over() },
      });
      return {
        // the board bends to any shape: wide screens get map and list side by side, as wide as
        // leaves room for the shell's side panel; narrow ones stack them
        get aspect() {
          const w = window.innerWidth, hgt = window.innerHeight;
          return w > hgt * 1.1 ? Math.min(1.6, Math.max(1, (w - 380) / Math.max(200, hgt - 150))) : 0.62;
        },
        commands,
        destroy() {
          alive = false;
          if (frame) cancelAnimationFrame(frame);
          ro.disconnect();
          offs.forEach((f) => f());
          box.remove();
        },
      };
    },
  };
}
