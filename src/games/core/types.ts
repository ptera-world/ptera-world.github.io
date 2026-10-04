import type { CommandId } from "./commands";
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

/**
 * Names a registered puzzle. Built-in code passes the def itself; matching is by `id`, so a mod
 * that re-registers the id (or wraps it through resolvePuzzle) still matches.
 */
export interface PuzzleRef {
  readonly id: string;
}

/**
 * Feature names, declared by the packs that provide or require them:
 * `declare module "…/core/types" { interface FeatureNames { boxes: true } }`.
 */
export interface FeatureNames {}
export type Feature = keyof FeatureNames & string;

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
  /** Dispatching these in order (one undo step) carries out the hint. */
  actions?: A[];
  /** Technique id this hint came from, if any. */
  technique?: string;
  /** 1 = nudge (where to look), 2 = full explanation. Views may highlight less at level 1. */
  level?: number;
  /** The same hint with more detail, shown if the player asks again. */
  more?: Hint<A>;
}

/** One application of a technique: what it found, where, and the moves that carry it out. */
export interface Step<A extends Action = Action> {
  /** Full explanation of the deduction. */
  message: string;
  /** Where-to-look text, without giving the answer away. */
  nudge?: string;
  /** Puzzle-specific highlight for the full explanation. */
  focus?: unknown;
  /** Coarser highlight for the nudge. Falls back to none. */
  nudgeFocus?: unknown;
  /** Applying all of these (in order) is the deduction. Must be non-empty and change the state. */
  actions: A[];
}

/**
 * A named deduction pattern. Everything a player can do with a technique (get it as a hint,
 * auto-apply it, press it as a button, read about it, practice it, rate puzzles by it) is
 * derived from this one definition.
 */
export interface Technique<Pz = any, S = any, A extends Action = any> {
  /** Globally unique; convention "<puzzle>.<name>". */
  id: string;
  name: string;
  puzzles: readonly PuzzleRef[];
  /** Features the loaded puzzle must have (see PuzzleDef.features), e.g. ["cages"]. */
  requires?: readonly Feature[];
  /** Ordering and difficulty: lower is easier and is tried first. Comparable within one puzzle. */
  level: number;
  /** Plain-language explanation for the guide. */
  description: string;
  /** Color used for this technique's highlights, flashes and labels. Default: picked per technique. */
  color?: string;
  /** First instance in the state, or null. Must be pure and deterministic. */
  find(puzzle: Pz, state: S): Step<A> | null;
  /**
   * An instance at the given target (see ViewHandle.target), or null. Lets a technique be used as
   * a skill aimed at one line, cell or region instead of anywhere on the board.
   */
  findAt?(puzzle: Pz, state: S, target: unknown): Step<A> | null;
  defaults?: { hints?: boolean; auto?: boolean };
  /** false: no practice boards for this technique (e.g. it needs a game history to arise). */
  practice?: false | {
    /** Generation params used to look for practice positions (e.g. a harder difficulty). */
    params?: Record<string, unknown>;
    /** Turn a found position into what the player sees (e.g. fill in candidate marks). */
    prepare?(puzzle: Pz, state: S): S;
  };
}

/**
 * Anything the player can do. One definition yields its keybinding (rebindable), its command
 * palette entry, context-menu entry, cheatsheet line and any button showing it.
 */
export interface CommandDef {
  /** Unique within the page; convention "<owner>.<name>". Also the keybinding storage key. */
  id: string;
  label: string;
  category?: string;
  description?: string;
  /** Default key bindings, in keybinds syntax (e.g. "$mod+z", "shift+slash"). */
  keys?: string[];
  /** Default mouse bindings, in keybinds syntax. */
  mouse?: string[];
  /** Context-menu tags this command appears under. */
  menu?: string | string[];
  /** Left out of the palette and cheatsheet (still bindable). */
  hidden?: boolean;
  /** Command is available only when this returns true for the shell context. */
  when?(ctx: Record<string, unknown>): boolean;
  /** For toggles: current on/off, shown as a checkmark / pressed state. */
  checked?(): boolean;
  /** Typing into an input does not block this command. */
  captureInput?: boolean;
  /** Loses progress: shown in the danger color everywhere. A function is re-checked whenever it is shown. */
  danger?: boolean | (() => boolean);
  /** Question to confirm first, or null to skip. Asked however the command is triggered (subject to the player's confirmation setting). */
  confirm?(): string | null;
  run(ctx: Record<string, unknown>, event?: Event): unknown;
}

/** "overlay" sits over the board (results, tutorials); its size never affects layout. */
export type SlotId = "top" | "side" | "bottom" | "panel" | "overlay" | "off";

export interface WidgetContext<Pz = any, S = any, A extends Action = any, I = any, P extends Schema = {}> {
  session: Session<Pz, S, A, I>;
  settings: Readonly<Values<P>>;
  /** Run a registered command (returns false if unknown or unavailable). */
  run(commandId: CommandId): boolean;
  /** All currently registered commands. */
  commands(): CommandDef[];
  /** Mounted view, if any (for view-level hooks). */
  view: ViewHandle | null;
  /** Slot the widget is mounted in, so it can adapt (e.g. a tab vs a strip). */
  slot: SlotId;
  /** Pass as `{ owner }` when tapping session or view hooks; they are removed on unmount. */
  owner: string;
}

/**
 * A movable piece of UI. The player decides which slot each widget lives in (or hides it);
 * defaults come from here. Widgets must keep a stable height in "top" so the board never moves.
 */
export interface WidgetDef<Pz = any, S = any, A extends Action = any, I = any, P extends Schema = {}> {
  id: string;
  name: string;
  description?: string;
  puzzles: readonly PuzzleRef[] | "*";
  /** Features the loaded puzzle must have (see PuzzleDef.features). */
  requires?: readonly Feature[];
  defaultSlot: SlotId;
  /** Position within a slot; lower first. */
  order?: number;
  settings?: P;
  mount(el: HTMLElement, ctx: WidgetContext<Pz, S, A, I, P>): Teardown;
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
  /**
   * The game is over without being solved (e.g. a mine was opened). Undo still works. Return
   * `{ focus }` instead of true to say where (highlight data, as in Hint.focus), so effects can
   * point at it.
   */
  isLost?(puzzle: Pz, state: S): boolean | { focus?: unknown };
  initInteraction?(puzzle: Pz): I;
  /** Full solution state, or null if none/unknown. */
  solve?(puzzle: Pz): S | null;
  /** Fallback hint when no technique applies (e.g. to point out a mistake). */
  hint?(puzzle: Pz, state: S): Hint<A> | null;
  /**
   * True for player moves that undo progress (erase, unflag). Auto-applied techniques skip the
   * dispatch, so they never immediately redo what the player just removed.
   */
  isRetraction?(action: A): boolean;
  /** The rules in plain language, for the guide. */
  rules?(puzzle: Pz): string[];
  /**
   * What this particular puzzle has (e.g. "boxes", "cages", "candidates"). Plugins, widgets and
   * techniques that require a feature only appear when the loaded puzzle has it, so engines
   * shared between puzzles never leak settings that make no sense for one of them.
   */
  features?(puzzle: Pz): readonly Feature[];
  /** Catalogue labels (genre, mechanics), used to group and filter the game list. */
  tags?: readonly string[];
  /** Other names people know it by (e.g. "nonogram", "picross"); searchable on the game list. */
  aliases?: readonly string[];
  rate?(puzzle: Pz): Rating | null;
  /**
   * One move in words, for history ("C5: 7", "flag E1", "turn B3 clockwise"). Gets the states
   * before and after so it can describe what actually changed.
   */
  describeAction?(puzzle: Pz, action: A, before: S, after: S): string;
  /** Short label for the current puzzle (e.g. "9×9 killer"), shown in the header. */
  describe?(puzzle: Pz): string;
}

export interface PluginApi<Pz, S, A extends Action, I, P extends Schema = {}> {
  session: Session<Pz, S, A, I>;
  settings: Readonly<Values<P>>;
  /** Pass as `{ owner }` to every tap so teardown is automatic. */
  owner: string;
}

export interface PluginUiApi<Pz, S, A extends Action, I, P extends Schema = {}> extends PluginApi<Pz, S, A, I, P> {
  view: ViewHandle;
  /** Element the view is mounted in. */
  root: HTMLElement;
  /** The frontend's board area around `root` (`root` itself if the frontend has none). */
  frame: HTMLElement;
}

export type Teardown = void | (() => void);

/**
 * Headless behavior layered onto a session (assists, checks, scoring, …).
 * Re-setup (teardown then setup) happens whenever its settings change, so setup may treat
 * settings as constant.
 */
export interface Plugin<Pz = any, S = any, A extends Action = any, I = any, P extends Schema = {}> {
  id: string;
  name: string;
  description?: string;
  /** Grouping label in the settings UI. */
  category?: string;
  appliesTo: readonly PuzzleRef[] | "*";
  /** Features the loaded puzzle must have (see PuzzleDef.features), e.g. ["boxes"] or ["candidates"]. */
  requires?: readonly Feature[];
  enabledByDefault?: boolean;
  settings?: P;
  setup?(api: PluginApi<Pz, S, A, I, P>): Teardown;
  /** DOM-side extension, run after the view mounts. */
  ui?(api: PluginUiApi<Pz, S, A, I, P>): Teardown;
  commands?(api: PluginApi<Pz, S, A, I, P>): CommandDef[];
}

export interface ViewContext<Pz, S, A extends Action, I, P extends Schema = {}> {
  session: Session<Pz, S, A, I>;
  settings: Readonly<Values<P>>;
  /** Persistent per-view scratch storage (namespaced). */
  storage: KeyValue;
}

export interface ViewHandle {
  destroy(): void;
  commands?: CommandDef[];
  /** Hook points the view exposes to plugin ui() extensions. */
  hooks?: object;
  /** Board width / height, used to size the board as large as the layout allows. Default 1. */
  aspect?: number;
  /**
   * The whole drawn board measured in cells (outside clues and labels included), so the frontend
   * can keep a cell at least a minimum size by zooming/scrolling instead of shrinking it.
   */
  cells?: { cols: number; rows: number };
  /**
   * What the player is pointing at (cursor cell, hovered line, selection), in the shape the
   * puzzle's techniques accept as a target. Used to aim techniques at one place.
   */
  target?(): unknown;
  /** Draw `state` as a see-through preview over the board (null clears it). Optional; frontends fall back to highlighting. */
  preview?(state: unknown | null): void;
  /**
   * Gestures the board uses itself. The shell then never opens its board menu on them (touch
   * hold is otherwise the menu), and tells players to use the commands list instead.
   */
  gestures?: { secondaryClick?: boolean; hold?: boolean };
  /** Extra keys merged into the shell context for `when` conditions. */
  context?(): Record<string, unknown>;
  /** Screen rects (client coordinates) of the elements a focus refers to. Lets game-agnostic effects target the board. */
  locate?(focus: unknown): DOMRect[];
  /** Screen rects of the elements that differ between two states. */
  locateChange?(prev: unknown, next: unknown): DOMRect[];
}

/** The only layer that touches the DOM. Remounted when its settings change. */
export interface View<Pz = any, S = any, A extends Action = any, I = any, P extends Schema = {}> {
  id: string;
  name: string;
  /** Puzzle this renders. */
  puzzle: PuzzleRef;
  settings?: P;
  /**
   * Pointer gestures handled directly on the board (not bindable commands), for the how-to-play
   * card and tooltips, e.g. { how: "click a cell", what: "press it" }. Mouse and touch both.
   */
  controls?: readonly { how: string; what: string }[];
  /**
   * What the board's colors and marks mean, for the how-to-play card. `sample` is inline SVG
   * (or HTML) drawn with the same theme tokens the board uses, so it matches the current theme.
   */
  legend?: readonly { sample: string; meaning: string }[] | ((puzzle: Pz) => readonly { sample: string; meaning: string }[]);
  mount(root: HTMLElement, ctx: ViewContext<Pz, S, A, I, P>): ViewHandle;
}

export interface KeyValue {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export type AnyPuzzleDef = PuzzleDef<any, any, any, any, any>;
export type AnyPlugin = Plugin<any, any, any, any, Schema>;
export type AnyView = View<any, any, any, any, Schema>;
export type AnyWidget = WidgetDef<any, any, any, any, Schema>;

/**
 * The page itself (chrome, panels, how games are presented). Exactly one runs: the one the player
 * chose, else the last registered. Comes from a pack like everything else.
 */
export interface Frontend {
  id: string;
  name: string;
  mount(root: HTMLElement): void | Promise<void>;
}

/** A look: values for the CSS custom properties every view and widget styles with. */
export interface Theme {
  id: string;
  name: string;
  scheme: "dark" | "light";
  /** Custom property name (without "--") to value. Unset tokens keep the base stylesheet value. */
  tokens: Record<string, string>;
  /** Extra stylesheet applied with the theme (e.g. to restyle a specific view). */
  css?: string;
  /**
   * Named graphics views draw with, overriding their defaults: SVG markup or an image URL.
   * Ids are namespaced by the view that reads them, e.g. "pattern.empty-mark".
   */
  assets?: Record<string, string>;
}
