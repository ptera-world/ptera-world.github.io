import type { Registry } from "../core/registry";
import { register as bridges } from "./bridges";
import { register as flip } from "./flip";
import { register as lightup } from "./lightup";
import { register as loopy } from "./loopy";
import { register as mines } from "./mines";
import { register as net } from "./net";
import { register as pattern } from "./pattern";
import { register as sudoku } from "./sudoku";

/** Built-in packs, in index display order. Each pack owns its own directory. */
export function registerBuiltins(registry: Registry): void {
  for (const pack of [sudoku, mines, lightup, pattern, net, loopy, bridges, flip]) pack(registry);
}
