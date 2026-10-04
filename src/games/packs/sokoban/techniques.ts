import type { Step, Technique } from "../../core/types";
import { cellName, pushText, solveFrom, type SokoAction, type SokoFocus, type SokoPuzzle, type SokoState } from "./logic";
import { stepFrom, type Push } from "./solver";

type SokoTechnique = Technique<SokoPuzzle, SokoState, SokoAction>;

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

export const pushHome: SokoTechnique = {
  id: "sokoban.push-home",
  name: "straight home",
  puzzles: ["sokoban"],
  level: 1,
  description: "when the fewest-pushes solution starts by pushing one box in a straight line onto a goal, push it all the way.",
  find(p, s) {
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
  },
  practice: { params: { width: 6, height: 6, boxes: 2 } },
};

export const nextPush: SokoTechnique = {
  id: "sokoban.next-push",
  name: "fewest pushes",
  puzzles: ["sokoban"],
  level: 2,
  description: "search every way of pushing the boxes for one that gets them all home in the fewest pushes (it never pushes a box into a corner or against another box where it would stick), and make its first push.",
  find(p, s) {
    const plan = solveFrom(p, s).pushes;
    if (!plan?.length) return null;
    const goal = destination(p, plan);
    return step(plan, 1, `${pushText(p, plan[0]!)}: that box is headed for the goal at ${cellName(p, goal)} (${left(plan.length)}).`,
      `look at the box at ${cellName(p, plan[0]!.box)}`, goal);
  },
  practice: { params: { width: 7, height: 7, boxes: 3 } },
};

export const sokoTechniques: SokoTechnique[] = [pushHome, nextPush];
