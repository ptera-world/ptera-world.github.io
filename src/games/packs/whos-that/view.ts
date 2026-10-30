import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, style } from "../../core/dom";
import type { View } from "../../core/types";
import { nameEntry } from "../../lib/dataset/ui";
import { mediaUrl } from "../../lib/pokemon/media";
import { poolOf } from "../../lib/pokemon/pool";
import type { PokemonDataset, PokemonItem } from "../../lib/pokemon/types";
import { sprite, typeChip } from "../../lib/pokemon/ui";
import { BLANK, CLUE_LABELS, easeLevel, extrasShown, extraText, finished, isVisual, named, redact, roundOver, type Clue, type WhoAction, type WhoPuzzle, type WhoState } from "./logic";

/** Per ease level. Silhouette: brightness; blur: radius in % of the picture; zoom: share of the pokémon in view; cry: share of the cry played (most last about a second). */
const DARK = [0, 0.1, 0.2, 0.32, 0.48];
const BLUR = [7, 5, 3.4, 2.2, 1.3, 0.6];
const ZOOM = [0.25, 0.35, 0.47, 0.6, 0.78, 1];
const CLIP = [0.25, 0.4, 0.6, 0.8, 1];
/** How long the answer takes to come in, so the results wait for it. */
const REVEAL_MS = 900;

const CSS = `
.wt { container-type: size; width: 100%; height: 100%; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; padding: 6px; font-family: var(--font); color: var(--text); }
.wt-bar { padding-right: 40px; display: flex; gap: 12px; align-items: baseline; font-size: 15px; min-height: 1.4em; font-variant-numeric: tabular-nums; }
.wt-bar .wt-left { color: var(--text-dim); }
.wt-pips { display: inline-flex; gap: 3px; }
.wt-pip { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--text-dim); box-sizing: border-box; }
.wt-pip.used { background: var(--danger, #c33); border-color: var(--danger, #c33); }
.wt-pip.right { background: var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); border-color: transparent; }
.wt-stage { flex: 1 1 auto; min-height: 0; position: relative; display: flex; align-items: center; justify-content: center; border-radius: 12px; overflow: hidden;
  background: var(--wt-stage, radial-gradient(circle at 50% 50%, #fffbe6 0%, #cfe6f7 70%, #9cc6e8 100%)); }
.wt-stage.text { background: var(--surface); border: 1px solid var(--border); }
.wt-pic { position: relative; height: 92%; aspect-ratio: 1; max-width: 92%; overflow: hidden; container-type: size; }
.wt-pic img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: filter .8s ease, opacity .2s; user-select: none; -webkit-user-drag: none; pointer-events: none; }
.wt-pic img.ready { opacity: 1; }
.wt-pic img.pixel { image-rendering: pixelated; }
.wt-pic.zoom img { object-fit: fill; transition: left .6s ease, top .6s ease, width .6s ease, height .6s ease, opacity .2s; }
.wt-pic.zoom { border-radius: 50%; box-shadow: inset 0 0 0 3px rgb(0 0 0 / .15); background: rgb(255 255 255 / .35); }
.wt-stage.shake { animation: wt-shake .35s; }
@keyframes wt-shake { 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
.wt-cry { width: min(40cqmin, 140px); aspect-ratio: 1; border-radius: 50%; border: 0; font-size: min(14cqmin, 48px); background: var(--accent); color: #fff; cursor: pointer; box-shadow: 0 4px 14px rgb(0 0 0 / .25); }
.wt-cry.playing { animation: wt-pulse .5s infinite alternate; }
@keyframes wt-pulse { to { transform: scale(1.07); } }
.wt-crywrap { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #234; font-size: 14px; text-align: center; padding: 8px; }
.wt-entry { padding: 12px 16px; overflow-y: auto; max-height: 100%; box-sizing: border-box; font-size: clamp(14px, 4.4cqmin, 20px); line-height: 1.45; }
.wt-entry .wt-genus { display: block; margin-bottom: 8px; color: var(--accent); font-weight: 700; }
.wt-entry .wt-blank { display: inline-block; letter-spacing: -1px; color: var(--text-dim); }
.wt-facts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 24px; font-size: 14px; }
.wt-fact { padding: 1px 8px; border-radius: 99px; background: var(--surface-2); }
.wt-fact.pk-wrap { padding: 0; background: none; display: inline-flex; gap: 4px; }
.wt-wrong { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 14px; min-height: 0; }
.wt-wrong span { color: var(--text-dim); text-decoration: line-through; }
.wt-wrong span.form { color: var(--warn); text-decoration: none; }
.wt-entrybar { display: flex; gap: 6px; align-items: stretch; }
.wt-entrybar .name-entry { max-width: none; flex: 1; }
.wt-entrybar .name-entry ul { top: auto; bottom: 100%; margin: 0 0 2px; max-height: min(260px, 55cqh); }
.wt-entrybar button { white-space: nowrap; padding: 6px 12px; }
.wt-entrybar button.wt-next { flex: 1; font-size: 17px; font-weight: 700; padding: 8px; }
.wt-answer { position: absolute; left: 0; right: 0; bottom: 6px; text-align: center; font-size: clamp(18px, 7cqmin, 30px); font-weight: 800; color: #123; text-shadow: 0 1px 0 #fff; animation: wt-in .5s ease both; }
.wt-answer small { display: block; font-size: 14px; font-weight: 600; }
.wt-answer.miss small { color: var(--danger, #c33); }
@keyframes wt-in { from { opacity: 0; transform: translateY(8px); } }
.wt-stage.hinted { outline: 3px solid var(--hint); outline-offset: -3px; }
`;

const BINDINGS = {
  "whos-that.next": { label: "next pokémon", category: "who's that pokémon", keys: ["Enter"], description: "after a pokémon is named or missed" },
  "whos-that.pass": { label: "give up on this one", category: "who's that pokémon", description: "show who it is (counts as missed)" },
  "whos-that.cry": { label: "play the cry", category: "who's that pokémon", keys: ["shift+Enter"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

/** The picture a visual clue (and every reveal) uses: the chosen kind, else whichever exists. */
function pictureOf(it: PokemonItem, want: "art" | "sprite"): { url: string; pixel: boolean } | null {
  const order: ("art" | "sprite")[] = want === "art" ? ["art", "sprite"] : ["sprite", "art"];
  for (const k of order) {
    const url = mediaUrl(it, k);
    if (url) return { url, pixel: k === "sprite" };
  }
  return null;
}

interface Shape {
  /** Bounding box of drawn pixels, as fractions of the image. */
  box: { x: number; y: number; w: number; h: number };
  /** Points (fractions) a first zoom may centre on: well inside the pokémon. */
  spots: [number, number][];
}

const shapes = new Map<string, Shape>();

/** Where the pokémon is in its picture, from the alpha channel (the picture is loaded in cors mode, so readable). */
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

/** Place `img` in its square frame so the crop at `level` shows, centred between the first spot and the whole pokémon. */
function placeZoom(img: HTMLImageElement, spot: number, level: number): void {
  const sh = shapeOf(img);
  const q0 = ZOOM[0]!, q = ZOOM[Math.min(level, ZOOM.length - 1)]!;
  const t = (q - q0) / (1 - q0);
  const [sx, sy] = sh.spots[Math.min(sh.spots.length - 1, Math.floor(spot * sh.spots.length))]!;
  const bx = sh.box.x + sh.box.w / 2, by = sh.box.y + sh.box.h / 2;
  const cx = sx + (bx - sx) * t, cy = sy + (by - sy) * t;
  // the frame's side, as a share of the picture: the pokémon's longer side times q (a bit of margin when whole)
  const side = Math.max(sh.box.w, sh.box.h) * q * (q >= 1 ? 1.08 : 1);
  const scale = 100 / side;
  img.style.width = img.style.height = `${scale}%`;
  img.style.left = `${50 - cx * scale}%`;
  img.style.top = `${50 - cy * scale}%`;
}

let audio: HTMLAudioElement | null = null;
let stopTimer = 0;

export function makeView(ds: () => PokemonDataset | undefined, puzzle: { id: string }): View<WhoPuzzle, WhoState, WhoAction, unknown> {
  return {
    id: "whos-that.stage",
    name: "stage",
    puzzle,
    controls: [
      { how: "type a name, then pick it from the list (or press Enter)", what: "guess" },
      { how: "click or tap the play button", what: "hear the cry (each wrong guess plays more of it)" },
    ],
    legend: [
      { sample: `<span style="display:inline-flex;gap:3px"><span style="width:10px;height:10px;border-radius:50%;border:1.5px solid var(--text-dim);display:inline-block;box-sizing:border-box"></span><span style="width:10px;height:10px;border-radius:50%;background:var(--danger,#c33);display:inline-block"></span></span>`, meaning: "guesses left, and used" },
      { sample: `<span style="color:var(--warn)">Raichu</span>`, meaning: "right pokémon, but a different form of it" },
      { sample: `<span style="color:var(--text-dim)">${BLANK}</span>`, meaning: "a pokémon's name, blanked out of a dex entry" },
    ],
    mount(root, { session }) {
      style("whos-that", CSS);
      const d = ds();
      const p = session.puzzle;
      const all = d?.items() ?? [];
      const byId = new Map(all.map((it) => [it.id, it]));
      let guessable: readonly PokemonItem[];
      try {
        guessable = d ? poolOf(d, p.pool) : [];
      } catch {
        guessable = all;
      }
      const fine = typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;

      const bar = h("div", { class: "wt-bar" });
      const stage = h("div", { class: "wt-stage" });
      const facts = h("div", { class: "wt-facts" });
      const wrong = h("div", { class: "wt-wrong" });
      const entryBar = h("div", { class: "wt-entrybar" });
      const box = h("div", { class: "wt" }, bar, stage, facts, wrong, entryBar);
      root.append(box);

      const cur = () => session.state.rounds.length - 1;
      const clue = (i: number): Clue => p.clues[i]!;
      const answer = (i: number) => byId.get(p.answers[i]!);
      const entry = nameEntry<PokemonItem>({
        items: () => guessable,
        used: (it) => session.state.rounds[cur()]!.guesses.includes(it.id),
        icon: (it) => (isVisual(clue(cur())) ? null : sprite(it, { size: 36, alt: "" })),
        pick: (it) => session.dispatch({ type: "guess", id: it.id }),
        placeholder: "who's that pokémon?",
        limit: 7,
      });
      const passBtn = h("button", { type: "button", "data-command": "whos-that.pass" }, "give up");
      passBtn.addEventListener("click", () => run("pass"));
      const nextBtn = h("button", { type: "button", class: "wt-next", "data-command": "whos-that.next" }, "next pokémon");
      nextBtn.addEventListener("click", () => run("next"));

      const run = (what: "pass" | "next") => session.dispatch({ type: what });

      // --- the cry ---
      let cryStatus: HTMLElement | null = null;
      let cryBtn: HTMLButtonElement | null = null;
      const playCry = (it: PokemonItem, share: number) => {
        const url = mediaUrl(it, "cry");
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
        const done = () => cryBtn?.classList.remove("playing");
        a.onended = done;
        a.onerror = () => {
          done();
          if (cryStatus) cryStatus.textContent = "the cry didn't load; check the connection and press play again";
          audio = null;
        };
        cryBtn?.classList.add("playing");
        if (cryStatus) cryStatus.textContent = "";
        a.play().then(() => {
          const len = Number.isFinite(a.duration) ? a.duration : 1;
          if (share < 1) stopTimer = window.setTimeout(() => { a.pause(); done(); }, share * len * 1000);
        }).catch((e: Error) => {
          done();
          if (cryStatus && e.name !== "AbortError") cryStatus.textContent = e.name === "NotAllowedError" ? "press play to hear it" : "this cry couldn't be played";
        });
      };
      const cryNow = () => {
        const i = cur();
        const it = answer(i);
        if (!it || clue(i) !== "cry" && !roundOver(p, i, session.state.rounds[i]!)) return;
        const r = session.state.rounds[i]!;
        playCry(it, roundOver(p, i, r) ? 1 : CLIP[easeLevel(p, i, r)]!);
      };

      // --- drawing ---
      let shownRound = -1;
      let shownLevel = -1;
      let shownOver = false;
      let img: HTMLImageElement | null = null;

      const drawPicture = (it: PokemonItem, i: number, kind: Clue | "reveal", level: number) => {
        const pic = pictureOf(it, p.picture);
        if (!pic) {
          stage.replaceChildren(h("span", null, "no picture"));
          return;
        }
        const zoom = kind === "zoom";
        const frame = h("div", { class: `wt-pic${zoom ? " zoom" : ""}` });
        const el = h("img", { alt: "", crossorigin: "anonymous", draggable: "false", decoding: "async", class: pic.pixel ? "pixel" : "" });
        img = el;
        style0(el, kind, level);
        el.addEventListener("load", () => {
          if (zoom) placeZoom(el, p.spots[i] ?? 0.5, level);
          el.classList.add("ready");
        });
        el.addEventListener("error", () => frame.replaceChildren(h("span", { style: "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#234" }, "the picture didn't load; check the connection")));
        el.src = pic.url;
        frame.append(el);
        stage.append(frame);
      };
      /** The filter or crop for a clue at a level (before or after the picture loads). */
      const style0 = (el: HTMLImageElement, kind: Clue | "reveal", level: number) => {
        el.style.filter = kind === "silhouette" ? `brightness(${DARK[Math.min(level, DARK.length - 1)]})` : kind === "blur" ? `blur(${BLUR[Math.min(level, BLUR.length - 1)]}cqmin)` : "";
      };

      const drawStage = (i: number, over: boolean, level: number) => {
        const it = answer(i);
        const k = clue(i);
        const r = session.state.rounds[i]!;
        const sameRound = shownRound === i;
        // an eased clue, or the reveal of a visual clue, changes the picture in place so it animates
        if (sameRound && img && isVisual(k) && (!over || shownOver !== over || level !== shownLevel)) {
          const el = img;
          if (over) {
            el.style.filter = "";
            if (k === "zoom") placeZoom(el, p.spots[i] ?? 0.5, ZOOM.length - 1);
          } else {
            style0(el, k, level);
            if (k === "zoom" && el.complete && el.naturalWidth) placeZoom(el, p.spots[i] ?? 0.5, level);
          }
        } else if (!sameRound || over !== shownOver || (!over && (k === "entry" || k === "cry"))) {
          stage.replaceChildren();
          stage.className = "wt-stage";
          img = null;
          cryBtn = cryStatus = null;
          if (!it) stage.append(h("span", null, "this pokémon isn't in the data any more"));
          else if (over || isVisual(k)) drawPicture(it, i, over ? "reveal" : k, level);
          else if (k === "cry") {
            cryBtn = h("button", { type: "button", class: "wt-cry", "aria-label": "play the cry", "data-command": "whos-that.cry" }, "▶");
            cryBtn.addEventListener("click", cryNow);
            cryStatus = h("div");
            const clip = CLIP[level]!;
            stage.append(h("div", { class: "wt-crywrap" }, cryBtn, h("div", null, clip < 1 ? `the first ${Math.round(clip * 100)}%` : "all of it"), cryStatus));
          } else {
            stage.classList.add("text");
            const text = d ? redact(d, it) : "";
            const parts = text.split(BLANK);
            stage.append(h("div", { class: "wt-entry" },
              h("span", { class: "wt-genus" }, `the ${String(it.values.genus ?? "").replace(/ Pokémon$/, "")} Pokémon`),
              parts.flatMap((t, j) => (j ? [h("span", { class: "wt-blank", "aria-label": "a pokémon's name" }, BLANK), t] : [t]))));
          }
        }
        if (over && it && !stage.querySelector(".wt-answer")) {
          const ok = named(p, i, r);
          stage.append(h("div", { class: `wt-answer${ok ? "" : " miss"}` }, it.name,
            h("small", null, ok ? (r.guesses.length === 1 ? "first guess" : `in ${r.guesses.length} guesses`) : r.passed ? "given up" : "missed")));
        }
        shownRound = i;
        shownOver = over;
        shownLevel = level;
      };

      const render = () => {
        const st = session.state;
        const i = cur();
        const r = st.rounds[i]!;
        const over = roundOver(p, i, r);
        const done = finished(p, st);
        const level = easeLevel(p, i, r);
        const before = shownRound === i ? shownLevel : -1;
        drawStage(i, over, level);
        // bar: which pokémon, guesses left
        const pips = h("span", { class: "wt-pips", "aria-label": `${p.guesses - r.guesses.length} guesses left` },
          Array.from({ length: p.guesses }, (_, g) => h("span", { class: `wt-pip${g < r.guesses.length ? (r.guesses[g] === p.answers[i] ? " right" : " used") : ""}` })));
        const namedSoFar = st.rounds.filter((x, j) => roundOver(p, j, x) && named(p, j, x)).length;
        bar.replaceChildren(
          ...(p.game === "one" ? [] : [h("span", null, p.game === "run" ? `${i + 1} / ${p.answers.length}` : `#${i + 1}`), h("span", { class: "wt-left" }, `${namedSoFar} named`)]),
          h("span", { class: "wt-left" }, new Set(p.clues).size > 1 ? CLUE_LABELS[clue(i)] : ""),
          h("span", { style: "margin-left:auto" }, pips),
        );
        // facts uncovered so far (all of them once it's over)
        const it = answer(i);
        facts.replaceChildren();
        if (it && d) {
          for (const e of extrasShown(p, i, r)) {
            if (e === "type") facts.append(h("span", { class: "wt-fact pk-wrap" }, ((it.values.type as readonly string[] | null) ?? []).map((t) => typeChip(t, d.attributes.find((a) => a.id === "type")?.values?.find((v) => v.value === t)?.label ?? t))));
            else facts.append(h("span", { class: "wt-fact" }, extraText(d, it, e)));
          }
        }
        wrong.replaceChildren(...r.guesses.filter((g) => g !== p.answers[i]).map((g) => {
          const gi = byId.get(g);
          const form = !!gi && !!it && gi.base === it.base;
          return h("span", { class: form ? "form" : "", title: form ? "right pokémon, different form" : undefined }, gi?.name ?? g);
        }));
        // entry, or next
        const hadFocus = entryBar.contains(document.activeElement) || document.activeElement === document.body;
        if (over && !done) {
          if (entryBar.firstChild !== nextBtn) {
            entryBar.replaceChildren(nextBtn);
            if (hadFocus) nextBtn.focus({ preventScroll: true });
          }
        } else if (over) {
          entryBar.replaceChildren();
        } else if (entryBar.firstChild !== entry.el) {
          entryBar.replaceChildren(entry.el, passBtn);
          entry.clear();
          if (fine && hadFocus) entry.focus();
        }
        entry.setDisabled(over || session.locked);
        if (before >= 0 && level > before && !over) {
          stage.classList.remove("shake");
          void stage.offsetWidth;
          stage.classList.add("shake");
        }
        stage.classList.toggle("hinted", !!session.activeHint && !over);
        // preload the next one's picture
        const nx = answer(i + 1);
        const pic = nx && pictureOf(nx, p.picture);
        if (pic) { const pre = new Image(); pre.crossOrigin = "anonymous"; pre.src = pic.url; }
      };

      let lastRounds = session.state.rounds.length;
      const onChange = () => {
        const st = session.state;
        const i = st.rounds.length - 1;
        const r = st.rounds[i]!;
        const fresh = st.rounds.length !== lastRounds;
        lastRounds = st.rounds.length;
        render();
        // the cry plays on its own once the player has done something (a guess, next)
        if (clue(i) === "cry" && !roundOver(p, i, r) && (fresh || r.guesses.length)) cryNow();
      };
      const offs = [
        session.hooks.change.tap(onChange, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();
      if (fine && !roundOver(p, cur(), session.state.rounds[cur()]!)) entry.focus();

      return {
        aspect: 0.82,
        endDelayMs: REVEAL_MS,
        commands: bindCommands(BINDINGS, {
          "whos-that.next": () => run("next"),
          "whos-that.pass": () => run("pass"),
          "whos-that.cry": cryNow,
        }, {
          "whos-that.next": { menu: "board", when: () => roundOver(p, cur(), session.state.rounds[cur()]!) && !finished(p, session.state) },
          "whos-that.pass": { menu: "board", danger: true, when: () => !roundOver(p, cur(), session.state.rounds[cur()]!) },
          "whos-that.cry": { menu: "board", captureInput: true, when: () => clue(cur()) === "cry" || roundOver(p, cur(), session.state.rounds[cur()]!) },
        }),
        locate: () => [stage.getBoundingClientRect()],
        destroy() {
          offs.forEach((f) => f());
          clearTimeout(stopTimer);
          audio?.pause();
          audio = null;
          box.remove();
        },
      };
    },
  };
}
