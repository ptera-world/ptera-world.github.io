import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, inputIs, style } from "../../core/dom";
import type { CommandDef, DataItem, Dataset, View } from "../../core/types";
import { formatValue } from "../../lib/dataset/compare";
import { applyLook } from "../../lib/dataset/look";
import { VERDICT_CSS } from "../../lib/dataset/ui";
import {
  correct, isOver, isSolved, line, lookupOf, markOf, mistakes, moveFree, pinned, rounds, sortedFrom,
  type DataSource, type Dir, type Lookup, type OrderAction, type OrderPuzzle, type OrderState,
} from "./logic";

/** Marks of a fresh try appear one after another, this far apart. */
const STAGGER_MS = 110;
/** How long an answer stays showing before the next one comes in. */
const REVEAL_MS = 1300;
const COUNT_MS = 600;

const CSS = `
.od { width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; user-select: none; -webkit-user-select: none; color: var(--text); font-family: var(--font); }
.od.has-look { padding: 10px; border-radius: 12px; }
.od-end { display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 13px; padding: 0 4px; }
.od-end strong { color: var(--text); font-weight: 600; }
.od.has-look .od-end strong, .od.has-look .od-bar { text-shadow: 0 2px 0 rgb(0 0 0 / .45); }
.od-head { padding-right: 40px; min-height: 34px; }
.od-list { position: relative; flex: 1; min-height: 0; }
.od-row { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 4px; box-sizing: border-box; border-radius: var(--tile-radius, 10px); background: var(--tile-bg, var(--surface)); color: var(--tile-text, inherit); border: var(--tile-border, 1px solid var(--border)); box-shadow: var(--tile-shadow, none); transition: top .16s ease; touch-action: none; cursor: grab; }
.od-row.pinned { cursor: default; border-color: var(--verdict-match-c); background: color-mix(in srgb, var(--verdict-match-c) 18%, var(--tile-bg, var(--surface))); }
.od-row.lifted { transition: none; z-index: 3; cursor: grabbing; box-shadow: 0 8px 22px rgb(0 0 0 / .3); }
.od-row.cursor { outline: 2px solid var(--focus); outline-offset: 1px; }
${inputIs("pointer")} .od-row.cursor:not(.lifted) { outline: none; }
.od-row.held { outline-style: dashed; }
.od-pos { width: 18px; text-align: right; opacity: .6; font-size: 12px; font-variant-numeric: tabular-nums; flex: none; }
.od-pic { flex: none; object-fit: contain; }
.od-pic.pixel { image-rendering: pixelated; }
.od-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.od-val { opacity: .7; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.od-mark { flex: none; min-width: 34px; height: 26px; padding: 0 6px; box-sizing: border-box; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; }
.od-mark[hidden] { display: none; }
.od-mark.stale { opacity: .45; }
.od-mark.fresh { animation: od-flip .32s ease both; }
@keyframes od-flip { from { transform: rotateX(90deg); } to { transform: none; } }
.od-mark.right { background: var(--verdict-match-c); color: #fff; }
.od-mark.near { background: var(--verdict-near-c); color: #000; }
.od-mark.far { background: var(--verdict-miss-c); color: #fff; }
.od-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.od.has-look .od-foot { background: var(--panel-bg); color: var(--panel-text); border: var(--panel-border); border-radius: var(--panel-radius); padding: 6px 10px; }
.od-foot button.od-submit { padding: 6px 18px; font-size: 15px; }
.od-grid { display: flex; gap: 6px; margin-left: auto; }
.od-grid .col { display: flex; flex-direction: column; gap: 2px; }
.od-grid i { display: block; width: 9px; height: 9px; border-radius: 2px; }
.od-grid i.right { background: var(--verdict-match-c); } .od-grid i.near { background: var(--verdict-near-c); } .od-grid i.far { background: var(--verdict-miss-c); }
.od-bar { padding-right: 40px; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 15px; min-height: 1.4em; }
.od-bar .od-score { font-weight: 700; font-variant-numeric: tabular-nums; }
.od-bar .od-lives { letter-spacing: 2px; color: var(--danger, #c33); }
/* higher or lower: two cards */
.od-pair { container-type: size; flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: stretch; gap: 8px; }
@container (aspect-ratio < 1) { .od-pair { grid-template-columns: none; grid-template-rows: 1fr auto 1fr; } }
.od-card { min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px; border-radius: var(--panel-radius, 12px); background: var(--panel-bg, var(--surface)); color: var(--panel-text, inherit); border: var(--panel-border, 1px solid var(--border)); overflow: hidden; text-align: center; }
.od-card .od-big { flex: 1 1 auto; min-height: 0; min-width: 0; width: 100%; max-width: 260px; object-fit: contain; }
.od-card .od-big.pixel { image-rendering: pixelated; }
.od-cname { font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
.od-attr { font-size: 14px; font-weight: 600; opacity: .85; }
.od-value { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; min-height: 1.2em; }
.od-buttons { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 200px; }
.od-buttons button { font-size: 18px; padding: 8px 12px; border-radius: 99px; }
.od-mid { display: flex; align-items: center; justify-content: center; }
.od-vs { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); font-size: 15px; }
.od-vs.right { background: var(--verdict-match-c); color: #fff; font-size: 22px; }
.od-vs.wrong { background: var(--danger, #c33); color: #fff; font-size: 22px; }
.od-card.wrong { outline: 3px solid var(--danger, #c33); }
.od-card.right { outline: 3px solid var(--verdict-match-c); }
/* a line: the new one on top, the placed ones below with a gap to drop it in between each */
.od-new { flex: none; display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: var(--panel-radius, 12px); background: var(--panel-bg, var(--surface)); color: var(--panel-text, inherit); border: var(--panel-border, 1px solid var(--border)); }
.od-new .od-pic { width: 64px; height: 64px; }
.od-new .od-cname { font-size: 18px; }
.od-line { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 2px; }
.od-placed { display: flex; align-items: center; gap: 8px; padding: 2px 10px 2px 4px; border-radius: var(--tile-radius, 8px); background: var(--tile-bg, var(--surface)); color: var(--tile-text, inherit); border: var(--tile-border, 1px solid var(--border)); box-shadow: var(--tile-shadow, none); }
.od-placed .od-pic { width: 40px; height: 40px; }
.od-placed.right { border-color: var(--verdict-match-c); } .od-placed.wrong { border-color: var(--danger, #c33); }
.od-placed.fresh { animation: od-flip .35s ease both; }
.od-gap { height: 26px; border-radius: 99px; border: 2px dashed color-mix(in srgb, var(--text) 35%, transparent); background: transparent; color: var(--text); font-size: 13px; opacity: .75; }
.od-gap:hover, .od-gap:focus-visible { opacity: 1; border-style: solid; background: color-mix(in srgb, var(--accent) 20%, transparent); }
`;

const BINDINGS = {
  "order.submit": { label: "submit this order", category: "in order", keys: ["Enter"] },
  "order.up": { label: "cursor up (moves a picked-up one)", category: "in order", keys: ["ArrowUp", "w", "k"], hidden: true },
  "order.down": { label: "cursor down (moves a picked-up one)", category: "in order", keys: ["ArrowDown", "s", "j"], hidden: true },
  "order.grab": { label: "pick up or put down the one at the cursor", category: "in order", keys: ["space"], hidden: true },
  "order.higher": { label: "higher", category: "in order", keys: ["ArrowUp", "w", "h"], description: "the right one's is higher" },
  "order.lower": { label: "lower", category: "in order", keys: ["ArrowDown", "s", "l"], description: "the right one's is lower" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const MARK_SAMPLE = (cls: string, text: string) => `<span class="od-mark ${cls}" style="font-size:11px;min-width:24px;height:20px">${text}</span>`;

/** An item's picture: big wants a smooth one (artwork) first, small a pixel one (a sprite). */
function pic(d: Dataset, it: DataItem, big: boolean, cls: string, size?: number): HTMLElement | null {
  const ms = Object.values(d.media ?? {}).filter((m) => m.type === "image");
  const m = (big ? ms.find((x) => !x.pixel) : ms.find((x) => x.pixel)) ?? ms[0];
  const url = m?.url(it);
  if (!url) return null;
  const img = h("img", { class: `${cls}${m!.pixel ? " pixel" : ""}`, src: url, alt: "", crossorigin: "anonymous", draggable: "false", decoding: "async" });
  if (size) { img.style.width = `${size}px`; img.style.height = `${size}px`; }
  return img;
}

/** Count a shown number up from `from`, so the reveal has a moment. */
function countUp(el: HTMLElement, from: number, to: number, show: (n: number) => string, decimals: number): () => void {
  const t0 = performance.now();
  let raf = 0;
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / COUNT_MS);
    const eased = 1 - (1 - k) ** 3;
    const f = 10 ** decimals;
    el.textContent = show(k >= 1 ? to : Math.round((from + (to - from) * eased) * f) / f);
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

interface Mounted { commands: CommandDef[]; aspect: number | (() => number); endDelayMs: number; locate?: () => DOMRect[]; destroy(): void }
type Session = Parameters<View<OrderPuzzle, OrderState, OrderAction, null>["mount"]>[1]["session"];

export function orderView(data: DataSource, puzzle: { id: string }): View<OrderPuzzle, OrderState, OrderAction, null> {
  return {
    id: "order.board",
    name: "board",
    puzzle,
    controls: (p) => (p.mode === "sort"
      ? [{ how: "drag one up or down", what: "move it; the others make room" }, { how: "↑ ↓ then space, ↑ ↓, space", what: "pick one up, move it, put it down" }, { how: "submit, or Enter", what: "mark this order (uses a try)" }]
      : p.mode === "line" ? [{ how: "click or tap a gap in the line", what: "put the new one there" }]
      : [{ how: "click or tap higher or lower", what: "answer for the right one" }]),
    legend: (p) => (p.mode === "sort" ? [
      { sample: MARK_SAMPLE("right", "✓"), meaning: "in the right place; it stays put" },
      ...(p.marks === "place" ? [{ sample: MARK_SAMPLE("far", "✗"), meaning: "not in the right place" }]
        : p.marks === "exact" ? [{ sample: MARK_SAMPLE("far", "↓2"), meaning: "belongs that many places lower (↓) or higher (↑)" }]
        : [{ sample: MARK_SAMPLE("far", "↓"), meaning: "belongs lower down (↓) or higher up (↑)" }, ...(p.marks === "near" ? [{ sample: MARK_SAMPLE("near", "↑"), meaning: "just one place off" }] : [])]),
      { sample: MARK_SAMPLE("far stale", "↑"), meaning: "faded: it has moved since it was marked" },
    ] : [
      { sample: MARK_SAMPLE("right", "✓"), meaning: "right" },
      { sample: `<span class="od-mark" style="background:var(--danger,#c33);color:#fff;font-size:11px;min-width:24px;height:20px">✗</span>`, meaning: "wrong: costs a life" },
    ]),
    mount(root, { session }) {
      style("verdict", VERDICT_CSS);
      style("order", CSS);
      const p = session.puzzle;
      const d = data.get(p.dataset);
      if (!d) throw new Error(`the ${p.dataset} dataset's pack isn't loaded`);
      const look = lookupOf(d);
      const el = h("div", { class: "od" });
      root.append(el);
      const unlook = applyLook(d, el);
      const m = p.mode === "sort" ? mountSort(el, session, p, d, look) : p.mode === "line" ? mountLine(el, session, p, d, look) : mountLast(el, session, p, d, look);
      return {
        get aspect() { return typeof m.aspect === "function" ? m.aspect() : m.aspect; },
        commands: m.commands,
        endDelayMs: m.endDelayMs,
        ...(m.locate ? { locate: m.locate } : {}),
        destroy() { m.destroy(); unlook(); el.remove(); },
      };
    },
  };
}

function mountSort(wrap: HTMLElement, session: Session, p: OrderPuzzle, d: Dataset, look: Lookup): Mounted {
  const N = p.ids.length;
  const attr = look.attribute(p.attrs[0]!).label;
  const head = h("div", { class: "od-end od-head" }, h("strong", null, `${p.high ? "highest" : "lowest"} ${attr}`));
  const tail = h("div", { class: "od-end" }, h("strong", null, `${p.high ? "lowest" : "highest"} ${attr}`));
  const list = h("div", { class: "od-list", role: "listbox", "aria-label": `in order of ${attr}` });
  const status = h("span", { "aria-live": "polite" });
  const submit = h("button", { type: "button", class: "od-submit primary", "data-command": "order.submit", onclick: () => doSubmit() }, "submit");
  const grid = h("div", { class: "od-grid", "aria-hidden": "true" });
  wrap.append(head, list, tail, h("div", { class: "od-foot" }, submit, status, grid));

  const rows = new Map<string, { el: HTMLElement; pos: HTMLElement; mark: HTMLElement; val: HTMLElement; img: HTMLElement | null }>();
  for (const id of p.ids) {
    const it = look.item(id);
    const pos = h("span", { class: "od-pos" });
    const mark = h("span", { class: "od-mark", hidden: true });
    const val = h("span", { class: "od-val" });
    const img = pic(d, it, false, "od-pic", 56);
    const el = h("div", { class: "od-row", role: "option", "data-id": id }, pos, img, h("span", { class: "od-name" }, it.name), val, mark);
    el.addEventListener("pointerdown", (e) => onDown(e, id));
    list.append(el);
    rows.set(id, { el, pos, mark, val, img });
  }

  let rowH = 60, gap = 6;
  let cursor = 0, held = false;
  let drag: { id: string; from: number; pointerId: number; y0: number; top0: number; to: number } | null = null;
  let freshTry = -1;
  const over = () => isOver(p, session.state) || session.finished;

  const layout = () => {
    const hgt = list.clientHeight;
    gap = Math.max(3, Math.min(8, hgt * 0.012));
    rowH = Math.max(36, Math.min(76, (hgt - gap * (N - 1)) / N));
    const size = Math.round(Math.min(56, rowH - 6));
    for (const r of rows.values()) {
      r.el.style.height = `${rowH}px`;
      if (r.img) { r.img.style.width = `${size}px`; r.img.style.height = `${size}px`; }
    }
    render();
  };

  const render = () => {
    const st = session.state;
    const done = over();
    // after the game, the right order with the values
    const shown = done && !isSolved(p, st) ? sortedFrom(p, { ...st, tries: [] }, look) : drag ? (moveFree(st.order, pinned(st), drag.from, drag.to) ?? st.order) : st.order;
    const pin = pinned(st);
    const last = st.tries[st.tries.length - 1];
    shown.forEach((id, i) => {
      const r = rows.get(id)!;
      if (!(drag && drag.id === id)) r.el.style.top = `${i * (rowH + gap)}px`;
      r.pos.textContent = String(i + 1);
      const isPinned = !done && pin[i] && st.order[i] === id;
      r.el.classList.toggle("pinned", isPinned || (done && isSolved(p, st)));
      r.el.classList.toggle("cursor", !done && i === cursor);
      r.el.classList.toggle("held", !done && i === cursor && held);
      r.el.setAttribute("aria-selected", String(!done && i === cursor));
      r.val.textContent = done ? look.show(id, p.attrs[0]!) : "";
      // the mark it got in the last try, faded once it has moved from where it was marked
      const at = last ? last.order.indexOf(id) : -1;
      if (last && at >= 0 && !(done && !isSolved(p, st))) {
        const mk = markOf(last.off[at]!, p.marks);
        r.mark.hidden = false;
        r.mark.className = `od-mark ${mk.cls}${at !== st.order.indexOf(id) || (drag && at !== shown.indexOf(id)) ? " stale" : ""}${freshTry === st.tries.length - 1 ? " fresh" : ""}`;
        r.mark.style.animationDelay = freshTry === st.tries.length - 1 ? `${at * STAGGER_MS}ms` : "";
        r.mark.textContent = mk.text;
        r.mark.setAttribute("aria-label", mk.cls === "right" ? "right place" : `${mk.arrow === "↓" ? "lower" : mk.arrow === "↑" ? "higher" : "wrong place"}`);
      } else r.mark.hidden = true;
      r.el.setAttribute("aria-label", `${i + 1}: ${look.item(id).name}${r.val.textContent ? `, ${r.val.textContent}` : ""}${isPinned ? ", right" : ""}`);
    });
    const used = st.tries.length;
    status.textContent = done ? (session.outcome === "revealed" ? "revealed" : isSolved(p, st) ? `sorted in ${used}` : "out of tries") : `try ${used + 1} of ${p.tries}`;
    submit.disabled = done || session.locked;
    submit.hidden = done;
    grid.replaceChildren(...st.tries.map((tr) => h("span", { class: "col" }, ...Array.from({ length: N }, (_, k) => h("i", { class: markOf(tr.off[k]!, p.marks).cls })))));
  };

  const doSubmit = () => {
    if (over() || session.locked) return;
    held = false;
    if (session.dispatch({ type: "submit" })) freshTry = session.state.tries.length - 1;
    render();
  };

  // --- dragging ---
  const slotAt = (y: number) => Math.max(0, Math.min(N - 1, Math.round(y / (rowH + gap))));
  const onDown = (e: PointerEvent, id: string) => {
    if (over() || session.locked || drag || e.button > 0) return;
    const st = session.state;
    const from = st.order.indexOf(id);
    cursor = from;
    held = false;
    if (pinned(st)[from]) { render(); return; }
    e.preventDefault();
    const row = rows.get(id)!.el;
    row.setPointerCapture?.(e.pointerId);
    drag = { id, from, pointerId: e.pointerId, y0: e.clientY, top0: from * (rowH + gap), to: from };
    row.classList.add("lifted");
    render();
  };
  const nearestFree = (want: number) => {
    const pin = pinned(session.state);
    let best = drag!.from, bd = Infinity;
    for (let i = 0; i < N; i++) if (!pin[i] && Math.abs(i - want) < bd) { bd = Math.abs(i - want); best = i; }
    return best;
  };
  list.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const top = Math.max(0, Math.min((N - 1) * (rowH + gap), drag.top0 + e.clientY - drag.y0));
    rows.get(drag.id)!.el.style.top = `${top}px`;
    const to = nearestFree(slotAt(top));
    if (to !== drag.to) { drag.to = to; render(); }
  });
  list.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dr = drag;
    drag = null;
    rows.get(dr.id)!.el.classList.remove("lifted");
    if (dr.to !== dr.from) { session.dispatch({ type: "move", from: dr.from, to: dr.to }); cursor = dr.to; }
    render();
  });
  const onCancel = () => {
    if (!drag) return;
    rows.get(drag.id)!.el.classList.remove("lifted");
    drag = null;
    render();
  };
  list.addEventListener("pointercancel", onCancel);

  // --- keyboard ---
  const step = (dir: 1 | -1) => {
    if (over()) return;
    const st = session.state;
    if (!held) { cursor = Math.max(0, Math.min(N - 1, cursor + dir)); render(); return; }
    const pin = pinned(st);
    let to = cursor + dir;
    while (to >= 0 && to < N && pin[to]) to += dir;
    if (to < 0 || to >= N) return;
    if (session.dispatch({ type: "move", from: cursor, to })) cursor = to;
    render();
  };
  const grab = () => {
    if (over() || session.locked) return;
    if (!held && pinned(session.state)[cursor]) return;
    held = !held;
    render();
  };

  const ro = new ResizeObserver(layout);
  ro.observe(list);
  const offs = [
    session.hooks.change.tap(() => render(), { owner: "view" }),
    session.hooks.refresh.tap(() => { onCancel(); render(); }, { owner: "view" }),
  ];
  layout();
  return {
    aspect: 440 / (78 * (N + 2.4)),
    endDelayMs: N * STAGGER_MS + 320,
    commands: bindCommands(BINDINGS, {
      "order.submit": () => doSubmit(), "order.up": () => step(-1), "order.down": () => step(1), "order.grab": () => grab(),
      "order.higher": () => {}, "order.lower": () => {},
    }, {
      "order.submit": { menu: "board", when: () => !over() },
      "order.grab": { menu: "board", when: () => !over() },
    }).filter((c) => c.id !== "order.higher" && c.id !== "order.lower"),
    destroy() { ro.disconnect(); offs.forEach((f) => f()); },
  };
}

function livesText(p: OrderPuzzle, st: OrderState): string {
  return p.lives > 1 ? "♥".repeat(Math.max(0, p.lives - mistakes(st))) + "♡".repeat(Math.min(p.lives, mistakes(st))) : "";
}

function mountLine(wrap: HTMLElement, session: Session, p: OrderPuzzle, d: Dataset, look: Lookup): Mounted {
  const attr = p.attrs[0]!;
  const label = look.attribute(attr).label;
  const bar = h("div", { class: "od-bar" });
  const next = h("div", { class: "od-new", "aria-live": "polite" });
  const lineEl = h("div", { class: "od-line", role: "list", "aria-label": `placed so far, ${p.high ? "highest" : "lowest"} ${label} first` });
  wrap.append(bar, next, lineEl);
  let fresh = "";

  const render = () => {
    const st = session.state;
    const done = isOver(p, st) || session.finished;
    const k = st.results.length;
    const lives = livesText(p, st);
    bar.replaceChildren(
      h("span", { class: "od-score" }, p.lives > 1 ? `${correct(st)} right` : `streak ${correct(st)}`),
      h("span", null, `${Math.min(k + 2, p.ids.length)} / ${p.ids.length}`),
      ...(lives ? [h("span", { class: "od-lives", "aria-label": `${p.lives - mistakes(st)} lives left` }, lives)] : []));
    const comingId = !done ? p.ids[k + 1] : undefined;
    if (comingId) {
      const it = look.item(comingId);
      next.replaceChildren(...[pic(d, it, false, "od-pic")].filter((x): x is HTMLElement => !!x), h("div", null, h("div", { class: "od-cname" }, it.name), h("div", { class: "od-attr" }, `where does its ${label} go?`)));
    } else next.replaceChildren(h("div", { class: "od-cname" }, isSolved(p, st) ? "run cleared" : "run over"));
    next.hidden = false;
    const L = line(p, st, look);
    // which placed ones were right: the first started the line; the k-th placed answered round k-1
    const result = new Map(p.ids.slice(1, k + 1).map((id, i) => [id, st.results[i]!]));
    const gapBtn = (at: number) => h("button", { type: "button", class: "od-gap", disabled: session.locked, "aria-label": at === 0 ? "at the top" : at === L.length ? "at the bottom" : `between ${look.item(L[at - 1]!).name} and ${look.item(L[at]!).name}`, onclick: () => place(at) }, "here");
    const kids: HTMLElement[] = [];
    L.forEach((id, i) => {
      if (comingId) kids.push(gapBtn(i));
      const it = look.item(id);
      const r = result.get(id);
      kids.push(h("div", { class: `od-placed${r === undefined ? "" : r ? " right" : " wrong"}${id === fresh ? " fresh" : ""}`, role: "listitem" },
        pic(d, it, false, "od-pic"), h("span", { class: "od-name" }, it.name), h("strong", { class: "od-val" }, look.show(id, attr)), r === false ? h("span", { class: "od-mark far" }, "✗") : null));
    });
    if (comingId) kids.push(gapBtn(L.length));
    lineEl.replaceChildren(...kids);
    fresh = "";
  };
  const place = (at: number) => {
    if (session.locked || isOver(p, session.state)) return;
    const id = p.ids[session.state.results.length + 1];
    if (session.dispatch({ type: "place", at }) && id) { fresh = id; render(); lineEl.querySelector(".fresh")?.scrollIntoView({ block: "nearest" }); }
  };
  const offs = [session.hooks.change.tap(() => render(), { owner: "view" }), session.hooks.refresh.tap(() => render(), { owner: "view" })];
  render();
  return {
    aspect: 0.7,
    endDelayMs: 500,
    commands: [],
    locate: () => [next.getBoundingClientRect()],
    destroy() { offs.forEach((f) => f()); },
  };
}

function mountLast(wrap: HTMLElement, session: Session, p: OrderPuzzle, d: Dataset, look: Lookup): Mounted {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopCount: (() => void) | null = null;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; stopCount?.(); stopCount = null; };
  const guess = (dir: Dir) => {
    // while an answer is showing, the next round isn't on screen yet
    if (timer) return;
    session.dispatch({ type: "guess", dir });
  };
  const card = (it: DataItem, ...info: (Node | null)[]) => h("div", { class: "od-card" }, pic(d, it, true, "od-big"), h("div", { class: "od-cname" }, it.name), ...info);
  const preload = (k: number) => {
    const id = p.ids[k];
    if (!id) return;
    // made, not shown: the browser fetches it now
    pic(d, look.item(id), true, "");
  };

  /** Round k on screen; `result` set: its answer showing (right or wrong). */
  const render = (k: number, result: boolean | null) => {
    cancel();
    const st = session.state;
    const a = look.attribute(p.attrs[k]!);
    const left = look.item(p.ids[k]!), right = look.item(p.ids[k + 1]!);
    const lv = look.value(left.id, a.id), rv = look.value(right.id, a.id);
    const value = h("div", { class: "od-value" }, result === null ? "" : look.show(left.id, a.id));
    const over = isOver(p, st);
    const rightInfo = result === null
      ? h("div", { class: "od-buttons" },
        h("button", { class: "primary", "data-command": "order.higher", disabled: over, onclick: () => guess("higher") }, "▲ higher"),
        h("button", { class: "primary", "data-command": "order.lower", disabled: over, onclick: () => guess("lower") }, "▼ lower"))
      : value;
    const rightCard = card(right, h("div", { class: "od-attr" }, a.label), rightInfo);
    if (result !== null) rightCard.classList.add(result ? "right" : "wrong");
    const vs = h("div", { class: `od-vs${result === null ? "" : result ? " right" : " wrong"}` }, result === null ? "vs" : result ? "✓" : "✗");
    const lives = livesText(p, st);
    wrap.replaceChildren(
      h("div", { class: "od-bar" },
        h("span", { class: "od-score" }, p.lives > 1 ? `${correct(st)} right` : `streak ${correct(st)}`),
        h("span", null, `${Math.min(k + 2, p.ids.length)} / ${p.ids.length}`),
        lives ? h("span", { class: "od-lives", "aria-label": `${p.lives - mistakes(st)} lives left` }, lives) : null),
      h("div", { class: "od-pair" },
        card(left, h("div", { class: "od-attr" }, a.label), h("div", { class: "od-value" }, look.show(left.id, a.id))),
        h("div", { class: "od-mid" }, vs),
        rightCard));
    if (result !== null) stopCount = countUp(value, lv, rv, (n) => formatValue(a, n), a.decimals ?? 0);
    preload(k + 2);
  };
  const settle = () => {
    const st = session.state;
    const n = st.results.length;
    if (isOver(p, st) && n > 0) render(n - 1, st.results[n - 1]!);
    else render(Math.min(n, rounds(p) - 1), null);
  };
  const offChange = session.hooks.change.tap(({ prev, state, cause }) => {
    const n = state.results.length;
    if (cause === "action" && n === prev.results.length + 1) {
      render(n - 1, state.results[n - 1]!);
      if (!isOver(p, state)) timer = setTimeout(() => { timer = null; settle(); }, REVEAL_MS);
    } else settle();
  }, { owner: "view" });
  const offRefresh = session.hooks.refresh.tap(() => { if (!timer) settle(); }, { owner: "view" });
  settle();
  return {
    aspect: () => (typeof window !== "undefined" && window.innerWidth < window.innerHeight ? 0.62 : 1.7),
    endDelayMs: COUNT_MS + 700,
    commands: bindCommands(BINDINGS, {
      "order.higher": () => guess("higher"), "order.lower": () => guess("lower"),
      "order.submit": () => {}, "order.up": () => {}, "order.down": () => {}, "order.grab": () => {},
    }, { "order.higher": { menu: "board" }, "order.lower": { menu: "board" } }).filter((c) => c.id === "order.higher" || c.id === "order.lower"),
    locate: () => [...wrap.querySelectorAll(".od-card")].map((c) => c.getBoundingClientRect()),
    destroy() { cancel(); offChange(); offRefresh(); },
  };
}
