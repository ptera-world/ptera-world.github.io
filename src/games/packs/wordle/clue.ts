import { h } from "../../core/dom";
import { createRng } from "../../core/rng";
import type { DataItem, Dataset, Media } from "../../core/types";
import { SOUND_STEPS, type Look } from "./params";

/** Per look, what each step shows: darkness, blur (share of the frame), zoom and circle (share of the item), tiles uncovered. */
const DARK = [0, 0.1, 0.2, 0.32, 0.48];
const BLUR = [7, 5, 3.4, 2.2, 1.3, 0.6];
const ZOOM = [0.25, 0.35, 0.47, 0.6, 0.78, 1];
const CIRCLE = [0.13, 0.19, 0.27, 0.37, 0.5, 0.66];
const GRID = 6;
const TILES = [3, 5, 8, 12, 17, 23];

export const CLUE_CSS = `
.wd-stage { position: relative; flex: none; align-self: center; width: var(--stage, 260px); aspect-ratio: 1; border-radius: 14px; overflow: hidden; container-type: size;
  background: var(--wd-stage, radial-gradient(circle at 50% 50%, #fffbe6 0%, #cfe6f7 70%, #9cc6e8 100%)); }
.wd-stage.text, .wd-stage.audio { aspect-ratio: auto; min-height: 5em; background: var(--surface-2); display: flex; align-items: center; justify-content: center; }
.wd-stage.small { --stage: 120px; }
.wd-pic { position: absolute; inset: 6%; }
.wd-pic.zoom { inset: 0; overflow: hidden; }
.wd-pic img { position: absolute; width: 100%; height: 100%; left: 0; top: 0; object-fit: contain; opacity: 0; transition: filter .8s ease, width .8s ease, height .8s ease, left .8s ease, top .8s ease, clip-path .8s ease, opacity .2s; }
.wd-pic img.ready { opacity: 1; }
.wd-pic img.pixel { image-rendering: pixelated; }
.wd-cover { position: absolute; display: grid; }
.wd-cover i { background: var(--surface-2); transition: opacity .6s ease; }
.wd-cover i.off { opacity: 0; }
.wd-entry { padding: 10px 14px; line-height: 1.45; font-size: 1.05em; max-width: 46em; }
.wd-blank { color: var(--text-dim); letter-spacing: -1px; }
.wd-sound { display: flex; gap: 10px; align-items: center; padding: 10px; }
.wd-sound button { width: 3em; height: 3em; border-radius: 50%; font-size: 1.2em; }
.wd-sound button.playing { outline: 3px solid var(--accent); }
.wd-answer { text-align: center; font-weight: 700; font-size: 1.15em; }
.wd-answer.miss { color: var(--danger); }
.wd-facts { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.wd-fact { padding: 2px 9px; border-radius: 99px; background: var(--surface-2); font-size: .9em; }
.wd-stage.shake { animation: wd-shake .35s ease; }
@keyframes wd-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
@media (prefers-reduced-motion: reduce) { .wd-pic img, .wd-cover i { transition: none; } .wd-stage.shake { animation: none; } }
`;

interface Shape {
  /** Bounding box of drawn pixels, as fractions of the image. */
  box: { x: number; y: number; w: number; h: number };
  /** Points (fractions) a first look may centre on: well inside the item, where it has detail. */
  spots: [number, number][];
}

const shapes = new Map<string, Shape>();

/** Where the item is in its picture, from the alpha channel (the picture is loaded in cors mode, so readable). */
function shapeOf(img: HTMLImageElement): Shape {
  const hit = shapes.get(img.src);
  if (hit) return hit;
  const N = 96;
  const whole: Shape = { box: { x: 0, y: 0, w: 1, h: 1 }, spots: [[0.5, 0.5]] };
  let data: Uint8ClampedArray;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, N, N);
    data = ctx.getImageData(0, 0, N, N).data;
  } catch {
    return whole;
  }
  const on = new Uint8Array(N * N);
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let i = 0; i < N * N; i++) {
    if (data[i * 4 + 3]! < 40) continue;
    on[i] = 1;
    const x = i % N, y = (i / N) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return whole;
  // summed-area table, so a window's coverage is four lookups
  const S = new Uint32Array((N + 1) * (N + 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) S[(y + 1) * (N + 1) + x + 1] = on[y * N + x]! + S[y * (N + 1) + x + 1]! + S[(y + 1) * (N + 1) + x]! - S[y * (N + 1) + x]!;
  const side = Math.max(x1 - x0, y1 - y0) + 1;
  const r = Math.max(1, Math.round((side * ZOOM[0]!) / 2));
  const sum = (ax: number, ay: number, bx: number, by: number) => S[by * (N + 1) + bx]! - S[ay * (N + 1) + bx]! - S[by * (N + 1) + ax]! + S[ay * (N + 1) + ax]!;
  // how much the colour varies in a window (sum of squared luminance minus the squared mean), so a
  // first look lands on detail (an eye, a stripe, an edge) rather than a flat patch of one colour
  const L = new Float64Array((N + 1) * (N + 1)), L2 = new Float64Array((N + 1) * (N + 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const l = on[y * N + x] ? 0.3 * data[i]! + 0.59 * data[i + 1]! + 0.11 * data[i + 2]! : 255;
    const k = (y + 1) * (N + 1) + x + 1;
    L[k] = l + L[k - N - 1]! + L[k - 1]! - L[k - N - 2]!;
    L2[k] = l * l + L2[k - N - 1]! + L2[k - 1]! - L2[k - N - 2]!;
  }
  const area = (T: Float64Array, ax: number, ay: number, bx: number, by: number) => T[by * (N + 1) + bx]! - T[ay * (N + 1) + bx]! - T[by * (N + 1) + ax]! + T[ay * (N + 1) + ax]!;
  const found: { at: [number, number]; spread: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!on[y * N + x]) continue;
    const ax = Math.max(0, x - r), ay = Math.max(0, y - r), bx = Math.min(N, x + r + 1), by = Math.min(N, y + r + 1);
    const n = (bx - ax) * (by - ay);
    if (sum(ax, ay, bx, by) < 0.7 * (2 * r + 1) ** 2) continue;
    const mean = area(L, ax, ay, bx, by) / n;
    found.push({ at: [(x + 0.5) / N, (y + 0.5) / N], spread: area(L2, ax, ay, bx, by) / n - mean * mean });
  }
  // the busier half, kept in reading order so a puzzle's spot always picks the same place
  const cut = found.map((f) => f.spread).sort((a, b) => a - b)[Math.floor(found.length / 2)] ?? 0;
  const spots = found.filter((f) => f.spread >= cut).map((f) => f.at);
  const box = { x: x0 / N, y: y0 / N, w: (x1 - x0 + 1) / N, h: (y1 - y0 + 1) / N };
  const out: Shape = { box, spots: spots.length ? spots : [[box.x + box.w / 2, box.y + box.h / 2]] };
  shapes.set(img.src, out);
  return out;
}

const spotOf = (sh: Shape, spot: number): [number, number] => sh.spots[Math.min(sh.spots.length - 1, Math.floor(spot * sh.spots.length))]!;

/** Place `img` in its square frame so the crop at `level` shows, centred between the first spot and the whole item. */
function placeZoom(img: HTMLImageElement, spot: number, level: number): void {
  const sh = shapeOf(img);
  const q0 = ZOOM[0]!, q = ZOOM[Math.min(level, ZOOM.length - 1)]!;
  const t = (q - q0) / (1 - q0);
  const [sx, sy] = spotOf(sh, spot);
  const bx = sh.box.x + sh.box.w / 2, by = sh.box.y + sh.box.h / 2;
  const cx = sx + (bx - sx) * t, cy = sy + (by - sy) * t;
  // the frame's side, as a share of the picture: the item's longer side times q (a bit of margin when whole)
  const side = Math.max(sh.box.w, sh.box.h) * q * (q >= 1 ? 1.08 : 1);
  const scale = 100 / side;
  img.style.width = img.style.height = `${scale}%`;
  img.style.left = `${50 - cx * scale}%`;
  img.style.top = `${50 - cy * scale}%`;
}

/** A round window on the spot, its radius a share of the item's longer side. */
function placeCircle(img: HTMLImageElement, spot: number, level: number, whole: boolean): void {
  if (whole) { img.style.clipPath = "circle(150% at 50% 50%)"; return; }
  const sh = shapeOf(img);
  const [sx, sy] = spotOf(sh, spot);
  const r = Math.max(sh.box.w, sh.box.h) * CIRCLE[Math.min(level, CIRCLE.length - 1)]!;
  img.style.clipPath = `circle(${(r * 100).toFixed(1)}% at ${(sx * 100).toFixed(1)}% ${(sy * 100).toFixed(1)}%)`;
}

/** Covers over the item's box; `level` of them lifted, in an order seeded by the spot. */
function placeTiles(frame: HTMLElement, img: HTMLImageElement, spot: number, level: number, whole: boolean): void {
  const sh = shapeOf(img);
  let cover = frame.querySelector<HTMLElement>(".wd-cover");
  if (!cover) {
    cover = h("div", { class: "wd-cover", "aria-hidden": "true" });
    cover.style.gridTemplate = `repeat(${GRID}, 1fr) / repeat(${GRID}, 1fr)`;
    for (let i = 0; i < GRID * GRID; i++) cover.append(h("i"));
    frame.append(cover);
  }
  Object.assign(cover.style, { left: `${sh.box.x * 100}%`, top: `${sh.box.y * 100}%`, width: `${sh.box.w * 100}%`, height: `${sh.box.h * 100}%` });
  const order = createRng(`tiles|${spot}`).shuffle(Array.from({ length: GRID * GRID }, (_, i) => i));
  const n = whole ? GRID * GRID : TILES[Math.min(level, TILES.length - 1)]!;
  const lifted = new Set(order.slice(0, n));
  [...cover.children].forEach((t, i) => t.classList.toggle("off", lifted.has(i)));
}

/** A picture clue: drawn once, then eased (or shown whole) in place so the change animates. */
export interface PictureClue {
  el: HTMLElement;
  set(level: number, whole: boolean): void;
}

export function pictureClue(m: Media, it: DataItem, look: Look, spot: number): PictureClue {
  const url = m.url(it);
  const zoom = look === "zoom";
  const frame = h("div", { class: `wd-pic${zoom ? " zoom" : ""}` });
  const img = h("img", { alt: "", crossorigin: "anonymous", draggable: "false", decoding: "async", class: m.pixel ? "pixel" : "" });
  let level = 0, whole = false;
  const apply = () => {
    img.style.filter = whole ? "" : look === "silhouette" ? `brightness(${DARK[Math.min(level, DARK.length - 1)]})` : look === "blur" ? `blur(${BLUR[Math.min(level, BLUR.length - 1)]}cqmin)` : "";
    if (!img.complete || !img.naturalWidth) return;
    if (zoom) placeZoom(img, spot, whole ? ZOOM.length - 1 : level);
    if (look === "circle") placeCircle(img, spot, level, whole);
    if (look === "tiles") placeTiles(frame, img, spot, level, whole);
  };
  // until it loads, nothing of a masked look shows
  if (look === "circle") img.style.clipPath = "circle(0% at 50% 50%)";
  img.addEventListener("load", () => { apply(); img.classList.add("ready"); });
  img.addEventListener("error", () => frame.replaceChildren(h("span", { style: "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#234" }, "the picture didn't load; check the connection")));
  if (url) img.src = url;
  frame.append(img);
  return { el: frame, set(l, w) { level = l; whole = w; apply(); } };
}

let audio: HTMLAudioElement | null = null;
let stopTimer = 0;

/** A sound clue: a play button that plays the share of it the level allows. */
export function soundClue(m: Media, it: DataItem): { el: HTMLElement; show(level: number, whole: boolean): void; play(): void; stop(): void } {
  const url = m.url(it);
  const btn = h("button", { type: "button", "aria-label": `play the ${m.label}`, "data-command": "wordle.play" }, "▶");
  const note = h("span");
  const status = h("span", { class: "w-dim" });
  let level = 0, whole = false;
  const play = () => {
    if (!url) return;
    clearTimeout(stopTimer);
    if (!audio || audio.dataset.url !== url) {
      audio?.pause();
      audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.dataset.url = url;
      audio.src = url;
      audio.volume = 0.7;
    }
    const a = audio;
    a.currentTime = 0;
    const done = () => btn.classList.remove("playing");
    a.onended = done;
    a.onerror = () => { done(); status.textContent = `the ${m.label} didn't load; check the connection and press play again`; audio = null; };
    btn.classList.add("playing");
    status.textContent = "";
    const share = whole ? 1 : SOUND_STEPS[Math.min(level, SOUND_STEPS.length - 1)]!;
    a.play().then(() => {
      const len = Number.isFinite(a.duration) ? a.duration : 1;
      if (share < 1) stopTimer = window.setTimeout(() => { a.pause(); done(); }, share * len * 1000);
    }).catch((e: Error) => {
      done();
      if (e.name !== "AbortError") status.textContent = e.name === "NotAllowedError" ? "press play to hear it" : "this couldn't be played";
    });
  };
  btn.addEventListener("click", () => play());
  const el = h("div", { class: "wd-sound" }, btn, note, status);
  return {
    el,
    show(l, w) {
      level = l; whole = w;
      const share = w ? 1 : SOUND_STEPS[Math.min(l, SOUND_STEPS.length - 1)]!;
      note.textContent = share < 1 ? `the first ${Math.round(share * 100)}%` : "all of it";
    },
    play,
    stop() { clearTimeout(stopTimer); audio?.pause(); audio = null; },
  };
}

/** Names blanked out of a text clue. */
export const NAME_BLANK = "▬▬▬";

const blankers = new WeakMap<Dataset, RegExp>();
const escape = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]");

/** The text with every item's name (and alias) blanked out, the answer's own first. */
export function redact(d: Dataset, it: DataItem, text: string): string {
  let re = blankers.get(d);
  if (!re) {
    const names = new Set<string>();
    for (const x of d.items()) for (const n of [x.name, ...(x.aliases ?? [])]) if (n.length >= 3) names.add(n);
    const alt = [...names].sort((a, b) => b.length - a.length).map(escape);
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt.join("|")})(?![\\p{L}\\p{N}])`, "giu");
    blankers.set(d, re);
  }
  const own = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[it.name, ...(it.aliases ?? [])].map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return text.replace(own, NAME_BLANK).replace(re, NAME_BLANK);
}

export function textClue(d: Dataset, it: DataItem, attr: string): HTMLElement {
  const parts = redact(d, it, String(it.values[attr] ?? "")).split(NAME_BLANK);
  return h("div", { class: "wd-entry" }, parts.flatMap((t, j) => (j ? [h("span", { class: "wd-blank", "aria-label": "a name" }, NAME_BLANK), t] : [t])));
}
