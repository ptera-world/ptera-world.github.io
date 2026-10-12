import { buttonsSwapped, held, holdOtherKey, holdSkillKey, setButtonsSwapped, type HoldKey } from "../../core/gestures";
import { namespace } from "../../core/storage";
import type { AnyPuzzleDef, Hint, Step, Technique } from "../../core/types";
import { aimable, applyStep, colorOf, findStepAt, hintFrom, isPartOfStep, stepsAt, stepsOf } from "./engine";
import { KeptLayer } from "./kept";
import { openPicker, type Picker } from "./picker";
import { TileDrag, type DragFrom, type DropAt } from "./tile-drag";
import { hotbarOf, inPalette, noteProgress, progressOf, setHotbar, skillPrefs } from "./skill-prefs";
import type { Shell } from "./shell";

/** One entry of the palette and the picker: a mark the board places, or a technique. */
export interface PaletteEntry {
  id: string;
  label: string;
  technique: Technique | null;
  /** The technique's color; marks have none. */
  color?: string;
  /** The command that picks this entry, if there is one. */
  command?: string;
  /** What a plain click or tap does right now. */
  on: boolean;
  pick(): void;
}

const WHEEL_COOLDOWN_MS = 120;
const orderStore = namespace("technique-order");
/** A trigger released sooner than this after opening the picker leaves it open. */
const TAP_MS = 250;

/**
 * Everything about using techniques on the board: which one is picked (it stays picked until
 * another tool is), the ways to switch without leaving the board (keys, the picker, the wheel,
 * picking up a technique from a cell it colored), casting where the pointer is, preview, and the
 * colors techniques leave on the board.
 */
export class Casting {
  /** The picked technique: a plain click or tap casts it. Null: clicks place marks. */
  armed: Technique | null = null;
  /** Techniques picked before, most recent first (for swapping and for the hold-to-cast key). */
  private recent: Technique[] = [];
  /** Hold-to-cast key down: a click casts the picked (or last picked) technique. */
  private springHeld = false;
  /** Hold-for-whatever-fits key down; `cycle` steps through what applies at the pointer. */
  private fitsHeld = { on: false, cycle: 0 };
  /** The press in progress is the shell's (a cast, a pick-up, a technique drop): the board's own actions from it are dropped. */
  blockPress = false;
  /** The press in progress casts on release. */
  private castPress = false;
  /** Touch with preview: the spot the last tap previewed, so a second tap there casts. */
  private touchAim: string | null = null;
  private previewing = false;
  private picker: { p: Picker; opened: number } | null = null;
  private pointer: { x: number; y: number } | null = null;
  private wheelAt = 0;
  readonly kept: KeptLayer;

  constructor(private shell: Shell) {
    this.kept = new KeptLayer(shell.boardEl, () => {
      const s = shell.session;
      return s ? { session: s, view: shell.view?.handle ?? null, list: this.list(), mode: skillPrefs.kept(), fadeMs: skillPrefs.keptFadeMs(), recent: skillPrefs.keptRecent() } : null;
    });
  }

  private list(): readonly Technique[] {
    return this.shell.techniques?.list ?? [];
  }

  /** Techniques the palette shows, in palette order. */
  palette(): Technique[] {
    return this.ordered().filter(inPalette);
  }

  /** Every technique in the player's order for this puzzle; ones never placed keep their own order, after the placed ones. */
  private ordered(): Technique[] {
    const list = this.list();
    const id = this.shell.session?.def.id;
    const order = id ? orderStore.get<string[]>(id, []) : [];
    const rank = (t: Technique) => { const i = order.indexOf(t.id); return i < 0 ? order.length + list.indexOf(t) : i; };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }

  /** Put the palette's techniques in `ids` order (techniques it doesn't show keep their place after them). */
  setOrder(ids: readonly string[]): void {
    const id = this.shell.session?.def.id;
    if (!id) return;
    const rest = this.ordered().map((t) => t.id).filter((x) => !ids.includes(x));
    orderStore.set(id, [...ids, ...rest]);
    this.shell.hooks.palette.call();
  }

  /** The open puzzle's hotbar: technique ids by slot, null for an empty slot. */
  hotbar(): (string | null)[] {
    const id = this.shell.session?.def.id;
    return id ? hotbarOf(id, this.palette()) : [];
  }

  /** Put `t` (null: nothing) in hotbar slot `i`; a technique already in another slot trades places with what was in `i`. */
  setSlot(i: number, t: Technique | null): void {
    const id = this.shell.session?.def.id;
    if (!id) return;
    const slots = this.hotbar();
    const from = t ? slots.indexOf(t.id) : -1;
    if (from >= 0) slots[from] = slots[i] ?? null;
    slots[i] = t?.id ?? null;
    setHotbar(id, slots);
    this.shell.hooks.palette.call();
  }

  /** Bumped by every move: a recognition still running for an older move stops. */
  private recognizing = 0;

  /**
   * A hand move from `prev` to `next`: the easiest technique with an instance in `prev` the move is
   * part of lights up and colors what the move changed. Reads only the board. Runs a technique at a
   * time between frames, so a slow technique never holds up play.
   */
  recognize(prev: unknown, next: unknown): void {
    const run = ++this.recognizing;
    const s = this.shell.session;
    if (!s || !skillPrefs.recognize()) return;
    const list = this.list();
    let i = 0;
    const tick = () => {
      if (run !== this.recognizing || this.shell.session !== s || i >= list.length) return;
      const t = list[i++]!;
      try {
        const steps = stepsOf(s.def, t, s.puzzle, prev);
        if (steps.length && isPartOfStep(s.def, s.puzzle, prev, next, steps)) {
          this.kept.recognize(next, t);
          this.shell.hooks.recognized.call({ technique: t });
          return;
        }
      } catch (e) {
        console.error(`[games] recognizing ${t.id} threw`, e);
      }
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }

  /** Move the picked technique one place earlier (-1) or later (+1) in the palette. */
  shift(dir: 1 | -1): void {
    const t = this.armed;
    if (!t) { this.shell.setStatus("no technique picked yet"); return; }
    const ids = this.palette().map((x) => x.id);
    const i = ids.indexOf(t.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    this.setOrder(ids);
  }

  color(t: Technique): string {
    return colorOf(t, this.list());
  }

  /** The board's marks as palette entries: its tap tools, or its two click actions. */
  marks(): PaletteEntry[] {
    const view = this.shell.view?.handle;
    const s = this.shell.session;
    if (!view || !s) return [];
    const tools = view.tools;
    if (tools) {
      return tools.items.map((it) => ({
        id: `mark:${it.id}`, label: it.label, technique: null, command: it.command, on: !this.armed && tools.current() === it.id,
        pick: () => { this.pick(null); tools.pick(it.id); s.hooks.refresh.call(); },
      }));
    }
    const labels = view.gestures?.labels;
    if (!labels || !view.gestures?.secondaryClick) return [];
    const id = s.def.id;
    return labels.map((label, i) => {
      const isTap = (i === 1) === buttonsSwapped(id);
      return {
        id: `mark:${i}`, label, technique: null, on: !this.armed && isTap,
        pick: () => { this.pick(null); if (!isTap) { setButtonsSwapped(id, !buttonsSwapped(id)); s.hooks.refresh.call(); } },
      };
    });
  }

  /** Marks, then the palette's techniques. */
  entries(): PaletteEntry[] {
    return [...this.marks(), ...this.palette().map((t) => ({
      id: t.id, label: t.name, technique: t, color: this.color(t), on: this.armed?.id === t.id,
      pick: () => this.pick(t),
    }))];
  }

  /** Make `t` what a click casts (null: back to marks). Picking the picked technique again puts it down. */
  pick(t: Technique | null): void {
    const next = t && this.armed?.id !== t.id ? t : null;
    this.armed = next;
    if (next) this.recent = [next, ...this.recent.filter((x) => x.id !== next.id)].slice(0, 8);
    this.touchAim = null;
    this.shell.hooks.armed.call({ technique: next });
    this.refresh();
    if (next && skillPrefs.watchAuto() && !progressOf(next).watched && next.practice !== false) this.shell.watch(next);
  }

  /** Pick the palette's next (+1) or previous (-1) technique after the picked (or last picked) one. */
  step(dir: 1 | -1): void {
    const list = this.palette();
    if (!list.length) return;
    const from = this.armed ?? this.recent[0];
    const i = from ? list.findIndex((t) => t.id === from.id) : -1;
    const n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    if (list[n]!.id !== this.armed?.id) this.pick(list[n]!);
  }

  /** Pick the technique picked before the current one. */
  swap(): void {
    const other = this.armed ? this.recent.find((t) => t.id !== this.armed!.id) : this.recent[0];
    if (other) this.pick(other);
    else this.shell.setStatus("no other technique picked yet");
  }

  /** The trigger went down: open the picker at the pointer. Its release (`releasePicker`) picks by direction. */
  openPicker(at?: { x: number; y: number }): void {
    if (this.picker) return;
    const box = this.shell.boardEl.getBoundingClientRect();
    const p = at ?? this.pointer ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const items = this.entries();
    if (!items.length) return;
    const pref = skillPrefs.picker();
    const shape = pref === "auto" ? (items.length <= 8 ? "ring" : "grid") : pref;
    this.picker = {
      p: openPicker(items.map((e) => ({ id: e.id, label: e.label, color: e.color, on: e.on, pick: e.pick })), p.x, p.y, shape, () => { this.picker = null; }),
      opened: performance.now(),
    };
  }

  releasePicker(): void {
    const pk = this.picker;
    if (!pk) return;
    if (performance.now() - pk.opened < TAP_MS) return;
    pk.p.release();
  }

  /** The technique a click casts right now, if any. */
  active(): Technique | null {
    if (this.fitsHeld.on) {
      const here = this.here();
      return here.length ? here[this.fitsHeld.cycle % here.length]! : null;
    }
    return this.armed ?? (this.springHeld ? this.recent[0] ?? null : null);
  }

  /** Where a cast aims: the line the player dragged along, else what they point at. */
  private target(): unknown {
    return this.locked?.target ?? this.shell.aim;
  }

  /**
   * What `t` would do: one step where the player points (or anywhere, if it can't be aimed), or,
   * when several instances apply at the spot and the board lets the player say which line, all of
   * them to choose from.
   */
  stepOf(t: Technique): { step: Step; aimed: boolean; alsoLines?: boolean } | { choices: Step[]; lines: boolean } | null {
    const s = this.shell.session;
    if (!s) return null;
    if (!aimable(s.def, t)) {
      const any = this.shell.techniques?.find(t);
      return any ? { step: any, aimed: false } : null;
    }
    const target = this.target();
    const scope = skillPrefs.scope();
    const along = this.shell.view?.handle.targetAlong;
    if (scope === "one" && !this.locked && along) {
      const row = along(target, "row"), col = along(target, "col");
      if (row != null || col != null) {
        const split = splitAt(s, t, target, row, col);
        if (split.cell.length === 1) return { step: split.cell[0]!, aimed: true, alsoLines: split.lines.length > 0 };
        if (split.cell.length > 1) return { choices: split.cell, lines: false };
        if (split.lines.length === 1) return { step: split.lines[0]!, aimed: true };
        return split.lines.length ? { choices: split.lines, lines: true } : null;
      }
    }
    const at = findStepAt(s.def, t, s.puzzle, s.state, target, scope);
    return at ? { step: at, aimed: true } : null;
  }

  /** Aimable techniques that have a step where the player points. */
  here(): Technique[] {
    const s = this.shell.session;
    const target = this.shell.aim;
    if (!s || target === undefined || target === null) return [];
    return this.list().filter((t) => findStepAt(s.def, t, s.puzzle, s.state, target, skillPrefs.scope()));
  }

  /** Step through what applies where the player points, picking it. */
  pickNextHere(): void {
    this.shell.updateAim();
    const here = this.here();
    if (!here.length) { this.shell.setStatus("no technique applies here"); return; }
    const i = here.findIndex((t) => t.id === this.armed?.id);
    this.pick(here[(i + 1) % here.length]!);
  }

  /** Keep the preview, the board's cast cursor and the palette in step with what a click would do. */
  refresh(): void {
    const t = this.active();
    if (t && (skillPrefs.preview() || this.locked)) this.preview(t);
    else if (this.previewing) this.preview(null);
    const was = this.shell.root.hasAttribute("data-casting");
    this.shell.root.toggleAttribute("data-casting", !!t);
    // views size their hit zones and draw the pointed-spot outline from data-casting
    if (was !== !!t) this.shell.session?.hooks.refresh.call();
    const c = t ? this.color(t) : null;
    if (c) this.shell.root.style.setProperty("--cast", c);
    else this.shell.root.style.removeProperty("--cast");
  }

  /** The drag indicator: which way a drag across the pointed spot would choose, or has chosen. */
  private axisEl: HTMLElement | null = null;

  private showAxis(axis: "row" | "col" | "both" | null): void {
    const box = this.shell.boardEl;
    if (!axis || !this.pointer) { this.axisEl?.remove(); return; }
    if (!this.axisEl) this.axisEl = document.createElement("div");
    const el = this.axisEl;
    el.className = "cast-axis";
    el.dataset.axis = axis;
    el.textContent = axis === "row" ? "↔" : axis === "col" ? "↕" : "↔ ↕";
    const at = this.locked?.at ?? this.pointer;
    const r = box.getBoundingClientRect();
    el.style.left = `${at.x - r.left}px`;
    el.style.top = `${at.y - r.top}px`;
    if (el.parentElement !== box) box.append(el);
  }

  /** Show what `t` would do here without doing it; null clears. */
  preview(t: Technique | null): void {
    const s = this.shell.session;
    if (!s) return;
    const hit = t ? this.stepOf(t) : null;
    if (!t || !hit) {
      if (this.previewing) s.showHint(null);
      this.previewing = false;
      this.shell.view?.handle.preview?.(null);
      this.showAxis(null);
      if (t && this.shell.aim !== undefined) this.shell.setStatus(`no ${t.name} here`);
      return;
    }
    this.previewing = true;
    if ("choices" in hit) {
      let after = s.state;
      for (const st of hit.choices) after = applyStep(s.def, s.puzzle, after, st);
      s.showHint(null);
      this.shell.view?.handle.preview?.(after);
      this.showAxis(hit.lines ? "both" : null);
      this.shell.setStatus(choicesText(t, hit));
      return;
    }
    this.shell.setStatus("");
    this.showAxis(this.locked?.axis ?? (hit.aimed && "alsoLines" in hit && hit.alsoLines ? "both" : null));
    s.showHint(hintFrom(t, hit.step, 2) as Hint<any>);
    this.shell.view?.handle.preview?.(applyStep(s.def, s.puzzle, s.state, hit.step));
  }

  /** Carry out `t` where the player points (or anywhere, if it can't be aimed) as one undo step; never when several apply there and none was chosen. */
  apply(t: Technique): boolean {
    const s = this.shell.session;
    const hit = this.stepOf(t);
    this.preview(null);
    if (hit && "choices" in hit) {
      this.shell.setStatus(choicesText(t, hit));
      return false;
    }
    if (!s || !hit) {
      this.shell.setStatus(`no ${t.name} ${hit === null && this.shell.aim !== undefined ? "here" : "right now"}`);
      return false;
    }
    const source = { kind: "technique" as const, technique: t.id, name: t.name, step: hit.step, auto: false };
    s.batch(() => { for (const a of hit.step.actions) s.dispatch(a, { source }); });
    const shown = inPalette(t);
    noteProgress(t, (p) => ({ ...p, casts: (p.casts ?? 0) + 1 }));
    this.shell.setStatus("");
    if (inPalette(t) !== shown) this.shell.hooks.palette.call();
    return true;
  }

  /** A press on the board that casts: mouse casts at once; touch with preview on previews first, then casts on a second tap there. */
  private castAt(touch: boolean): void {
    const t = this.active();
    if (!t) { this.shell.setStatus(this.springHeld ? "no technique picked yet" : "no technique applies here"); return; }
    if (!this.locked) this.shell.updateAim();
    const key = JSON.stringify(this.target());
    if (touch && skillPrefs.preview() && !this.locked && this.touchAim !== key) {
      this.touchAim = key;
      this.preview(t);
      return;
    }
    this.touchAim = null;
    this.apply(t);
    this.locked = null;
    this.refresh();
  }

  /** The cast press in progress: where it began, and the line it chose once the drag had a direction. */
  private press: { x: number; y: number; aim: unknown } | null = null;
  private locked: { axis: "row" | "col"; target: unknown; at: { x: number; y: number } } | null = null;
  /** Movement before a drag counts as choosing a line. */
  private static readonly AXIS_PX = 10;

  /** A cast press moving: the first clear direction picks the line through where it began. */
  private dragMove(e: PointerEvent): void {
    const p = this.press;
    const along = this.shell.view?.handle.targetAlong;
    if (!p || this.locked || !along) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.hypot(dx, dy) < Casting.AXIS_PX) return;
    const axis = Math.abs(dx) >= Math.abs(dy) ? "row" : "col";
    const target = along(p.aim, axis);
    if (target == null) return;
    this.locked = { axis, target, at: { x: p.x, y: p.y } };
    this.touchAim = null;
    this.refresh();
  }

  /** True if the press matches a mouse binding of the picker, which the board then leaves alone. */
  private pickerPress(e: PointerEvent): boolean {
    return this.shell.hub.mouseMatches("shell.skill-picker", e);
  }

  /** Dragging techniques within the palette and to, from and within the hotbar. */
  drag!: TileDrag;
  /** The technique the player's last hand move turned out to use, until the next move. */
  lit: Technique | null = null;

  private dropped(t: Technique, from: DragFrom, at: DropAt): void {
    if (at?.kind === "slot") { this.setSlot(at.slot, t); return; }
    if (at?.kind === "palette") {
      if (from.kind === "slot") { this.setSlot(from.slot, null); return; }
      if (at.id === t.id) return;
      const ids = this.palette().map((x) => x.id).filter((x) => x !== t.id);
      ids.splice(ids.indexOf(at.id) + (at.after ? 1 : 0), 0, t.id);
      this.setOrder(ids);
      return;
    }
    if (from.kind === "slot") this.setSlot(from.slot, null);
  }

  /** Mouse, keyboard, wheel and touch wiring; bound to `signal`. */
  install(signal: AbortSignal): void {
    this.drag = new TileDrag({
      drop: (t, from, at) => this.dropped(t, from, at),
      held: (t) => { if (skillPrefs.watchHold() && t.practice !== false) this.shell.watch(t); },
    }, signal);
    this.shell.hooks.recognized.tap(({ technique }) => { this.lit = technique; });
    const box = this.shell.boardEl;
    const track = (e: PointerEvent) => { this.pointer = { x: e.clientX, y: e.clientY }; };
    box.addEventListener("pointermove", track, { signal });
    // a picker press on the board is the shell's alone: the board never sees it, and the browser's
    // own use of the button (autoscroll, paste, back / forward) is cancelled through its release
    let pickerButton = -1;
    const swallow = (e: MouseEvent) => { if (e.button === pickerButton) { e.preventDefault(); e.stopPropagation(); } };
    box.addEventListener("mousedown", swallow, { capture: true, signal });
    window.addEventListener("auxclick", (e) => { if (e.button === pickerButton) { e.preventDefault(); e.stopPropagation(); pickerButton = -1; } }, { capture: true, signal });
    window.addEventListener("pointerup", (e) => {
      if (e.button !== pickerButton) return;
      e.preventDefault();
      this.releasePicker();
      if (e.button !== 3 && e.button !== 4) pickerButton = -1;
    }, { capture: true, signal });
    window.addEventListener("mouseup", swallow, { capture: true, signal });
    box.addEventListener("pointerdown", (e) => {
      track(e);
      this.castPress = false;
      this.blockPress = false;
      if (this.pickerPress(e)) {
        e.preventDefault();
        e.stopPropagation();
        pickerButton = e.button;
        this.openPicker({ x: e.clientX, y: e.clientY });
        return;
      }
      if (e.button === 0 && held(e, skillPrefs.eyedrop())) {
        const t = this.kept.techniqueAt(e.clientX, e.clientY);
        if (t) { this.blockPress = true; if (this.armed?.id !== t.id) this.pick(t); return; }
      }
      if (e.button === 2 && this.armed && skillPrefs.rightClick() === "drop") { this.blockPress = true; return; }
      this.sync(e);
      if (e.button === 0 && this.active()) {
        this.castPress = true;
        this.blockPress = true;
        this.shell.updateAim();
        this.press = { x: e.clientX, y: e.clientY, aim: this.shell.aim };
        this.locked = null;
      }
    }, { capture: true, signal });
    box.addEventListener("pointerup", (e) => {
      if (e.button === 2 && this.blockPress && this.armed && skillPrefs.rightClick() === "drop") { this.pick(null); return; }
      if (this.castPress && e.button === 0) this.castAt(e.pointerType === "touch");
    }, { capture: true, signal });
    window.addEventListener("pointermove", (e) => { if (this.castPress) this.dragMove(e); }, { capture: true, signal });
    const end = () => { setTimeout(() => { this.blockPress = false; this.castPress = false; this.press = null; if (this.locked) { this.locked = null; this.refresh(); } }, 0); };
    window.addEventListener("pointerup", end, { capture: true, signal });
    window.addEventListener("pointercancel", end, { capture: true, signal });
    box.addEventListener("wheel", (e) => {
      const key = skillPrefs.wheel();
      if (key === "none" || !held(e, key) || e.deltaY === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - this.wheelAt < WHEEL_COOLDOWN_MS) return;
      this.wheelAt = now;
      this.step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false, signal });
    document.addEventListener("keydown", (e) => {
      if (this.fitsHeld.on && e.key === "Shift") { this.fitsHeld.cycle++; this.refresh(); }
      this.sync(e);
      if ((this.springHeld || this.fitsHeld.on) && e.key === "Alt") e.preventDefault();
    }, { signal });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Alt" && this.active()) e.preventDefault();
      this.sync(e);
    }, { signal });
    box.addEventListener("pointermove", (e) => this.sync(e), { signal });
    window.addEventListener("blur", () => { this.springHeld = false; this.fitsHeld = { on: false, cycle: 0 }; this.kept.reveal(false); this.refresh(); }, { signal });
    this.shell.hooks.aim.tap(() => { if (this.active()) this.refresh(); });
  }

  /** Read the hold keys from an event. */
  private sync(e: KeyboardEvent | MouseEvent): void {
    const on = (k: HoldKey) => k !== "none" && k !== holdOtherKey() && held(e, k);
    const spring = on(holdSkillKey());
    const fits = on(skillPrefs.holdFits());
    this.kept.reveal(on(skillPrefs.eyedrop()));
    if (spring === this.springHeld && fits === this.fitsHeld.on) return;
    this.springHeld = spring;
    if (fits !== this.fitsHeld.on) this.fitsHeld = { on: fits, cycle: 0 };
    this.refresh();
  }

  /** A new game: nothing picked, no preview. */
  reset(): void {
    this.armed = null;
    this.previewing = false;
    this.touchAim = null;
    this.press = null;
    this.locked = null;
    this.showAxis(null);
    this.picker?.p.close();
    this.shell.root.removeAttribute("data-casting");
    this.kept.schedule();
  }
}

/**
 * The instances of `t` at `target`, split into those only about the pointed cell (a click casts
 * them) and those about the row or column through it (a drag picks the line). Instances that
 * would leave the board the same are one. Cell instances are the ones neither narrowed target finds.
 */
export function splitAt(s: { def: AnyPuzzleDef; puzzle: unknown; state: unknown }, t: Technique, target: unknown, row: unknown, col: unknown): { cell: Step[]; lines: Step[] } {
  const result = (st: Step) => JSON.stringify(applyStep(s.def, s.puzzle, s.state, st));
  const distinct = (steps: Step[]) => {
    const seen = new Set<string>();
    return steps.filter((st) => { const k = result(st); if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const on = (x: unknown) => (x == null ? [] : stepsAt(s.def, t, s.puzzle, s.state, x));
  const lines = distinct([...on(row), ...on(col)]);
  const lineKeys = new Set(lines.map(result));
  const cell = distinct(stepsAt(s.def, t, s.puzzle, s.state, target).filter((st) => !lineKeys.has(result(st))));
  return { cell, lines };
}

/** What the status says when a click can't tell which instance is meant. */
const choicesText = (t: Technique, hit: { choices: Step[]; lines: boolean }): string =>
  hit.lines ? `${hit.choices.length} ${t.name}s fit here: drag along the line you mean` : `${hit.choices.length} different ${t.name}s fit this one cell`;
