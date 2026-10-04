import { constraintTypes } from "../registry";
import { keen, killer, littleKiller } from "./cages";
import { edgeTypes } from "./edges";
import { gridTypes } from "./grid";
import { lineTypes } from "./lines";
import { towers } from "./towers";

export const builtinConstraintTypes = [...gridTypes, killer, keen, littleKiller, ...lineTypes, ...edgeTypes, towers];

for (const t of builtinConstraintTypes) constraintTypes.register(t);
