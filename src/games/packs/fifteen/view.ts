import type { AnyView, View } from "../../core/types";
import { fifteen, movesOf, type FifteenAction, type FifteenInteraction, type FifteenPuzzle, type FifteenState } from "./logic";
import { shiftView } from "./shift-view";
import { slideView } from "./slide-view";
import { turnView } from "./turn-view";
import { viewSettings } from "./view-settings";

const BY_MOVES = { slide: slideView, shift: shiftView, turn: turnView } as unknown as Record<string, AnyView>;
const viewOf = (p: FifteenPuzzle): AnyView => BY_MOVES[movesOf(p)]!;
const list = <T>(x: readonly T[] | ((p: FifteenPuzzle) => readonly T[]) | undefined, p: FifteenPuzzle): readonly T[] =>
  typeof x === "function" ? x(p) : x ?? [];

/** Each kind of move has its own board; this picks the one the loaded puzzle uses. */
export const fifteenView: View<FifteenPuzzle, FifteenState, FifteenAction, FifteenInteraction, typeof viewSettings> = {
  id: "fifteen.svg",
  name: "tiles",
  puzzle: fifteen,
  settings: viewSettings,
  controls: (p) => list(viewOf(p).controls, p),
  legend: (p) => list(viewOf(p).legend, p),
  mount: (root, ctx) => viewOf(ctx.session.puzzle).mount(root, ctx),
};
