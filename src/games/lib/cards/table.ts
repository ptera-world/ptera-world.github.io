import { animate, ease, type Animation } from "../../core/anim";
import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { Action, CommandDef, ViewContext, ViewHandle } from "../../core/types";
import type { Face } from "./deck";
import { CARD_CSS, CARD_H, CARD_R, CARD_W, cardElement, cardSample, setUp } from "./draw";
import { whereIs, type Pile } from "./piles";

/** Where a pile sits and how its cards spread. Board units; a card is CARD_W × CARD_H. */
export interface Slot {
  x: number;
  y: number;
  /**
   * none: squared up; down: a column spreading downwards; waste: the top few spread right;
   * deals: one card showing per group of `group` cards, spread right.
   */
  fan: "none" | "down" | "waste" | "deals";
  /** down: the lowest the top edge of the last card may reach; the spread tightens to stay above it. */
  bottom?: number;
  /** waste: how many top cards spread; deals: cards per group. */
  count?: number;
  /** Shown inside the empty slot (e.g. "A" for a foundation). */
  mark?: string;
  /** "column 3", "free cell 2": for hints and screen readers. */
  name: string;
}

/** Where the pointer or keyboard is on the table, and the cards picked up with the keyboard. */
export interface CardCursor {
  pile: number;
  /** Card index in the pile; -1 for an empty pile. */
  index: number;
  held: { pile: number; index: number } | null;
}

/** Hint highlight: cards to move (ids), and where they go. */
export interface CardFocus {
  cards?: number[];
  /** Destination pile. */
  to?: number;
  /** Whole piles to point at. */
  piles?: number[];
}

/** The rules a card game hands the shared table. Every function is pure. */
export interface TableRules<Pz, S, A extends Action> {
  /** Board size in board units. */
  size(p: Pz): { w: number; h: number };
  slots(p: Pz): Slot[];
  piles(s: S): readonly Pile[];
  face(p: Pz, id: number): Face;
  /** Whether the cards from `index` to the top of `pile` can be picked up together. */
  canLift(p: Pz, s: S, pile: number, index: number): boolean;
  /** The move that puts the cards from `index` up of `from` onto `to`, or null if not allowed. */
  drop(p: Pz, s: S, from: number, index: number, to: number): A | null;
  /** What a click or tap on a card (index -1: the empty pile) does, or null for nothing. */
  tap(p: Pz, s: S, pile: number, index: number): A[] | null;
  /** The stock, for the draw command and the opening deal. */
  stock?: number;
  /** Label for the draw command. */
  drawLabel?: string;
}

const DOWN_STEP = 1.7;
const UP_STEP = 3.7;
const WASTE_STEP = 2.6;
const DEALS_STEP = 1.4;
const DRAG_PX = 5;

const CSS = `
.cards-table { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.cards-table .slot { fill: none; stroke: var(--border); stroke-width: 0.3; }
.cards-table .slot-hit { fill: transparent; }
.cards-table .slot-mark { fill: var(--text-dim); opacity: 0.6; font: 600 4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.cards-table .card { cursor: pointer; }
.cards-table .ghost { opacity: 0.45; pointer-events: none; }
.cards-table .mark { fill: none; stroke: var(--hint); stroke-width: 0.7; pointer-events: none; }
.cards-table .mark.nudge { stroke-width: 0.45; stroke-dasharray: 1.2 0.8; }
.cards-table .mark.dest { stroke-dasharray: 1.6 0.8; }
.cards-table .held { fill: none; stroke: var(--accent); stroke-width: 0.7; pointer-events: none; }
.cards-table .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .cards-table .cursor { display: none; }
${CARD_CSS}
`;

export const tableSettings = defineSchema({
  fourColor: { type: "bool", label: "four-color deck", default: false, description: "clubs green and diamonds blue, so every suit has its own color" },
  speed: {
    type: "enum", label: "card movement", default: "normal",
    options: [{ value: "normal", label: "normal" }, { value: "fast", label: "fast" }, { value: "instant", label: "instant" }],
  },
});

interface Pos { x: number; y: number; up: boolean }

/** Every card's resting place for these piles, by id, plus the spread used per pile. */
export function layout(slots: readonly Slot[], piles: readonly Pile[]): Map<number, Pos> {
  const out = new Map<number, Pos>();
  piles.forEach((pile, pi) => {
    const sl = slots[pi]!;
    const n = pile.c.length;
    if (sl.fan === "down") {
      let need = 0;
      for (let i = 0; i < n - 1; i++) need += i < pile.d ? DOWN_STEP : UP_STEP;
      const room = (sl.bottom ?? Infinity) - sl.y;
      const k = need > room ? room / need : 1;
      let y = sl.y;
      pile.c.forEach((id, i) => {
        out.set(id, { x: sl.x, y, up: i >= pile.d });
        y += (i < pile.d ? DOWN_STEP : UP_STEP) * k;
      });
    } else if (sl.fan === "waste") {
      const show = sl.count ?? 1;
      pile.c.forEach((id, i) => out.set(id, { x: sl.x + Math.max(0, i - (n - show)) * WASTE_STEP, y: sl.y, up: i >= pile.d }));
    } else if (sl.fan === "deals") {
      const per = sl.count ?? 1;
      pile.c.forEach((id, i) => out.set(id, { x: sl.x + Math.floor(i / per) * DEALS_STEP, y: sl.y, up: i >= pile.d }));
    } else {
      pile.c.forEach((id, i) => out.set(id, { x: sl.x, y: sl.y, up: i >= pile.d }));
    }
  });
  return out;
}

const BINDINGS = {
  "cards.left": { label: "cursor to the pile on the left", category: "cards", keys: ["ArrowLeft", "a"] },
  "cards.right": { label: "cursor to the pile on the right", category: "cards", keys: ["ArrowRight", "d"] },
  "cards.up": { label: "cursor one card up the column", category: "cards", keys: ["ArrowUp", "w"], description: "to pick up more of a column at once" },
  "cards.down": { label: "cursor one card down the column", category: "cards", keys: ["ArrowDown", "s"] },
  "cards.pick": { label: "pick up or put down", category: "cards", keys: ["space"], description: "pick up the cards from the cursor down, then put them on the pile under the cursor" },
  "cards.auto": { label: "move to the best place", category: "cards", keys: ["Enter"], description: "does what clicking the card under the cursor does" },
} satisfies BindingSchema;

/** Only for games with a stock. */
const DRAW_BINDINGS = {
  "cards.draw": { label: "draw from the stock", category: "cards", keys: ["n"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS>, Ids<typeof DRAW_BINDINGS> {}
}

export interface TableOptions {
  /** Extra commands the game adds to the table's own. */
  commands?: CommandDef[];
}

/** Mounts the shared card table: drawing, dragging, clicking, keyboard, animation, hints and previews. */
export function mountTable<Pz, S, A extends Action, I extends { cursor: CardCursor }>(
  root: HTMLElement,
  { session, settings }: ViewContext<Pz, S, A, I, typeof tableSettings>,
  rules: TableRules<Pz, S, A>,
  opts: TableOptions = {},
): ViewHandle {
  style("cards-table", CSS);
  const p = session.puzzle;
  const { w: W, h: H } = rules.size(p);
  const slots = rules.slots(p);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: `cards-table${settings.fourColor ? " four-color" : ""}`, role: "application", "aria-label": "card table" });
  const slotLayer = s("g"), cardLayer = s("g"), ghostLayer = s("g", { class: "ghost" }), overlay = s("g");
  const cursorEl = s("rect", { width: CARD_W + 0.8, height: CARD_H + 0.8, rx: CARD_R + 0.3, class: "cursor" });
  slots.forEach((sl, i) => {
    slotLayer.append(s("rect", { x: sl.x, y: sl.y, width: CARD_W, height: CARD_H, rx: CARD_R, class: "slot" }));
    if (sl.mark) slotLayer.append(s("text", { x: sl.x + CARD_W / 2, y: sl.y + CARD_H / 2, class: "slot-mark" }, sl.mark));
    slotLayer.append(s("rect", { x: sl.x, y: sl.y, width: CARD_W, height: CARD_H, rx: CARD_R, class: "slot-hit", "data-pile": i }));
  });
  svg.append(slotLayer, cardLayer, ghostLayer, overlay, cursorEl);
  root.append(svg);

  const els = new Map<number, SVGGElement>();
  const cardEl = (id: number) => {
    let el = els.get(id);
    if (!el) {
      el = cardElement(rules.face(p, id), id);
      els.set(id, el);
    }
    return el;
  };

  /** What is drawn right now, which differs from the layout while animating or dragging. */
  const shown = new Map<number, Pos & { flip: number }>();
  const place = (id: number, x: number, y: number, up: boolean, flip = 1) => {
    shown.set(id, { x, y, up, flip });
    const el = cardEl(id);
    setUp(el, up);
    el.setAttribute("transform", flip === 1 ? `translate(${x} ${y})` : `translate(${x + (CARD_W / 2) * (1 - flip)} ${y}) scale(${flip} 1)`);
  };

  let anim: Animation | null = null;
  let dragging: { ids: number[]; dx: number; dy: number } | null = null;
  let preview: S | null = null;

  const order = (pos: Map<number, Pos>, raised: Set<number>) => {
    const piles = rules.piles(session.state);
    const ids: number[] = [];
    piles.forEach((pl) => ids.push(...pl.c));
    const lift = ids.filter((id) => raised.has(id));
    for (const id of [...ids.filter((id) => !raised.has(id)), ...lift]) if (pos.has(id)) cardLayer.append(cardEl(id));
  };

  const speed = () => (settings.speed === "instant" ? 0 : settings.speed === "fast" ? 0.5 : 1);

  /** Snap every card to its resting place, ending any animation. */
  const jump = () => {
    anim?.cancel();
    anim = null;
    const pos = layout(slots, rules.piles(session.state));
    for (const [id, b] of pos) place(id, b.x, b.y, b.up);
    order(pos, new Set());
  };

  /**
   * Move every card to its resting place, animating from where it is drawn now (or from `from`).
   * With a stagger, cards start one after another in `seq` order.
   */
  const settle = (o: { from?: (id: number) => Pos | undefined; stagger?: number; seq?: (id: number) => number } = {}) => {
    anim?.cancel();
    anim = null;
    const pos = layout(slots, rules.piles(session.state));
    const moving: { id: number; a: Pos; b: Pos; delay: number }[] = [];
    for (const [id, b] of pos) {
      const a = o.from?.(id) ?? shown.get(id);
      if (a && (a.x !== b.x || a.y !== b.y || a.up !== b.up)) moving.push({ id, a, b, delay: 0 });
      else place(id, b.x, b.y, b.up);
    }
    if (o.seq) moving.sort((x, y) => o.seq!(x.id) - o.seq!(y.id));
    moving.forEach((m, k) => { m.delay = (o.stagger ?? 0) * k; });
    for (const id of els.keys()) if (!pos.has(id)) { els.get(id)!.remove(); els.delete(id); shown.delete(id); }
    order(pos, new Set(moving.map((m) => m.id)));
    const sp = speed();
    if (!moving.length || sp === 0) {
      for (const m of moving) place(m.id, m.b.x, m.b.y, m.b.up);
      if (moving.length) order(pos, new Set());
      return;
    }
    const dur = 190 * sp;
    const total = dur + moving[moving.length - 1]!.delay * sp;
    anim = animate(total, (t) => {
      const now = t * total;
      for (const m of moving) {
        const q = ease.out(Math.min(1, Math.max(0, (now - m.delay * sp) / dur)));
        const flips = m.a.up !== m.b.up;
        place(m.id, m.a.x + (m.b.x - m.a.x) * q, m.a.y + (m.b.y - m.a.y) * q, flips ? (q < 0.5 ? m.a.up : m.b.up) : m.b.up, flips ? Math.max(0.02, Math.abs(1 - 2 * q)) : 1);
      }
    }, ease.linear);
    void anim.then((done) => { if (done) order(pos, new Set()); });
  };

  const rectOf = (pile: number, index: number): [number, number, number, number] => {
    const pl = rules.piles(session.state)[pile]!;
    const sl = slots[pile]!;
    if (index < 0 || !pl.c.length) return [sl.x, sl.y, CARD_W, CARD_H];
    const pos = layout(slots, rules.piles(session.state));
    const first = pos.get(pl.c[Math.min(index, pl.c.length - 1)]!)!;
    const last = pos.get(pl.c[pl.c.length - 1]!)!;
    return [Math.min(first.x, last.x), first.y, Math.abs(last.x - first.x) + CARD_W, last.y - first.y + CARD_H];
  };

  const outline = (r: [number, number, number, number], cls: string, pad = 0.35) =>
    s("rect", { x: r[0] - pad, y: r[1] - pad, width: r[2] + 2 * pad, height: r[3] + 2 * pad, rx: CARD_R + pad, class: cls });

  const focusRects = (f: CardFocus | undefined): [number, number, number, number][] => {
    if (!f) return [];
    const where = whereIs(rules.piles(session.state));
    const out: [number, number, number, number][] = [];
    const byPile = new Map<number, number>();
    for (const id of f.cards ?? []) {
      const w = where.get(id);
      if (w) byPile.set(w.pile, Math.min(byPile.get(w.pile) ?? Infinity, w.index));
    }
    for (const [pile, index] of byPile) {
      const pl = rules.piles(session.state)[pile]!;
      const cards = new Set(f.cards);
      const run = pl.c.slice(index).every((id) => cards.has(id));
      out.push(run ? rectOf(pile, index) : rectOf(pile, pl.c.length - 1));
    }
    for (const pile of f.piles ?? []) out.push(rectOf(pile, 0));
    return out;
  };

  const drawOverlay = () => {
    overlay.replaceChildren();
    const hint = session.activeHint;
    const f = hint?.focus as CardFocus | undefined;
    if (f) {
      const nudge = hint?.level === 1;
      for (const r of focusRects({ cards: f.cards, piles: f.piles })) overlay.append(outline(r, nudge ? "mark nudge" : "mark"));
      if (f.to !== undefined && !nudge) {
        const pl = rules.piles(session.state)[f.to]!;
        overlay.append(outline(rectOf(f.to, pl.c.length - 1), "mark dest", 0.8));
      }
    }
    const held = session.interaction.cursor.held;
    if (held) overlay.append(outline(rectOf(held.pile, held.index), "held", 0.5));
    ghostLayer.replaceChildren();
    if (preview) {
      const now = layout(slots, rules.piles(session.state));
      const then = layout(slots, rules.piles(preview));
      for (const pl of rules.piles(preview)) {
        for (const id of pl.c) {
          const a = now.get(id), b = then.get(id)!;
          if (a && a.x === b.x && a.y === b.y && a.up === b.up) continue;
          const el = cardElement(rules.face(p, id), id);
          setUp(el, b.up);
          el.setAttribute("transform", `translate(${b.x} ${b.y})`);
          ghostLayer.append(el);
        }
      }
    }
    const cur = session.interaction.cursor;
    const r = rectOf(cur.pile, cur.index);
    cursorEl.setAttribute("x", String(r[0] - 0.4));
    cursorEl.setAttribute("y", String(r[1] - 0.4));
    cursorEl.setAttribute("width", String(r[2] + 0.8));
    cursorEl.setAttribute("height", String(r[3] + 0.8));
  };

  // --- pointer ---

  const toBoard = (e: PointerEvent) => {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  };

  let press: { id: number; pile: number; index: number; x: number; y: number; px: number; py: number; lift: boolean; ids: number[] } | null = null;

  const target = (lead: { x: number; y: number }, from: number): number => {
    const piles = rules.piles(session.state);
    const pos = layout(slots, piles);
    let best = -1, bestArea = 0;
    const cx = lead.x + CARD_W / 2, cy = lead.y + CARD_H / 2;
    for (let i = 0; i < slots.length; i++) {
      if (i === from) continue;
      const sl = slots[i]!;
      const pl = piles[i]!;
      const last = pl.c.length ? pos.get(pl.c[pl.c.length - 1]!)! : sl;
      const x0 = sl.x, y0 = sl.y, x1 = Math.max(sl.x, last.x) + CARD_W;
      const y1 = sl.fan === "down" ? Math.max(sl.bottom ?? last.y, last.y) + CARD_H : last.y + CARD_H;
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) return i;
      const ox = Math.min(x1, lead.x + CARD_W) - Math.max(x0, lead.x);
      const oy = Math.min(y1, lead.y + CARD_H) - Math.max(y0, lead.y);
      if (ox > 0 && oy > 0 && ox * oy > bestArea) { best = i; bestArea = ox * oy; }
    }
    return best;
  };

  const act = (actions: A[] | null): boolean => {
    if (!actions?.length) return false;
    let changed = false;
    session.batch(() => { for (const a of actions) changed = session.dispatch(a) || changed; });
    return changed;
  };

  const wiggle = (ids: number[]) => {
    const base = ids.map((id) => shown.get(id)).filter((q): q is Pos & { flip: number } => !!q);
    if (!base.length || speed() === 0) return;
    anim?.cancel();
    anim = animate(240, (t) => {
      const dx = Math.sin(t * Math.PI * 4) * (1 - t) * 0.9;
      ids.forEach((id, i) => { const b = base[i]; if (b) place(id, b.x + dx, b.y, b.up); });
    }, ease.linear);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || session.locked) return;
    const t = e.target as Element;
    const cardNode = t.closest("[data-card]");
    const piles = rules.piles(session.state);
    let pile: number, index: number, id = -1;
    if (cardNode) {
      id = Number(cardNode.getAttribute("data-card"));
      const w = whereIs(piles).get(id);
      if (!w) return;
      ({ pile, index } = w);
    } else {
      const v = t.getAttribute("data-pile");
      if (v === null) return;
      pile = Number(v);
      index = piles[pile]!.c.length ? piles[pile]!.c.length - 1 : -1;
    }
    e.preventDefault();
    session.setInteraction((i) => ({ ...i, cursor: { pile, index, held: null } }));
    const lift = index >= 0 && rules.canLift(p, session.state, pile, index);
    const pt = toBoard(e);
    press = { id, pile, index, x: e.clientX, y: e.clientY, px: pt.x, py: pt.y, lift, ids: lift ? piles[pile]!.c.slice(index) : [] };
    svg.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!press) return;
    if (!dragging) {
      if (!press.lift || Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
      jump();
      dragging = { ids: press.ids, dx: 0, dy: 0 };
      order(layout(slots, rules.piles(session.state)), new Set(press.ids));
    }
    const pt = toBoard(e);
    dragging.dx = pt.x - press.px;
    dragging.dy = pt.y - press.py;
    const pos = layout(slots, rules.piles(session.state));
    for (const id of dragging.ids) { const q = pos.get(id)!; place(id, q.x + dragging.dx, q.y + dragging.dy, q.up); }
  };

  const onUp = (e: PointerEvent) => {
    if (!press) return;
    const pr = press;
    press = null;
    if (dragging) {
      const d = dragging;
      dragging = null;
      const lead = shown.get(d.ids[0]!)!;
      const to = e.type === "pointerup" ? target(lead, pr.pile) : -1;
      const a = to >= 0 ? rules.drop(p, session.state, pr.pile, pr.index, to) : null;
      if (!a || !session.dispatch(a)) settle();
      return;
    }
    if (e.type !== "pointerup") return;
    if (!act(rules.tap(p, session.state, pr.pile, pr.index))) wiggle(pr.ids.length ? pr.ids : pr.id >= 0 ? [pr.id] : []);
  };

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);

  // --- keyboard ---

  const piles = () => rules.piles(session.state);
  const topIndex = (pile: number) => piles()[pile]!.c.length - 1;
  const moveCursor = (dp: number) => () => session.setInteraction((i) => {
    const pile = (i.cursor.pile + dp + slots.length) % slots.length;
    return { ...i, cursor: { ...i.cursor, pile, index: topIndex(pile) } };
  });
  const moveDepth = (di: number) => () => session.setInteraction((i) => {
    const { pile } = i.cursor;
    const next = Math.max(0, Math.min(topIndex(pile), i.cursor.index + di));
    if (di < 0 && !rules.canLift(p, session.state, pile, next)) return i;
    return { ...i, cursor: { ...i.cursor, index: next } };
  });
  const pick = () => {
    const c = session.interaction.cursor;
    if (c.held) {
      const a = c.held.pile === c.pile ? null : rules.drop(p, session.state, c.held.pile, c.held.index, c.pile);
      session.setInteraction((i) => ({ ...i, cursor: { ...i.cursor, held: null } }));
      if (a && session.dispatch(a)) session.setInteraction((i) => ({ ...i, cursor: { ...i.cursor, index: topIndex(i.cursor.pile) } }));
      return;
    }
    if (c.index >= 0 && rules.canLift(p, session.state, c.pile, c.index)) session.setInteraction((i) => ({ ...i, cursor: { ...i.cursor, held: { pile: c.pile, index: c.index } } }));
    else act(rules.tap(p, session.state, c.pile, c.index));
  };
  const auto = () => {
    const c = session.interaction.cursor;
    if (act(rules.tap(p, session.state, c.pile, Math.min(c.index, topIndex(c.pile))))) session.setInteraction((i) => ({ ...i, cursor: { ...i.cursor, index: topIndex(i.cursor.pile), held: null } }));
  };
  const handlers = {
    "cards.left": moveCursor(-1),
    "cards.right": moveCursor(1),
    "cards.up": moveDepth(-1),
    "cards.down": moveDepth(1),
    "cards.pick": pick,
    "cards.auto": auto,
  };
  const stock = rules.stock;
  const draw = stock === undefined ? [] : bindCommands(DRAW_BINDINGS, {
    "cards.draw": () => { act(rules.tap(p, session.state, stock, topIndex(stock))); },
  }, { "cards.draw": { menu: "board", ...(rules.drawLabel ? { label: rules.drawLabel } : {}) } });

  // --- lifecycle ---

  const onChange = () => {
    const c = session.interaction.cursor;
    if (c.index > topIndex(c.pile) || (c.index < 0 && topIndex(c.pile) >= 0)) session.setInteraction((i) => ({ ...i, cursor: { ...i.cursor, index: topIndex(i.cursor.pile), held: null } }));
    settle();
    drawOverlay();
  };
  const offs = [
    session.hooks.change.tap(onChange, { owner: "view" }),
    session.hooks.interaction.tap(drawOverlay, { owner: "view" }),
    session.hooks.refresh.tap(drawOverlay, { owner: "view" }),
  ];

  const fresh = session.depth === 0 && !session.finished && rules.stock !== undefined;
  if (fresh) {
    const sl = slots[rules.stock!]!;
    const all = piles();
    const dealt = new Map<number, number>();
    const maxLen = Math.max(...all.map((pl) => pl.c.length));
    for (let i = 0; i < maxLen; i++) all.forEach((pl, pi) => { if (pi !== rules.stock && i < pl.c.length) dealt.set(pl.c[i]!, dealt.size); });
    settle({ from: (id) => (dealt.has(id) ? { x: sl.x, y: sl.y, up: false } : undefined), stagger: 14, seq: (id) => dealt.get(id) ?? 0 });
  } else settle();
  drawOverlay();

  const client = (r: [number, number, number, number]) => {
    const m = svg.getScreenCTM();
    if (!m) return new DOMRect();
    const a = new DOMPoint(r[0], r[1]).matrixTransform(m), b = new DOMPoint(r[0] + r[2], r[1] + r[3]).matrixTransform(m);
    return new DOMRect(a.x, a.y, b.x - a.x, b.y - a.y);
  };

  return {
    aspect: W / H,
    cells: { cols: Math.round(W / 4), rows: Math.round(H / 4) },
    commands: [...bindCommands(BINDINGS, handlers, { "cards.pick": { menu: "board" }, "cards.auto": { menu: "board" } }), ...draw, ...(opts.commands ?? [])],
    target: () => session.interaction.cursor,
    preview: (st) => {
      preview = st as S | null;
      drawOverlay();
    },
    locate: (focus) => {
      const f = focus as CardFocus | undefined;
      const rs = focusRects(f);
      if (f?.to !== undefined) rs.push(rectOf(f.to, topIndex(f.to)));
      return rs.map(client);
    },
    locateChange: (a, b) => {
      const pa = layout(slots, rules.piles(a as S)), pb = layout(slots, rules.piles(b as S));
      const out: DOMRect[] = [];
      for (const [id, q] of pb) {
        const o = pa.get(id);
        if (!o || o.x !== q.x || o.y !== q.y || o.up !== q.up) out.push(client([q.x, q.y, CARD_W, CARD_H]));
      }
      return out;
    },
    destroy() {
      anim?.cancel();
      offs.forEach((f) => f());
      svg.remove();
    },
  };
}

/** Legend entries every card table shares. */
export function tableLegend(): { sample: string; meaning: string }[] {
  const box = (cls: string) => `<svg viewBox="-1 -1 ${CARD_W + 2} ${CARD_H + 2}" style="height: 2.2em"><rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" rx="${CARD_R}" fill="none" stroke="var(--border)" stroke-width="0.3"/><rect x="-0.4" y="-0.4" width="${CARD_W + 0.8}" height="${CARD_H + 0.8}" rx="1.1" fill="none" stroke="var(--hint)" stroke-width="0.7" ${cls}/></svg>`;
  return [
    { sample: cardSample(null), meaning: "a face-down card" },
    { sample: box(""), meaning: "hint: the cards to move" },
    { sample: box(`stroke-dasharray="1.6 0.8"`), meaning: "hint: where they go" },
  ];
}
