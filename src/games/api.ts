/**
 * Everything a pack may use. Packs are ES modules whose default export is
 * `(games: GamesApi) => void | Promise<void>`; this object is also at `globalThis.pteraGames`.
 */
import * as board from "./core/board";
import * as commands from "./core/commands";
import * as dom from "./core/dom";
import { fx } from "./core/fx";
import { generate } from "./core/generate";
import { HOLD_MS } from "./core/gestures";
import * as hooks from "./core/hooks";
import * as anim from "./core/anim";
import * as i18n from "./core/i18n";
import * as mods from "./core/mods";
import * as patch from "./core/patch";
import * as plugins from "./core/plugins";
import { registry } from "./core/registry";
import * as rng from "./core/rng";
import * as schema from "./core/schema";
import { Session } from "./core/session";
import { namespace } from "./core/storage";
import * as techniques from "./core/techniques";
import * as themes from "./core/themes";

export const api = {
  registry,
  Session,
  hooks,
  rng,
  schema,
  storage: namespace,
  dom,
  commands,
  techniques,
  plugins,
  generate,
  patch,
  /** Effect helpers (flash, pop, burst, shake). */
  fx,
  /** How themes apply: `asset("pattern.empty-mark", defaultSvg)` for themed graphics, plus the theme and color settings. */
  look: themes,
  /** Cell names for hints, and which edges the player wants labelled. */
  board,
  /** Frame animation for views (also bundleable: core/anim). */
  anim,
  /** Locale and translations: `t(ns, key, fallback, params)`, `register(ns, locale, messages)`. */
  i18n,
  /** Touch hold duration (ms) at which a hold counts as a hold. */
  HOLD_MS,
  /** Pack management, and what this page load loaded (filled in by the loader before any frontend mounts). */
  packs: { ...mods, loaded: [] as mods.LoadedPack[], sources: [] as mods.ModLoadResult[] },
  /** Loaded with ?safe: only the built-in packs, all on, latest versions; the player's pack settings are left alone. */
  safe: false,
  /** Whatever the running frontend wants to expose (e.g. the shell object). */
  shell: null as unknown,
};

export type GamesApi = typeof api;
export type * from "./core/types";
