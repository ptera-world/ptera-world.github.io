import { Bail, Event, Waterfall } from "./hooks";
import type { Action, AnyPuzzleDef, Hint, PuzzleDef } from "./types";

export type Origin =
  | { kind: "generated"; seed: string; params: Record<string, unknown>; generatorVersion: number }
  | { kind: "imported"; format?: string; source?: string };

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
}

export interface DeriveCtx<Pz, S, I> {
  puzzle: Pz;
  state: S;
  interaction: I;
}

export interface ChangeCtx<S, A> {
  prev: S;
  state: S;
  /** Actions committed in this step (empty for undo/redo/restore). */
  actions: readonly A[];
  cause: ChangeCause;
}

/** Annotation bag produced by the `derive` hook; keys are conventions between plugins and views. */
export type Derived = Record<string, unknown>;

interface HistoryEntry<S, A> {
  state: S;
  actions: A[];
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
  past: { state: unknown; actions: unknown[] }[];
  future: { state: unknown; actions: unknown[] }[];
}

const HISTORY_LIMIT = 2000;
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
     * Post-reduce: return a further-modified state. Runs once per dispatch (result is one history
     * step) and once per settle pass (action null). Taps should be idempotent: running a tap on
     * its own output must not change it.
     */
    apply: new Waterfall<S, ApplyCtx<Pz, S, A, I>>("apply"),
    /** Build view annotations from current state. Must be pure in (puzzle, state, interaction, settings). */
    derive: new Waterfall<Derived, DeriveCtx<Pz, S, I>>("derive"),
    change: new Event<ChangeCtx<S, A>>("change"),
    interaction: new Event<{ prev: I; interaction: I }>("interaction"),
    solved: new Event<{ elapsedMs: number }>("solved"),
    hint: new Bail<DeriveCtx<Pz, S, I>, Hint<A> | null>("hint"),
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
  private batchActions: A[] = [];
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
  dispatch(action: A): boolean {
    const vetted = this.hooks.action.call(action, { session: this, state: this._state });
    if (vetted === null) return false;
    const prev = this._state;
    const reduce = (s: S, a: A) => this.def.reduce(this.puzzle, s, a);
    let next = reduce(prev, vetted);
    next = this.hooks.apply.call(next, { session: this, puzzle: this.puzzle, prev, action: vetted, reduce });
    if (Object.is(next, prev)) return false;
    if (this.batchDepth > 0) {
      this._state = next;
      this.batchActions.push(vetted);
      this.emit(prev, [vetted], "action", false);
      return true;
    }
    this.commit(prev, next, [vetted]);
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
    }
  }

  endBatch(): void {
    if (this.batchDepth === 0) return;
    if (--this.batchDepth > 0) return;
    const start = this.batchStart!;
    this.batchStart = null;
    if (!Object.is(start, this._state)) this.pushHistory(start, this.batchActions);
    this.checkSolved();
  }

  get batching(): boolean {
    return this.batchDepth > 0;
  }

  private endAllBatches(): void {
    while (this.batchDepth > 0) this.endBatch();
  }

  private commit(prev: S, next: S, actions: A[]): void {
    this.pushHistory(prev, actions);
    this._state = next;
    this.emit(prev, actions, "action", true);
  }

  private pushHistory(prev: S, actions: A[]): void {
    this.past.push({ state: prev, actions });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  private emit(prev: S, actions: readonly A[], cause: ChangeCause, checkSolved: boolean): void {
    this._activeHint = null;
    this.hooks.change.call({ prev, state: this._state, actions, cause });
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
    this.future.push({ state: prev, actions: entry.actions });
    this._state = entry.state;
    this.emit(prev, [], "undo", false);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const entry = this.future.pop()!;
    const prev = this._state;
    this.past.push({ state: prev, actions: entry.actions });
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
    const prev = this._state;
    if (Object.is(fresh, prev)) return;
    this.pushHistory(prev, []);
    this._state = fresh;
    this.emit(prev, [], "action", false);
  }

  private settled(state: S, owner?: string): S {
    const reduce = (s: S, a: A) => this.def.reduce(this.puzzle, s, a);
    return this.hooks.apply.call(state, { session: this, puzzle: this.puzzle, prev: state, action: null, reduce }, owner);
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
    if (Object.is(next, prev)) return false;
    if (record) {
      this.commit(prev, next, []);
    } else {
      this._state = next;
      this.emit(prev, [], "restore", true);
    }
    return true;
  }

  /** Replace progress wholesale (e.g. reveal solution) as one undoable step. */
  replaceState(next: S): void {
    const prev = this._state;
    if (Object.is(next, prev)) return;
    this.commit(prev, next, []);
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

  showHint(): Hint<A> | null {
    this._activeHint = this.hint();
    this.invalidateDerived();
    return this._activeHint;
  }

  /** History actions from the start, oldest first (for replays / analysis). */
  actionLog(): A[] {
    return this.past.flatMap((e) => e.actions);
  }

  // --- timer ---

  elapsedMs(): number {
    return this.elapsedBase + (this.runningSince === null ? 0 : performance.now() - this.runningSince);
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
    s.past = snap.past as HistoryEntry<unknown, Action>[];
    s.future = snap.future as HistoryEntry<unknown, Action>[];
    return s;
  }
}
