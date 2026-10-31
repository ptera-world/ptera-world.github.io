import { h, style } from "../../../core/dom";
import type { DataItem } from "../../../core/types";

const CSS = `
.lk-map { position: relative; min-height: 0; border-radius: 10px; background: var(--panel-bg, var(--surface)); border: var(--panel-border, 1px solid var(--border)); overflow: hidden; }
.lk-map canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.lk-wait { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-dim); font-size: 13px; pointer-events: none; }
.lk-zoom { position: absolute; right: 6px; top: 6px; display: flex; flex-direction: column; gap: 4px; }
.lk-zoom button { width: 30px; height: 30px; padding: 0; border-radius: 6px; font-size: 16px; line-height: 1; }
.lk-tip { position: absolute; z-index: 2; display: none; align-items: center; gap: 6px; padding: 4px 8px 4px 4px; border-radius: 8px; background: var(--surface); color: var(--text); border: 1px solid var(--border); box-shadow: 0 4px 14px rgb(0 0 0 / .25); font-size: 13px; white-space: nowrap; transform: translate(-50%, calc(-100% - 12px)); }
.lk-tip.on { display: flex; }
.lk-tip img { width: 40px; height: 40px; image-rendering: pixelated; }
.lk-tip button { padding: 2px 10px; }
.lk-found { background: var(--verdict-match-c); }
.lk-hot { background: var(--lk-hot, color-mix(in srgb, var(--verdict-match-c) 55%, #f08a2c)); }
.lk-warm { background: var(--lk-warm, var(--verdict-near-c)); }
.lk-cold { background: var(--lk-cold, #d0473b); }
`;

/** 1 for the answer down to 0 for the farthest, on a log scale so the top ranks spread out. */
export function heatOf(rank: number, n: number): number {
  return n <= 1 ? 1 : Math.max(0, 1 - Math.log(rank) / Math.log(n));
}

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

export type Band = "found" | "hot" | "warm" | "cold";

export interface MapOptions {
  items: readonly DataItem[];
  /** The map: x, y per item in [0, 1]. */
  xy: Promise<Float64Array>;
  /** Ranks of every item against the answer (1: the answer). */
  rank(i: number): number;
  band(rank: number): Band;
  /** Items guessed, oldest first. */
  guessed(): readonly number[];
  /** The game is over: the answer and the true warmth everywhere show. */
  over(): boolean;
  answer: number;
  /** A small picture of an item, or null. */
  picture(it: DataItem): string | null;
  /** How to guess an item picked on the map, or null when guessing isn't allowed now. */
  guess(): ((i: number) => void) | null;
  noun: string;
}

/**
 * A map of every item, alike ones near each other: guesses as dots coloured by how warm they are,
 * the warmth glowing around them, pictures on the closest few. Point to name a dot, tap one to
 * guess it, scroll or pinch to zoom, drag to move.
 */
export function likenessMap(o: MapOptions): { el: HTMLElement; update(): void; zoomBy(f: number): void; reset(): void; destroy(): void } {
  style("likeness-map", CSS);
  const n = o.items.length;
  const canvas = h("canvas", { "aria-label": `map of every ${o.noun}, alike ones near each other`, role: "img" });
  const wait = h("div", { class: "lk-wait" }, "drawing the map…");
  const tipPic = h("img", { alt: "" });
  const tipName = h("strong");
  const tipRank = h("span", { class: "w-dim" });
  const tipGuess = h("button", { type: "button" }, "guess");
  const tip = h("div", { class: "lk-tip" }, tipPic, h("span", null, tipName, " ", tipRank), tipGuess);
  const zoomBtn = (label: string, title: string, run: () => void) => h("button", { type: "button", title, "aria-label": title, onclick: run }, label);
  const zoomBox = h("div", { class: "lk-zoom" }, zoomBtn("+", "zoom in", () => zoomBy(1.6)), zoomBtn("−", "zoom out", () => zoomBy(1 / 1.6)), zoomBtn("⤢", "show the whole map", () => reset()));
  const el = h("div", { class: "lk-map" }, canvas, wait, zoomBox, tip);

  let xy: Float64Array | null = null;
  let alive = true;
  o.xy.then((m) => { if (!alive) return; xy = m; wait.remove(); heatDirty = true; draw(); })
    .catch((e) => { wait.textContent = `the map couldn't be drawn: ${(e as Error).message}`; });

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
  const reset = () => { z = 1; cx = 0.5; cy = 0.5; draw(); };

  // colours from the theme, read when drawing
  const probe = (cls: string) => {
    const p = h("span", { class: cls, style: "position:absolute;visibility:hidden" });
    el.append(p);
    const c = getComputedStyle(p).backgroundColor;
    p.remove();
    return c;
  };
  let colours = { found: "", hot: "", warm: "", cold: "", dot: "", ring: "", focus: "" };
  const readColours = () => {
    const cs = getComputedStyle(el);
    colours = {
      found: probe("lk-found"), hot: probe("lk-hot"), warm: probe("lk-warm"), cold: probe("lk-cold"),
      dot: cs.getPropertyValue("--text-dim").trim() || "#888", ring: cs.getPropertyValue("--accent").trim() || "#48f", focus: cs.getPropertyValue("--focus").trim() || "#fa0",
    };
  };

  // the warmth around the guesses: each guess's heat spread with a gaussian, averaged; the grid
  // covers a margin around the map so halos at its edge fade out instead of being cut
  const HG = 80, PAD = 0.15, SPAN = 1 + 2 * PAD;
  const heatCanvas = h("canvas", { width: HG, height: HG });
  let heatDirty = true;
  const paintHeat = () => {
    heatDirty = false;
    const g = heatCanvas.getContext("2d");
    if (!g || !xy) return;
    const img = g.createImageData(HG, HG);
    const done = o.over();
    // after the game: the true warmth of everything; during: what the guesses say
    const at = (i: number) => [xy![2 * i]!, xy![2 * i + 1]!, heatOf(o.rank(i), n)] as const;
    const pts = done ? o.items.map((_, i) => at(i)) : o.guessed().map(at);
    const sigma = done ? 0.025 : 0.06;
    const inv = 1 / (2 * sigma * sigma);
    for (let gy = 0; gy < HG; gy++) {
      for (let gx = 0; gx < HG; gx++) {
        const x = -PAD + ((gx + 0.5) / HG) * SPAN, y = -PAD + ((gy + 0.5) / HG) * SPAN;
        let sw = 0, sh = 0;
        for (const [px, py, ht] of pts) {
          const w = Math.exp(-((px - x) ** 2 + (py - y) ** 2) * inv);
          sw += w;
          sh += w * ht;
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
  const imageOf = (it: DataItem): HTMLImageElement | null => {
    const url = o.picture(it);
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
    const done = o.over();
    const list = o.guessed();
    const guessed = new Set(list);
    // every item: a small dot
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
    // guesses: coloured by band; pictures on the closest few and the latest
    const order = [...guessed].sort((a, b) => o.rank(b) - o.rank(a));
    const latest = list.length ? list[list.length - 1]! : -1;
    const withPic = new Set([...order.slice(-8), latest, selected].filter((i) => i >= 0));
    if (done) withPic.add(o.answer);
    for (const i of order) {
      const [sx, sy] = toScreen(xy[2 * i]!, xy[2 * i + 1]!);
      g.fillStyle = colours[o.band(o.rank(i))];
      g.strokeStyle = "rgb(0 0 0 / .55)";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(sx, sy, r + 2.5, 0, 7);
      g.fill();
      g.stroke();
    }
    const size = Math.min(64, 36 + z * 3);
    for (const i of [...withPic].sort((a, b) => o.rank(b) - o.rank(a))) {
      const img = imageOf(o.items[i]!);
      if (!img) continue;
      const [sx, sy] = toScreen(xy[2 * i]!, xy[2 * i + 1]!);
      g.drawImage(img, sx - size / 2, sy - size * 0.8, size, size);
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
    if (done) ring(o.answer, colours.found, 3);
    ring(latest, colours.ring, 2.5);
    ring(selected >= 0 ? selected : hover, colours.focus, 2);
    placeTip();
  };

  const placeTip = () => {
    const i = selected >= 0 ? selected : hover;
    if (i < 0 || !xy) { tip.classList.remove("on"); return; }
    const it = o.items[i]!;
    const [sx, sy] = toScreen(xy[2 * i]!, xy[2 * i + 1]!);
    const known = o.guessed().includes(i) || o.over();
    const url = o.picture(it);
    tipPic.hidden = !url;
    if (url && tipPic.src !== url) tipPic.src = url;
    tipName.textContent = it.name;
    tipRank.textContent = known ? `#${o.rank(i)}` : "";
    tipGuess.style.display = selected === i && !known && o.guess() ? "" : "none";
    tip.style.left = `${Math.min(W - 60, Math.max(60, sx))}px`;
    tip.style.top = `${Math.max(64, sy)}px`;
    tip.classList.add("on");
  };
  tipGuess.addEventListener("click", () => {
    const g = o.guess();
    if (selected < 0 || !g) return;
    g(selected);
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
  const local = (e: { clientX: number; clientY: number }) => {
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
      draw();
    }
    if (pointers.size === 0) press = null;
  };
  canvas.addEventListener("pointerup", (e) => release(e, false));
  canvas.addEventListener("pointercancel", (e) => release(e, true));
  canvas.addEventListener("pointerleave", () => { if (hover >= 0) { hover = -1; draw(); } });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const at = local(e);
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), at.x, at.y);
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => { const at = local(e); zoomAt(2, at.x, at.y); });

  const resize = () => {
    const b = el.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = b.width;
    H = b.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    paint();
  };
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  ro?.observe(el);

  return {
    el,
    update() {
      heatDirty = true;
      colours.dot = "";
      if (selected >= 0 && o.guessed().includes(selected)) selected = -1;
      draw();
    },
    zoomBy,
    reset,
    destroy() {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
    },
  };
}
