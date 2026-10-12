import { scoreWidget } from "../../lib/cards/score";
import { pyramid, type PyramidAction, type PyramidInteraction, type PyramidPuzzle, type PyramidState } from "./logic";

export const pyramidScore = scoreWidget<PyramidPuzzle, PyramidState, PyramidAction, PyramidInteraction>({
  id: "pyramid.score",
  name: "score",
  description: "points for pairs, kings and cleared rows",
  puzzles: [pyramid],
  read: (_p, s) => `score ${s.score}`,
});
