import type { Rng } from "./rng";
import type { Schema, Values } from "./schema";
import type { Session } from "./session";

/**
 * Contracts shared by puzzles, plugins, views and mods.
 *
 * Data contract: puzzles (Pz), progress states (S), interaction states (I) and actions (A) are
 * plain JSON-serializable data and are treated as immutable. Reducers return a new object for
 * any change and the *same* object for a no-op; the session relies on that identity.
 */

export interface Action {
  type: string;
}

export interface GenerateContext {
  signal: AbortSignal;
  /** Await occasionally in long loops; resolves immediately unless the frame budget is spent. Throws if aborted. */
  yield(): Promise<void>;
}

export interface Format<Pz> {
  id: string;
  label: string;
  /** Cheap sniff used to auto-pick a format for pasted text. */
  detect?(text: string): boolean;
  /** Throws an Error whose message is shown to the player. */
  parse(text: string): Pz;
  serialize?(puzzle: Pz): string;
}

export interface Hint<A extends Action = Action> {
  message: string;
  /** Puzzle-specific highlight data understood by that puzzle's views. */
  focus?: unknown;
  /** Applying this action carries out the hint. */
  action?: A;
}

export interface Rating {
  label: string;
  /** Higher = harder. Comparable only within one puzzle type. */
  score: number;
}

export interface Preset<P extends Schema> {
  label: string;
  params: Partial<Values<P>>;
}

export interface PuzzleDef<Pz = unknown, S = unknown, A extends Action = Action, I = unknown, P extends Schema = Schema> {
  id: string;
  name: string;
  description?: string;
  /**
   * Bump whenever generate() would produce a different puzzle for the same (params, seed).
   * Share links carry it so stale links can be detected instead of silently differing.
   */
  generatorVersion: number;
  params: P;
  presets?: readonly Preset<P>[];
  /** Deterministic: identical (params, rng seed) must yield an identical puzzle. */
  generate(params: Values<P>, rng: Rng, ctx: GenerateContext): Pz | Promise<Pz>;
  /** First format with serialize() is used for share links of imported puzzles. */
  formats: readonly Format<Pz>[];
  init(puzzle: Pz): S;
  reduce(puzzle: Pz, state: S, action: A): S;
  isSolved(puzzle: Pz, state: S): boolean;
  initInteraction?(puzzle: Pz): I;
  /** Full solution state, or null if none/unknown. */
  solve?(puzzle: Pz): S | null;
  hint?(puzzle: Pz, state: S): Hint<A> | null;
  rate?(puzzle: Pz): Rating | null;
  /** Short label for the current puzzle (e.g. "9×9 killer"), shown in the header. */
  describe?(puzzle: Pz): string;
}

export interface PluginApi<Pz, S, A extends Action, I> {
  session: Session<Pz, S, A, I>;
  settings: Readonly<Record<string, unknown>>;
  /** Pass as `{ owner }` to every tap so teardown is automatic. */
  owner: string;
}

export interface PluginUiApi<Pz, S, A extends Action, I> extends PluginApi<Pz, S, A, I> {
  view: ViewHandle;
  root: HTMLElement;
}

export type Teardown = void | (() => void);

/** Keybinding schema entries, shape-compatible with the `keybinds` package. */
export type BindingSchema = Record<string, {
  label: string;
  category?: string;
  description?: string;
  keys?: string[];
  mouse?: string[];
  hidden?: boolean;
}>;

export type CommandHandler = (ctx: Record<string, unknown>, event?: Event) => unknown;

/**
 * Headless behaviour layered onto a session (assists, checks, scoring, …).
 * Re-setup (teardown then setup) happens whenever its settings change, so setup may treat
 * settings as constant.
 */
export interface Plugin<Pz = any, S = any, A extends Action = any, I = any> {
  id: string;
  name: string;
  description?: string;
  /** Grouping label in the settings UI. */
  category?: string;
  /** Puzzle ids this applies to, or "*". */
  appliesTo: readonly string[] | "*";
  enabledByDefault?: boolean;
  settings?: Schema;
  setup?(api: PluginApi<Pz, S, A, I>): Teardown;
  /** DOM-side extension, run after the view mounts. */
  ui?(api: PluginUiApi<Pz, S, A, I>): Teardown;
  bindings?: BindingSchema;
  /** Handlers for `bindings`, resolved against the live session. */
  handlers?(api: PluginApi<Pz, S, A, I>): Record<string, CommandHandler>;
}

export interface ViewContext<Pz, S, A extends Action, I> {
  session: Session<Pz, S, A, I>;
  settings: Readonly<Record<string, unknown>>;
  /** Persistent per-view scratch storage (namespaced). */
  storage: KeyValue;
}

export interface ViewHandle {
  destroy(): void;
  /** Handlers for the view's `bindings`. */
  handlers?: Record<string, CommandHandler>;
  /** Hook points the view exposes to plugin ui() extensions. */
  hooks?: object;
}

/** The only layer that touches the DOM. Remounted when its settings change. */
export interface View<Pz = any, S = any, A extends Action = any, I = any> {
  id: string;
  name: string;
  /** Puzzle id this renders. */
  puzzle: string;
  settings?: Schema;
  bindings?: BindingSchema;
  mount(root: HTMLElement, ctx: ViewContext<Pz, S, A, I>): ViewHandle;
}

export interface KeyValue {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export type AnyPuzzleDef = PuzzleDef<any, any, any, any, any>;
