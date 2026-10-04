/**
 * Everything a mod may use. Mods are ES modules whose default export is
 * `(games: GamesApi) => void | Promise<void>`; this object is also at `globalThis.pteraGames`.
 */
import * as hooks from "./core/hooks";
import { registry } from "./core/registry";
import * as rng from "./core/rng";
import * as schema from "./core/schema";
import { Session } from "./core/session";
import { namespace } from "./core/storage";
import * as commands from "./core/commands";
import * as patch from "./core/patch";
import * as techniques from "./core/techniques";
import * as dom from "./ui/dom";
import { fx } from "./ui/fx";
import type { Shell } from "./ui/shell";

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
  patch,
  /** Effect helpers (flash, pop, burst, shake) for mods building their own effects. */
  fx,
  /** Set once the shell boots; null while mods are loading. */
  shell: null as Shell | null,
};

export type GamesApi = typeof api;
export type * from "./core/types";
