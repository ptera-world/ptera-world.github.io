import type { Step, Technique } from "../../core/types";
import { cellList, cellName } from "../../lib/grid-kit/names";
import { troubleText, type ZipAction, type ZipFocus, type ZipPuzzle, type ZipState } from "./logic";
import { KIND_LEVEL, analyze, headOf, nextStep, walkOf, type Elimination, type StepKind, type ZipStep } from "./solver";

type ZipTechnique = Technique<ZipPuzzle, ZipState, ZipAction>;

/** The path is still on the unique solution (or there's no unique solution to compare with). */
function onTrack(p: ZipPuzzle, s: ZipState): boolean {
  const a = analyze(p);
  return !(a.count === 1 && a.solution) || s.path.every((c, i) => c === a.solution![i]);
}

function why(p: ZipPuzzle, r: Elimination): string {
  const to = `going to ${cellName(p, r.cell)}`;
  switch (r.why.kind) {
    case "chains": return `${to} leaves cells that can't all be joined up (follow the cells with only two ways in)`;
    case "fails": return `${to} runs into a dead end a few moves later`;
    case "order": return `${to} means ${r.why.num} can't be reached without passing a later number`;
    default: return `${to}: ${troubleText(p, r.why)}`;
  }
}

const reasonCells = (ruled: Elimination[]) => ruled.flatMap((r) => [r.cell, ...(r.why.kind === "dead" ? [r.why.cell] : r.why.kind === "cut" ? r.why.cells : [])]);

function build(p: ZipPuzzle, s: ZipState, st: ZipStep, message: string, nudge: string): Step<ZipAction> {
  const head = s.path[s.path.length - 1]!;
  return {
    message, nudge,
    actions: [{ type: "extend", cells: st.cells }],
    focus: { cells: st.cells.slice(-1), because: [...new Set([...st.because, ...reasonCells(st.ruled)])], route: [head, ...st.cells] } satisfies ZipFocus,
    nudgeFocus: { cells: [], because: [head] } satisfies ZipFocus,
  };
}

function technique(def: Omit<ZipTechnique, "find" | "puzzles" | "level"> & { kind: StepKind }, text: (p: ZipPuzzle, s: ZipState, st: ZipStep) => { message: string; nudge: string }): ZipTechnique {
  const { kind, ...rest } = def;
  return {
    ...rest,
    puzzles: ["zip"],
    level: KIND_LEVEL[kind],
    find(p, s) {
      if (!onTrack(p, s)) return null;
      const st = nextStep(p, walkOf(p, s.path), KIND_LEVEL[kind]);
      if (!st || st.kind !== kind) return null;
      const t = text(p, s, st);
      return build(p, s, st, t.message, t.nudge);
    },
  };
}

const head = (p: ZipPuzzle, s: ZipState) => cellName(p, headOf(walkOf(p, s.path)));
const then = (p: ZipPuzzle, st: ZipStep) => `go to ${cellName(p, st.cells[0]!)}`;

export const onlyWay = technique({
  id: "zip.only-way", name: "only one way", kind: "only-way", practice: { params: { width: 6, height: 6, difficulty: "easy" } },
  description: "when the path's end has just one cell it may step into (the others are walls, the edge, the path itself, or a number out of turn), it goes there.",
}, (p, s, st) => ({
  message: st.cells.length === 1
    ? `from ${head(p, s)} there's only one cell the path can step into: ${cellName(p, st.cells[0]!)}`
    : `from ${head(p, s)} the path has only one way to go for ${st.cells.length} cells, to ${cellName(p, st.cells[st.cells.length - 1]!)}`,
  nudge: `where can the path go from ${head(p, s)}?`,
}));

export const deadEnd = technique({
  id: "zip.dead-end", name: "don't leave a dead end", kind: "dead-end", practice: { params: { width: 6, height: 6, difficulty: "easy" } },
  description: "every cell except the last number needs two ways in: one to enter, one to leave. a cell next to the path's end with only one other way in has to be entered now, or it becomes a dead end.",
}, (p, s, st) => ({
  message: `${cellName(p, st.cells[0]!)} has only one way in besides ${head(p, s)}. if the path doesn't go there now it becomes a dead end, so ${then(p, st)}`,
  nudge: `which cell next to ${head(p, s)} is running out of ways in?`,
}));

export const noSplit = technique({
  id: "zip.no-split", name: "keep it in one piece", kind: "no-split", practice: { params: { width: 6, height: 6, difficulty: "easy" } },
  description: "a move is wrong if it cuts the empty cells into two pieces (the path can only fill one), leaves a cell with too few ways in, or ends the path early. rule those out and see what's left.",
}, (p, s, st) => ({
  message: `${st.ruled.map((r) => why(p, r)).join("; ")}. so ${then(p, st)}`,
  nudge: `which moves from ${head(p, s)} would split the board or strand a cell?`,
}));

export const order = technique({
  id: "zip.order", name: "numbers in order", kind: "order", practice: { params: { width: 7, height: 7, difficulty: "easy" } },
  description: "the path has to reach the next number before any later one. a move that leaves no way to the next number except through a later number is wrong.",
}, (p, s, st) => ({
  message: `${st.ruled.map((r) => why(p, r)).join("; ")}. so ${then(p, st)}`,
  nudge: `how will the path get to ${walkOf(p, s.path).next} from ${head(p, s)}?`,
}));

export const chains = technique({
  id: "zip.chains", name: "two ways in", kind: "chains", practice: { params: { width: 7, height: 7, difficulty: "medium" } },
  description: "any empty cell with only two ways in uses both, which can force whole stretches of path. try each move and follow those forced stretches: if they close a loop, need a cell three times, or reach the last number too early, the move is wrong.",
}, (p, s, st) => ({
  message: `${st.ruled.map((r) => why(p, r)).join("; ")}. so ${then(p, st)}`,
  nudge: `look at the cells with only two ways in near ${head(p, s)}`,
}));

export const trial = technique({
  id: "zip.trial", name: "look ahead", kind: "trial", practice: { params: { width: 7, height: 7, difficulty: "hard" } },
  description: "when nothing simpler settles it, follow each possible move a few steps ahead. every one but one gets stuck.",
}, (p, s, st) => ({
  message: `${st.ruled.map((r) => why(p, r)).join("; ")}. so ${then(p, st)}`,
  nudge: `try each way out of ${head(p, s)}: ${cellList(p, [...st.because, ...st.cells])}`,
}));

export const zipTechniques: ZipTechnique[] = [onlyWay, deadEnd, noSplit, order, chains, trial];
