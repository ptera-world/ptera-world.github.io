/**
 * Work done by solvers and generators, counted once per innermost repeated step (one constraint
 * run, one search node). Deterministic for given inputs, so a budget on it means the same on a
 * busy machine as on an idle one. Only differences between two reads mean anything.
 */
export const work = { units: 0 };
