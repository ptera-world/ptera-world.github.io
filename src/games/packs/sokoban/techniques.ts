import { hintFrom } from "../../core/define";
import type { Hint, Step } from "../../core/types";
import { sokoban, cellName, pushText, solveFrom, type SokoAction, type SokoFocus, type SokoPuzzle, type SokoState } from "./logic";
import { stepFrom, type Push } from "./solver";

const left = (n: number) => (n === 1 ? "that's the last push" : `${n} pushes get every box home`);

/** Where the box moved by plan[0] ends up after the whole plan. */
function destination(p: SokoPuzzle, plan: readonly Push[]): number {
  let at = plan[0]!.box;
  for (const m of plan) if (m.box === at) at = stepFrom(p, m.box, m.dir);
  return at;
}

function step(plan: Push[], count: number, message: string, nudge: string, goal: number): Step<SokoAction> {
  const run = plan.slice(0, count);
  return {
    message, nudge,
    actions: run.map((m) => ({ type: "push", box: m.box, dir: m.dir })),
    focus: { boxes: [run[0]!.box], cells: [goal], pushes: run } satisfies SokoFocus,
    nudgeFocus: { boxes: [run[0]!.box] } satisfies SokoFocus,
  };
}

function pushHomeStep(p: SokoPuzzle, s: SokoState): Step<SokoAction> | null {
  const plan = solveFrom(p, s).pushes;
  if (!plan?.length) return null;
  const first = plan[0]!;
  let n = 1, at = stepFrom(p, first.box, first.dir);
  while (n < plan.length && plan[n]!.box === at && plan[n]!.dir === first.dir) {
    at = stepFrom(p, at, first.dir);
    n++;
  }
  if (!p.goals.includes(at)) return null;
  return step(plan, n, `${pushText(p, first)}${n > 1 ? ` ${n} times` : ""}, straight onto the goal at ${cellName(p, at)} (${left(plan.length)}).`,
    `which box can go straight onto a goal?`, at);
}

function nextPushStep(p: SokoPuzzle, s: SokoState): Step<SokoAction> | null {
  const plan = solveFrom(p, s).pushes;
  if (!plan?.length) return null;
  const goal = destination(p, plan);
  return step(plan, 1, `${pushText(p, plan[0]!)}: that box is headed for the goal at ${cellName(p, goal)} (${left(plan.length)}).`,
    `look at the box at ${cellName(p, plan[0]!.box)}`, goal);
}

/** The first push of a fewest-pushes solution (a straight run onto a goal if it starts with one); else the puzzle's own hint. */
export function hint(p: SokoPuzzle, s: SokoState): Hint<SokoAction> | null {
  const found = pushHomeStep(p, s) ?? nextPushStep(p, s);
  return found ? (hintFrom(null, found, 1) as Hint<SokoAction>) : sokoban.hint?.(p, s) ?? null;
}
