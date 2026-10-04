import { Bail, Event, Waterfall } from "./hooks";
import { apply as applyPatch, diff, type Patch } from "./patch";
import type { Action, AnyPuzzleDef, Hint, PuzzleDef, Step } from "./types";

/** Exact, assist-independent record of a game: per-step state patches plus who made each step. */
export interface SharedHistory {
  /** Patch from the puzzle's initial state to the first history state (usually null). */
  start: Patch | null;
  steps: { p: Patch | null; s: Source[] }[];
}

/** Sources without bulky step payloads, for links. */
function slim(src: Source): Source {
  return src.kind === "technique" ? { ...src, step: { message: src.step.message, actions: [] } } : src;
}

export type Origin =
  | { kind: "generated"; seed: string; params: Record<string, unknown>; generatorVersion: number }
  | { kind: "imported"; format?: string; source?: string }
  | { kind: "practice"; technique: string; seed: string; step: Step };

export type ChangeCause = "action" | "undo" | "redo" | "restore";

export interface ActionCtx<Pz, S, A extends Action, I> {
  session: Session<Pz, S, A, I>;
  state: S;
}

export interface ApplyCtx<Pz, S, A extends Action, I> {
  session: Session<Pz, S, A, I>;
  puzzle: Pz;
  /** State before this step. During a settle pass it equals the incoming state. */
  prev: S;
  /**
   * The player action being applied, or null for a settle pass. A settle pass runs when an
   * assist is switched on, the session opens, or the board restarts: there is no move to react
   * to, so taps must check the whole state rather than only what differs from prev.
   */
  action: A | null;
  /** The puzzle's pure reducer, for applying follow-up actions inside the same history step. */
  reduce(state: S, action: A): S;
  /** Attribute a sub-change made by this tap (shows up in ChangeCtx.notes). */
  note(source: Source, before: S, after: S): void;
  /** Source of the action being applied (undefined during settle). */
  source?: Source;
}

export interface DeriveCtx<Pz, S, I> {
  puzzle: Pz;
  state: S;
  interaction: I;
}

/** Who made a change. Everything that changes state carries one, so it can be explained, paced, logged or celebrated. */
export type Source =
  | { kind: "player" }
  | { kind: "technique"; technique: string; name: string; step: Step; auto: boolean; viaHint?: boolean }
  | { kind: "hint"; technique?: string }
  | { kind: "assist"; owner: string }
  | { kind: "system"; reason: string };

/** A sub-change inside one step, attributed to its source (e.g. one auto-filled single). */
export interface Note<S> {
  source: Source;
  before: S;
  after: S;
}

export interface ChangeCtx<S, A> {
  prev: S;
  state: S;
  /** Actions committed in this step (empty for undo/redo/restore). */
  actions: readonly A[];
  cause: ChangeCause;
  /** Source of the dispatched action (undefined for undo/redo/restore). */
  source?: Source;
  /** Attributed sub-changes made by apply taps, in order. */
  notes: readonly Note<S>[];
}

/**
 * Feedback events. `focus` is puzzle-specific highlight data (same shape as Hint.focus) that the
 * view can turn into screen positions; prev/state let a view locate what changed.
 */
export type FxEvent<S = unknown> =
  | { kind: "change"; source: Source; prev: S; state: S }
  | { kind: "step"; technique: string; name: string; focus?: unknown; auto: boolean; prev: S; state: S }
  | { kind: "solved"; elapsedMs: number }
  | { kind: "undo" | "redo" | "restart" }
  | { kind: "hint"; focus?: unknown }
  | { kind: "mistake"; focus?: unknown }
  | { kind: "practice"; correct: boolean; done: boolean }
  | { kind: string; [key: string]: unknown };

export interface DispatchOptions {
  source?: Source;
  /** Merge into the previous undo step instead of starting a new one (e.g. paced follow-ups). */
  extend?: boolean;
}

/** Annotation bag produced by the `derive` hook; keys are conventions between plugins and views. */
export type Derived = Record<string, unknown>;

interface HistoryEntry<S, A> {
  state: S;
  actions: A[];
  /** Who made this step and every attributed sub-change in it, in order. */
  sources?: Source[];
}

/** One undo step as seen from outside: what was dispatched and who did it. */
export interface TimelineEntry<A> {
  actions: readonly A[];
  sources: readonly Source[];
}

export interface Snapshot {
  v: 1;
  puzzleId: string;
  puzzle: unknown;
  state: unknown;
  interaction?: unknown;
  origin: Origin;
  elapsedMs: number;
  solvedAtMs: number | null;
  /** Player-paused (as opposed to paused because the page is hidden). */
  paused?: boolean;
  past: { state: unknown; actions: unknown[]; sources?: Source[] }[];
  future: { state: unknown; actions: unknown[]; sources?: Source[] }[];
}

const HISTORY_LIMIT = 2000;
const APPLY_ROUNDS = 200;
const SNAPSHOT_HISTORY_LIMIT = 300;

/**
 * Headless game: puzzle + progress + interaction + history + timer, no DOM.
 * State only changes through dispatch/undo/redo/restore; every change fires `change`.
 */
export class Session<Pz = unknown, S = unknown, A extends Action = Action, I = unknown> {
  readonly hooks = {
    /** Transform or veto (return null) an incoming action before it reaches the reducer. */
    action: new Waterfall<A | null, ActionCtx<Pz, S, A, I>>("action"),
    /**
     * Post-reduce: return a further-modified state. Rounds repeat until no tap changes anything
     * (the result is one history step); `prev` is the input of the previous round, or the
     * pre-action state in round one. Also runs on settle passes (action null). Taps must be
     * idempotent and must eventually stop changing the state.
     */
    apply: new Waterfall<S, ApplyCtx<Pz, S, A, I>>("apply"),
    /** Build view annotations from current state. Must be pure in (puzzle, state, interaction, settings). */
    derive: new Waterfall<Derived, DeriveCtx<Pz, S, I>>("derive"),
    change: new Event<ChangeCtx<S, A>>("change"),
    interaction: new Event<{ prev: I; interaction: I }>("interaction"),
    solved: new Event<{ elapsedMs: number }>("solved"),
    hint: new Bail<DeriveCtx<Pz, S, I>, Hint<A> | null>("hint"),
    /** Things worth reacting to (effects, sound, logs). Packs may emit their own kinds. */
    fx: new Event<FxEvent<S>>("fx"),
    /** Annotations changed for a reason other than state/interaction (e.g. plugin settings); views should re-render. */
    refresh: new Event<void>("refresh"),
  };

  private _state: S;
  private _interaction: I;
  private past: HistoryEntry<S, A>[] = [];
  private future: HistoryEntry<S, A>[] = [];
  private batchDepth = 0;
  private batchStart: S | null = null;
  private _activeHint: Hint<A> | null = null;
  private _paused = false;
  private pendingNotes: Note<S>[] = [];
  private batchActions: A[] = [];
  private batchSources: Source[] = [];
  private derivedCache: { state: S; interaction: I; version: number; value: Derived } | null = null;
  private deriveVersion = 0;
  private elapsedBase = 0;
  private runningSince: number | null = null;
  private _solvedAtMs: number | null = null;

  constructor(
    readonly def: PuzzleDef<Pz, S, A, I, any>,
    readonly puzzle: Pz,
    readonly origin: Origin,
    initial?: { state?: S; interaction?: I; elapsedMs?: number; solvedAtMs?: number | null },
  ) {
    this._state = initial?.state ?? def.init(puzzle);
    this._interaction = initial?.interaction ?? (def.initInteraction?.(puzzle) as I);
    this.elapsedBase = initial?.elapsedMs ?? 0;
    this._solvedAtMs = initial?.solvedAtMs ?? null;
  }

  get state(): S {
    return this._state;
  }

  get interaction(): I {
    return this._interaction;
  }

  get solved(): boolean {
    return this._solvedAtMs !== null;
  }

  get solvedAtMs(): number | null {
    return this._solvedAtMs;
  }

  /** Returns true if the state changed. */
  dispatch(action: A, opts: DispatchOptions = {}): boolean {
    const source = opts.source ?? { kind: "player" };
    const vetted = this.hooks.action.call(action, { session: this, state: this._state });
    if (vetted === null) return false;
    const prev = this._state;
    const reduce = (s: S, a: A) => this.def.reduce(this.puzzle, s, a);
    const notes: Note<S>[] = [];
    const note = (src: Source, before: S, after: S) => { notes.push({ source: src, before, after }); };
    const next = this.applyToFixpoint(reduce(prev, vetted), prev, vetted, reduce, note, source);
    if (Object.is(next, prev)) return false;
    if (this.batchDepth > 0) {
      this._state = next;
      this.batchActions.push(vetted);
      this.batchSources.push(source, ...notes.map((n) => n.source));
      this.emit(prev, [vetted], "action", false, source, notes);
      return true;
    }
    if (opts.extend && this.past.length > 0) {
      const last = this.past[this.past.length - 1]!;
      last.actions.push(vetted);
      (last.sources ??= []).push(source, ...notes.map((n) => n.source));
      this.future = [];
      this._state = next;
      this.emit(prev, [vetted], "action", true, source, notes);
      return true;
    }
    this.pushHistory(prev, [vetted], [source, ...notes.map((n) => n.source)]);
    this._state = next;
    this.emit(prev, [vetted], "action", true, source, notes);
    return true;
  }

  /**
   * Group every dispatch inside fn into one history step (e.g. a drag that paints many cells).
   * Nested batches merge into the outermost.
   */
  batch(fn: () => void): void {
    this.beginBatch();
    try {
      fn();
    } finally {
      this.endBatch();
    }
  }

  /**
   * Open a history step spanning several event handlers (pointerdown → pointermove → pointerup).
   * Each beginBatch needs exactly one endBatch; nesting merges into the outermost.
   */
  beginBatch(): void {
    if (this.batchDepth++ === 0) {
      this.batchStart = this._state;
      this.batchActions = [];
      this.batchSources = [];
    }
  }

  endBatch(): void {
    if (this.batchDepth === 0) return;
    if (--this.batchDepth > 0) return;
    const start = this.batchStart!;
    this.batchStart = null;
    if (!Object.is(start, this._state)) this.pushHistory(start, this.batchActions, this.batchSources);
    // undo availability changed without a change event; observers re-read
    this.hooks.refresh.call();
    this.checkSolved();
  }

  get batching(): boolean {
    return this.batchDepth > 0;
  }

  private endAllBatches(): void {
    while (this.batchDepth > 0) this.endBatch();
  }

  /**
   * Run the apply waterfall until it stops changing the state, so one tap's output can trigger
   * another (a filled hidden single exposing a naked single). Each round sees the previous
   * round's input as `prev`, so diff-based taps react to what the last round changed.
   */
  private applyToFixpoint(
    start: S, prev: S, action: A | null,
    reduce: (s: S, a: A) => S, note: (src: Source, before: S, after: S) => void,
    source: Source | undefined, owner?: string,
  ): S {
    let before = prev;
    let cur = start;
    for (let round = 0; round < APPLY_ROUNDS; round++) {
      const out = this.hooks.apply.call(cur, { session: this, puzzle: this.puzzle, prev: before, action, reduce, note, source }, owner);
      if (Object.is(out, cur)) return cur;
      before = cur;
      cur = out;
    }
    console.warn(`[games] apply taps still changing state after ${APPLY_ROUNDS} rounds`);
    return cur;
  }

  private emitFx(prev: S, cause: ChangeCause, source: Source | undefined, notes: readonly Note<S>[]): void {
    if (this.hooks.fx.size === 0) return;
    if (cause === "undo" || cause === "redo") {
      this.hooks.fx.call({ kind: cause });
      return;
    }
    if (source?.kind === "system" && source.reason === "restart") this.hooks.fx.call({ kind: "restart" });
    const stepFx = (src: Source, before: S, after: S) => {
      if (src.kind !== "technique") return;
      this.hooks.fx.call({ kind: "step", technique: src.technique, name: src.name, focus: src.step.focus, auto: src.auto, prev: before, state: after });
    };
    if (source) {
      if (source.kind === "technique") stepFx(source, prev, this._state);
      else this.hooks.fx.call({ kind: "change", source, prev, state: this._state });
    }
    for (const n of notes) stepFx(n.source, n.before, n.after);
  }

  private commit(prev: S, next: S, actions: A[], source: Source): void {
    this.pushHistory(prev, actions, [source]);
    this._state = next;
    this.emit(prev, actions, "action", true, source);
  }

  private pushHistory(prev: S, actions: A[], sources: Source[] = []): void {
    this.past.push({ state: prev, actions, sources });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  private emit(prev: S, actions: readonly A[], cause: ChangeCause, checkSolved: boolean, source?: Source, notes: readonly Note<S>[] = []): void {
    this._activeHint = null;
    this.hooks.change.call({ prev, state: this._state, actions, cause, source, notes });
    this.emitFx(prev, cause, source, notes);
    if (checkSolved) this.checkSolved();
  }

  /** Fire `solved` if the current state is solved and it hasn't fired yet. Safe to call any time. */
  checkSolved(): void {
    if (this.batchDepth > 0 || this._solvedAtMs !== null) return;
    if (!this.def.isSolved(this.puzzle, this._state)) return;
    this._solvedAtMs = this.elapsedMs();
    this.runningSince = null;
    this.elapsedBase = this._solvedAtMs;
    this.hooks.solved.call({ elapsedMs: this._solvedAtMs });
    this.hooks.fx.call({ kind: "solved", elapsedMs: this._solvedAtMs });
  }

  /** Number of undo steps available; changes exactly when history is pushed or popped. */
  get depth(): number {
    return this.past.length;
  }

  get canUndo(): boolean {
    return this.past.length > 0 && this.batchDepth === 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0 && this.batchDepth === 0;
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const entry = this.past.pop()!;
    const prev = this._state;
    this.future.push({ state: prev, actions: entry.actions, sources: entry.sources });
    this._state = entry.state;
    this.emit(prev, [], "undo", false);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const entry = this.future.pop()!;
    const prev = this._state;
    this.past.push({ state: prev, actions: entry.actions, sources: entry.sources });
    this._state = entry.state;
    this.emit(prev, [], "redo", true);
    return true;
  }

  /**
   * Back to the initial state as one undoable step. Also clears the solved mark and zeroes the
   * timer so a replay is timed from scratch; undoing a restart restores the board only.
   */
  restart(): void {
    this.endAllBatches();
    const wasTiming = this.runningSince !== null || this._solvedAtMs !== null;
    this._solvedAtMs = null;
    this.elapsedBase = 0;
    this.runningSince = wasTiming ? performance.now() : null;
    const fresh = this.settled(this.def.init(this.puzzle));
    const notes = this.pendingNotes;
    this.pendingNotes = [];
    const prev = this._state;
    if (Object.is(fresh, prev)) return;
    this.pushHistory(prev, [], [{ kind: "system", reason: "restart" }, ...notes.map((n) => n.source)]);
    this._state = fresh;
    this.emit(prev, [], "action", false, { kind: "system", reason: "restart" }, notes);
  }

  private settled(state: S, owner?: string): S {
    const reduce = (s: S, a: A) => this.def.reduce(this.puzzle, s, a);
    const notes: Note<S>[] = [];
    const note = (src: Source, before: S, after: S) => { notes.push({ source: src, before, after }); };
    const out = this.applyToFixpoint(state, state, null, reduce, note, undefined, owner);
    this.pendingNotes = notes;
    return out;
  }

  /**
   * Run every apply tap against the current state with no action, so assists that were just
   * switched on (or present when the board opened) take effect without waiting for a move.
   * `record` makes the change its own undo step; otherwise it is folded into the current state
   * with no history entry. With `owner`, only that owner's taps run, so switching one assist on
   * never re-applies another (e.g. refilling a cell the player erased).
   */
  settle(record: boolean, owner?: string): boolean {
    if (this.batchDepth > 0) return false;
    const prev = this._state;
    const next = this.settled(prev, owner);
    const notes = this.pendingNotes;
    this.pendingNotes = [];
    if (Object.is(next, prev)) return false;
    const source: Source = { kind: "system", reason: "settle" };
    if (record) this.pushHistory(prev, [], [source, ...notes.map((n) => n.source)]);
    this._state = next;
    this.emit(prev, [], record ? "action" : "restore", true, source, notes);
    return true;
  }

  /** Replace progress wholesale (e.g. reveal solution) as one undoable step. */
  replaceState(next: S, source: Source = { kind: "system", reason: "replace" }): void {
    const prev = this._state;
    if (Object.is(next, prev)) return;
    this.commit(prev, next, [], source);
  }

  setInteraction(next: I | ((prev: I) => I)): void {
    const prev = this._interaction;
    const value = typeof next === "function" ? (next as (p: I) => I)(prev) : next;
    if (Object.is(value, prev)) return;
    this._interaction = value;
    this.hooks.interaction.call({ prev, interaction: value });
  }

  /** Annotations for the current (state, interaction), memoized. */
  derived(): Derived {
    const c = this.derivedCache;
    if (c && c.state === this._state && c.interaction === this._interaction && c.version === this.deriveVersion) {
      return c.value;
    }
    const value = this.hooks.derive.call({}, { puzzle: this.puzzle, state: this._state, interaction: this._interaction });
    this.derivedCache = { state: this._state, interaction: this._interaction, version: this.deriveVersion, value };
    return value;
  }

  /** Call when something derive taps depend on (other than state/interaction) changes. */
  invalidateDerived(): void {
    this.deriveVersion++;
    this.hooks.refresh.call();
  }

  hint(): Hint<A> | null {
    const ctx = { puzzle: this.puzzle, state: this._state, interaction: this._interaction };
    return this.hooks.hint.call(ctx) ?? this.def.hint?.(this.puzzle, this._state) ?? null;
  }

  /** Hint the player asked for; cleared by the next state change. Views highlight `focus`. */
  get activeHint(): Hint<A> | null {
    return this._activeHint;
  }

  /** Show `hint` (or the next hint) until the next state change. */
  showHint(hint: Hint<A> | null = this.hint()): Hint<A> | null {
    this._activeHint = hint;
    this.invalidateDerived();
    return this._activeHint;
  }

  /** Undo steps oldest first (`past`), and redo steps nearest first (`future`). */
  timeline(): { past: TimelineEntry<A>[]; future: TimelineEntry<A>[] } {
    const view = (e: HistoryEntry<S, A>): TimelineEntry<A> => ({ actions: e.actions, sources: e.sources ?? [] });
    return { past: this.past.map(view), future: [...this.future].reverse().map(view) };
  }

  /** Undo or redo until `depth` undo steps remain. */
  jumpTo(depth: number): void {
    while (this.past.length > depth && this.undo()) { /* step back */ }
    while (this.past.length < depth && this.redo()) { /* step forward */ }
  }

  /** Patch from the initial state to the current state. */
  exportState(): Patch | null {
    return diff(this.def.init(this.puzzle), this._state);
  }

  /** Every undo step up to now, as exact state patches with their sources. */
  exportHistory(): SharedHistory {
    const states = [...this.past.map((e) => e.state), this._state];
    const start = diff(this.def.init(this.puzzle), states[0]);
    const steps = this.past.map((e, i) => ({ p: diff(states[i], states[i + 1]), s: (e.sources ?? []).map(slim) }));
    return { start, steps };
  }

  /** A fresh session at a shared position: either just a state, or a full undoable history. */
  static fromShared(def: AnyPuzzleDef, puzzle: unknown, origin: Origin, shared: { state?: Patch | null; history?: SharedHistory }): Session<any, any, any, any> {
    const init = def.init(puzzle);
    if (shared.history) {
      let cur = applyPatch(init, shared.history.start);
      const past: HistoryEntry<unknown, Action>[] = [];
      for (const st of shared.history.steps) {
        past.push({ state: cur, actions: [], sources: st.s });
        cur = applyPatch(cur, st.p);
      }
      const s = new Session(def, puzzle, origin, { state: cur });
      s.past = past;
      return s;
    }
    return new Session(def, puzzle, origin, { state: applyPatch(init, shared.state ?? null) });
  }

  /** History actions from the start, oldest first (for replays / analysis). */
  actionLog(): A[] {
    return this.past.flatMap((e) => e.actions);
  }

  // --- timer ---

  elapsedMs(): number {
    return this.elapsedBase + (this.runningSince === null ? 0 : performance.now() - this.runningSince);
  }

  /** Paused by the player; belongs to this game and is saved with it. */
  get paused(): boolean {
    return this._paused;
  }

  setPaused(paused: boolean): void {
    if (this._solvedAtMs !== null) paused = false;
    this._paused = paused;
    if (paused) this.pause();
    else this.resume();
    this.hooks.refresh.call();
  }

  get running(): boolean {
    return this.runningSince !== null;
  }

  resume(): void {
    if (this.runningSince === null && this._solvedAtMs === null) this.runningSince = performance.now();
  }

  pause(): void {
    if (this.runningSince === null) return;
    this.elapsedBase = this.elapsedMs();
    this.runningSince = null;
  }

  // --- persistence ---

  snapshot(): Snapshot {
    const trim = (h: HistoryEntry<S, A>[]) => h.slice(-SNAPSHOT_HISTORY_LIMIT);
    return {
      v: 1,
      puzzleId: this.def.id,
      puzzle: this.puzzle,
      state: this._state,
      interaction: this._interaction,
      origin: this.origin,
      elapsedMs: this.elapsedMs(),
      solvedAtMs: this._solvedAtMs,
      paused: this._paused,
      past: trim(this.past),
      future: trim(this.future),
    };
  }

  static restore(def: AnyPuzzleDef, snap: Snapshot): Session<any, any, any, any> {
    const s = new Session(def, snap.puzzle, snap.origin, {
      state: snap.state,
      interaction: snap.interaction ?? def.initInteraction?.(snap.puzzle),
      elapsedMs: snap.elapsedMs,
      solvedAtMs: snap.solvedAtMs,
    });
    s._paused = !!snap.paused && snap.solvedAtMs === null;
    s.past = snap.past as HistoryEntry<unknown, Action>[];
    s.future = snap.future as HistoryEntry<unknown, Action>[];
    return s;
  }
}
