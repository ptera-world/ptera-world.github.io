import { createRng } from "./rng";
import { generate } from "./generate";
import type { Registry } from "./registry";
import type { Session } from "./session";
import { namespace } from "./storage";
import type { Action, AnyPuzzleDef, Hint, Step, Technique } from "./types";

const store = namespace("technique");

export interface TechniqueConfig {
  /** Offered by the hint command. */
  hints: boolean;
  /** Applied automatically after every move (and when switched on). */
  auto: boolean;
}

export function loadTechniqueConfig(t: Technique): TechniqueConfig {
  const raw = store.get<Partial<TechniqueConfig>>(t.id, {});
  return {
    hints: raw.hints ?? t.defaults?.hints ?? true,
    auto: raw.auto ?? t.defaults?.auto ?? false,
  };
}

export function saveTechniqueConfig(t: Technique, cfg: TechniqueConfig): void {
  store.set(t.id, cfg);
}

/** Apply a step's actions with the pure reducer. */
export function applyStep<Pz, S, A extends Action>(def: AnyPuzzleDef, puzzle: Pz, state: S, step: Step<A>): S {
  let s = state;
  for (const a of step.actions) s = def.reduce(puzzle, s, a);
  return s;
}

/** Safe find: a throwing or no-op technique counts as "not found". */
export function findStep<Pz, S>(def: AnyPuzzleDef, t: Technique, puzzle: Pz, state: S): Step | null {
  try {
    const step = t.find(puzzle, state);
    if (!step || step.actions.length === 0) return null;
    return Object.is(applyStep(def, puzzle, state, step), state) ? null : step;
  } catch (e) {
    console.error(`[games] technique ${t.id} threw`, e);
    return null;
  }
}

/** Safe targeted find (see Technique.findAt); null when the technique has no targeted form. */
export function findStepAt<Pz, S>(def: AnyPuzzleDef, t: Technique, puzzle: Pz, state: S, target: unknown): Step | null {
  if (!t.findAt || target === undefined || target === null) return null;
  try {
    const step = t.findAt(puzzle, state, target);
    if (!step || step.actions.length === 0) return null;
    return Object.is(applyStep(def, puzzle, state, step), state) ? null : step;
  } catch (e) {
    console.error(`[games] technique ${t.id} findAt threw`, e);
    return null;
  }
}

/** Easiest applicable technique among `list` (which must be sorted easiest first). */
export function firstStep<Pz, S>(def: AnyPuzzleDef, list: readonly Technique[], puzzle: Pz, state: S): { technique: Technique; step: Step } | null {
  for (const t of list) {
    const step = findStep(def, t, puzzle, state);
    if (step) return { technique: t, step };
  }
  return null;
}

/** Level 1 (nudge) carries level 2 (full) in `more`; level 2 alone when asked directly. */
export function hintFrom(t: Technique, step: Step, level: number): Hint {
  const full: Hint = { message: `${t.name}: ${step.message}`, focus: step.focus, technique: t.id, level: 2, actions: step.actions };
  if (level >= 2) return full;
  return {
    message: step.nudge ? `${t.name}: ${step.nudge}` : `try a ${t.name}`,
    focus: step.nudgeFocus,
    technique: t.id,
    level: 1,
    actions: step.actions,
    more: full,
  };
}

const AUTO_OWNER = "techniques";
const AUTO_GUARD = 10_000;
const PACE_KEY = "_pace";

/** Milliseconds between automatic steps; 0 applies them all inside the triggering move. */
export function loadPace(): number {
  return store.get<number>(PACE_KEY, 0);
}

export function savePace(ms: number): void {
  store.set(PACE_KEY, Math.max(0, Math.round(ms)));
}

/**
 * Attaches a puzzle's techniques to a session: auto-application, hints (easiest hint-enabled
 * technique), and re-application when configuration changes. Every automatic step is attributed
 * (ChangeCtx.notes when instant, ChangeCtx.source when paced) and lands in the undo step of the
 * move that triggered it.
 */
export class TechniqueHost {
  readonly list: Technique[];
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private offs: (() => void)[] = [];

  constructor(registry: Registry, private session: Session<any, any, any, any>) {
    this.list = registry.techniquesFor(session.def.id, session.puzzle);
    const def = session.def;

    session.hooks.apply.tap((next, { puzzle, action, note }) => {
      if (loadPace() > 0) return next;
      if (action && def.isRetraction?.(action)) return next;
      const auto = this.autoList();
      if (!auto.length) return next;
      let s = next;
      for (let guard = 0; guard < AUTO_GUARD; guard++) {
        const hit = firstStep(def, auto, puzzle, s);
        if (!hit) break;
        const after = applyStep(def, puzzle, s, hit.step);
        note({ kind: "technique", technique: hit.technique.id, name: hit.technique.name, step: hit.step, auto: true }, s, after);
        s = after;
      }
      return s;
    }, { owner: AUTO_OWNER, priority: 50 });

    this.offs.push(session.hooks.change.tap(({ cause, actions, source }) => {
      if (cause !== "action") {
        this.stop();
        return;
      }
      if (loadPace() === 0) return;
      if (source?.kind === "technique" && source.auto) return;
      if (actions.length === 1 && def.isRetraction?.(actions[0])) return;
      this.kick();
    }, { owner: AUTO_OWNER }));

    session.hooks.hint.tap(({ puzzle, state }) => {
      const usable = this.list.filter((t) => loadTechniqueConfig(t).hints);
      const hit = firstStep(def, usable, puzzle, state);
      return hit ? hintFrom(hit.technique, hit.step, 1) : undefined;
    }, { owner: AUTO_OWNER, priority: 100 });
  }

  /**
   * Techniques applied automatically. On a practice board the practised technique and anything at
   * least as hard never auto-apply, or the board would solve the exercise itself.
   */
  private autoList(): Technique[] {
    const o = this.session.origin;
    const target = o.kind === "practice" ? this.list.find((t) => t.id === o.technique) : undefined;
    return this.list.filter((t) => loadTechniqueConfig(t).auto && (!target || t.level < target.level));
  }

  /** Paced mode: apply the next automatic step after the pace delay, repeating until none apply. */
  private kick(): void {
    this.stop();
    const pace = loadPace();
    if (pace === 0 || this.session.solved) return;
    this.timer = setTimeout(() => {
      this.timer = 0;
      const s = this.session;
      const hit = firstStep(s.def, this.autoList(), s.puzzle, s.state);
      if (!hit) return;
      const source = { kind: "technique" as const, technique: hit.technique.id, name: hit.technique.name, step: hit.step, auto: true };
      for (const a of hit.step.actions) s.dispatch(a, { source, extend: true });
      this.kick();
    }, pace);
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
  }

  config(t: Technique): TechniqueConfig {
    return loadTechniqueConfig(t);
  }

  /** Persist config; switching auto on applies it now (as one undoable step, or paced). */
  setConfig(t: Technique, cfg: TechniqueConfig): void {
    const before = loadTechniqueConfig(t);
    saveTechniqueConfig(t, cfg);
    if (cfg.auto && !before.auto) {
      if (loadPace() > 0) this.kick();
      else this.session.settle(true, AUTO_OWNER);
    }
    this.session.invalidateDerived();
  }

  setPace(ms: number): void {
    savePace(ms);
    this.kick();
  }

  find(t: Technique): Step | null {
    return findStep(this.session.def, t, this.session.puzzle, this.session.state);
  }

  /** Apply one instance of t as its own undo step, attributed to t. */
  apply(t: Technique): boolean {
    const step = this.find(t);
    if (!step) return false;
    const source = { kind: "technique" as const, technique: t.id, name: t.name, step, auto: false };
    let changed = false;
    this.session.batch(() => {
      for (const a of step.actions) changed = this.session.dispatch(a, { source }) || changed;
    });
    return changed;
  }

  destroy(): void {
    this.stop();
    for (const f of this.offs) f();
    this.session.hooks.apply.untapOwner(AUTO_OWNER);
    this.session.hooks.hint.untapOwner(AUTO_OWNER);
  }
}

export interface PracticePosition {
  puzzle: unknown;
  state: unknown;
  step: Step;
  seed: string;
}

/**
 * A position where `target` is the easiest technique that applies: generated from seeded
 * puzzles, solved forward with easier techniques until target is next. Deterministic in seed.
 * Returns null if none is found within `tries` puzzles.
 */
export async function findPracticePosition(
  def: AnyPuzzleDef,
  all: readonly Technique[],
  target: Technique,
  seed: string,
  signal: AbortSignal,
  tries = 12,
): Promise<PracticePosition | null> {
  const seeds = createRng(`practice|${target.id}|${seed}`);
  for (let i = 0; i < tries; i++) {
    if (signal.aborted) return null;
    const s = `${seed}-${seeds.int(1e9).toString(36)}`;
    const puzzle = await generate(def, (target.practice || undefined)?.params ?? {}, s, signal);
    let state = def.init(puzzle);
    for (let guard = 0; guard < 2000; guard++) {
      const hit = firstStep(def, all, puzzle, state);
      if (!hit) break;
      if (hit.technique.id === target.id) {
        const shown = (target.practice || undefined)?.prepare?.(puzzle, state) ?? state;
        const step = findStep(def, target, puzzle, shown) ?? hit.step;
        return { puzzle, state: shown, step, seed: s };
      }
      state = applyStep(def, puzzle, state, hit.step);
      if (guard % 20 === 19) await new Promise((r) => setTimeout(r, 0));
    }
  }
  return null;
}

/** Leaf-level changes from a to b, keyed by JSON path. */
function leafChanges(a: unknown, b: unknown, path = "", out = new Map<string, string>()): Map<string, string> {
  if (Object.is(a, b)) return out;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) leafChanges(a[i], b[i], `${path}/${i}`, out);
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) leafChanges((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`, out);
    return out;
  }
  const bj = JSON.stringify(b);
  if (JSON.stringify(a) !== bj) out.set(path, bj ?? "undefined");
  return out;
}

const same = (a: unknown, b: unknown): boolean => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

/**
 * True if the move prev → next is part of `step`. Either test suffices:
 * - every leaf the move changed now holds the value the completed step gives it (handles toggles);
 * - finishing the step from next lands where finishing it from prev would (handles several facts
 *   packed into one value, e.g. candidate bitmasks, where a partial move sets a leaf to an
 *   intermediate value).
 */
export function isPartOfStep(def: AnyPuzzleDef, puzzle: unknown, prev: unknown, next: unknown, step: Step): boolean {
  const moved = leafChanges(prev, next);
  if (moved.size === 0) return false;
  const target = applyStep(def, puzzle, prev, step);
  const tLeaves = leafChanges(prev, target);
  let leafOk = true;
  for (const [p, v] of moved) if (tLeaves.get(p) !== v) { leafOk = false; break; }
  return leafOk || same(applyStep(def, puzzle, next, step), target);
}

/** True once `state` carries every change the step makes from `from`. */
export function isStepDone(def: AnyPuzzleDef, puzzle: unknown, from: unknown, state: unknown, step: Step): boolean {
  const target = applyStep(def, puzzle, from, step);
  return same(state, target);
}

/** Hardest technique needed to solve from the start using only techniques, or null if they don't suffice. */
export function rateByTechniques(def: AnyPuzzleDef, list: readonly Technique[], puzzle: unknown): { hardest: Technique; steps: number } | null {
  let state = def.init(puzzle);
  let hardest: Technique | null = null;
  let steps = 0;
  for (let guard = 0; guard < 5000 && !def.isSolved(puzzle, state); guard++) {
    const hit = firstStep(def, list, puzzle, state);
    if (!hit) return null;
    if (!hardest || hit.technique.level > hardest.level) hardest = hit.technique;
    state = applyStep(def, puzzle, state, hit.step);
    steps++;
  }
  return hardest ? { hardest, steps } : null;
}
