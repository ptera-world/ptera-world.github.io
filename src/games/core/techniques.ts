import { createRng } from "./rng";
import { generate } from "./generate";
import type { Registry } from "./registry";
import type { Session } from "./session";
import { namespace } from "./storage";
import type { Action, AnyPuzzleDef, Hint, Step, Technique } from "./types";

import { hintFrom } from "./define";
export { hintFrom };

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

/** Instances that change the state, visited until `visit` returns true. A throwing technique visits nothing more. */
function validInstances<Pz, S>(def: AnyPuzzleDef, t: Technique, puzzle: Pz, state: S, visit: (step: Step) => boolean | void): void {
  try {
    t.instances(puzzle, state, (step) => step.actions.length > 0 && !Object.is(applyStep(def, puzzle, state, step), state) && visit(step) === true);
  } catch (e) {
    console.error(`[games] technique ${t.id} threw`, e);
  }
}

/** First instance that changes the state, or null. */
export function findStep<Pz, S>(def: AnyPuzzleDef, t: Technique, puzzle: Pz, state: S): Step | null {
  let hit: Step | null = null;
  validInstances(def, t, puzzle, state, (step) => { hit = step; return true; });
  return hit;
}

/** Every instance that changes the state, preferred first. */
export function stepsOf<Pz, S>(def: AnyPuzzleDef, t: Technique, puzzle: Pz, state: S): Step[] {
  const out: Step[] = [];
  validInstances(def, t, puzzle, state, (step) => { out.push(step); });
  return out;
}

/** A technique's color: its own, else a hue spread evenly by its position among `list` (its puzzle's techniques). */
export function colorOf(t: Technique, list: readonly Technique[]): string {
  if (t.color) return t.color;
  const i = Math.max(0, list.findIndex((x) => x.id === t.id));
  return `hsl(${Math.round((i * 137.508 + 280) % 360)} 70% 58%)`;
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
    this.list = registry.techniquesFor(session.def, session.puzzle);
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
   * Techniques applied automatically. On a practice board the practiced technique and anything at
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
    if (pace === 0 || this.session.finished) return;
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

/** A board to practice `technique` on: every instance of it in `state` is the lesson. */
export interface PracticePosition {
  puzzle: unknown;
  state: unknown;
  seed: string;
}

const seen = namespace("technique-positions");
const SEEN_PER_TECHNIQUE = 3;

/**
 * Remember a real position where `t` was the next move (from a hint, an auto step, a button or
 * a skill in any game), so explainers and practice can show one even when random generation
 * rarely produces it. Keeps the few most recent per technique.
 */
export function rememberPosition(t: Technique, puzzleId: string, puzzle: unknown, state: unknown): void {
  const key = `${puzzleId}:${t.id}`;
  const list = seen.get<{ puzzle: unknown; state: unknown }[]>(key, []);
  const sig = JSON.stringify(state);
  if (list.some((p) => JSON.stringify(p.state) === sig)) return;
  seen.set(key, [{ puzzle, state }, ...list].slice(0, SEEN_PER_TECHNIQUE));
}

/** `state` as the player is shown it, if `t` is the easiest technique there and still applies once shown. */
function practiceAt(def: AnyPuzzleDef, t: Technique, all: readonly Technique[], puzzle: unknown, state: unknown): unknown {
  if (firstStep(def, all, puzzle, state)?.technique.id !== t.id) return null;
  const shown = (t.practice || undefined)?.prepare?.(puzzle, state) ?? state;
  return findStep(def, t, puzzle, shown) ? shown : null;
}

/** A remembered position where `t` still applies (stale entries are skipped). */
export function rememberedPosition(def: AnyPuzzleDef, t: Technique, all: readonly Technique[]): PracticePosition | null {
  for (const p of seen.get<{ puzzle: unknown; state: unknown }[]>(`${def.id}:${t.id}`, [])) {
    const shown = practiceAt(def, t, all, p.puzzle, p.state);
    if (shown) return { puzzle: p.puzzle, state: shown, seed: "remembered" };
  }
  return null;
}

/**
 * A position where `target` is the easiest technique that applies: generated from seeded
 * puzzles, played forward with easier techniques (or the puzzle's own hint when none applies)
 * until target is next. Deterministic in seed.
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
  const known = rememberedPosition(def, target, all);
  if (known) return known;
  const seeds = createRng(`practice|${target.id}|${seed}`);
  for (let i = 0; i < tries; i++) {
    if (signal.aborted) return null;
    const s = `${seed}-${seeds.int(1e9).toString(36)}`;
    const puzzle = await generate(def, (target.practice || undefined)?.params ?? {}, s, signal);
    let state = def.init(puzzle);
    for (let guard = 0; guard < 2000; guard++) {
      const hit = firstStep(def, all, puzzle, state);
      if (hit?.technique.id === target.id) {
        const shown = practiceAt(def, target, all, puzzle, state);
        if (shown) return { puzzle, state: shown, seed: s };
        break;
      }
      const moves = hit?.step.actions ?? def.hint?.(puzzle, state)?.actions ?? [];
      const next = applyStep(def, puzzle, state, { message: "", actions: moves });
      if (Object.is(next, state)) break;
      state = next;
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
 * True if the move prev → next is part of carrying out `steps` (all to do from prev). Any test suffices:
 * - every leaf the move changed holds the value one step gives it, so it is part of that step
 *   (other steps may become impossible: they were alternatives to it);
 * - finishing one step from next lands where finishing it from prev would (handles several facts
 *   packed into one value, e.g. candidate bitmasks, where a partial move sets a leaf to an
 *   intermediate value);
 * - every changed leaf holds the value doing all the steps gives it, and every step can still be
 *   finished (a move spanning several steps at once).
 */
export function isPartOfStep(def: AnyPuzzleDef, puzzle: unknown, prev: unknown, next: unknown, steps: readonly Step[]): boolean {
  const moved = leafChanges(prev, next);
  if (moved.size === 0 || steps.length === 0) return false;
  const within = (target: unknown) => {
    const given = leafChanges(prev, target);
    return [...moved].every(([p, v]) => given.get(p) === v);
  };
  const targets = steps.map((st) => applyStep(def, puzzle, prev, st));
  if (targets.some(within)) return true;
  if (steps.some((st, i) => same(applyStep(def, puzzle, next, st), targets[i]))) return true;
  return within(steps.reduce((s, st) => applyStep(def, puzzle, s, st), prev))
    && steps.every((st) => isDone(def, puzzle, prev, next, st) || isDone(def, puzzle, prev, applyStep(def, puzzle, next, st), st));
}

/** True once `state` carries every change `step` makes from `from`. */
function isDone(def: AnyPuzzleDef, puzzle: unknown, from: unknown, state: unknown, step: Step): boolean {
  const target = leafChanges(from, applyStep(def, puzzle, from, step));
  const now = leafChanges(from, state);
  return [...target].every(([p, v]) => now.get(p) === v) || same(applyStep(def, puzzle, state, step), state);
}

/**
 * Of `steps` (instances found in `from`), those still left to do in `state`: not done yet, and
 * doing them now would complete them. A step another one ruled out (an alternative move) is not left.
 */
export function stepsLeft(def: AnyPuzzleDef, puzzle: unknown, from: unknown, state: unknown, steps: readonly Step[]): Step[] {
  return steps.filter((st) => !isDone(def, puzzle, from, state, st) && isDone(def, puzzle, from, applyStep(def, puzzle, state, st), st));
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
