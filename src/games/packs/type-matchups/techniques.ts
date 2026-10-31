import type { Step, Technique } from "../../core/types";
import {
  current, factor, factorText, resisters, single, weaknesses,
  type TMAction, type TMPuzzle, type TMState, type Types,
} from "./logic";

type TMTechnique = Technique<TMPuzzle, TMState, TMAction>;

/** Highlight data understood by the view: types in the pick grid, and the defender's types. */
export interface TMFocus {
  types?: string[];
  defender?: boolean;
}

/**
 * The deductions a competitive player makes, one per idea: read the chart for one type, an
 * immunity cancels everything, two types multiply, and the pick questions done type by type.
 */
export function makeTechniques(puzzle: { id: string }, types: (p: TMPuzzle) => Types): TMTechnique[] {
  const factorStep = (p: TMPuzzle, s: TMState, want: "mono" | "immune" | "dual"): Step<TMAction> | null => {
    const q = current(p, s);
    if (q?.kind !== "factor") return null;
    const T = types(p);
    const def = T.of(q.defender);
    const zero = def.find((d) => single(T, q.attack, d) === 0);
    const kind = zero ? "immune" : def.length > 1 ? "dual" : "mono";
    if (kind !== want) return null;
    const f = factor(T, q.attack, def);
    const name = T.item(q.defender).name;
    const parts = def.map((d) => `vs ${d} ${factorText(single(T, q.attack, d))}`).join(", ");
    const message = kind === "immune"
      ? `${zero} is immune to ${q.attack} (×0), so whatever ${name}'s other type does, it's ×0`
      : kind === "dual"
        ? `${q.attack} ${parts}: multiplied, ${factorText(f)}`
        : `${q.attack} vs ${def[0]}: ${factorText(f)}`;
    return {
      message,
      nudge: kind === "dual" ? `take ${name}'s types one at a time` : kind === "immune" ? `is one of ${name}'s types immune to ${q.attack}?` : `look up ${q.attack} against ${def[0]}`,
      focus: { defender: true } satisfies TMFocus,
      actions: [{ type: "factor", factor: f }],
    };
  };

  const factorTechnique = (id: string, name: string, level: number, want: "mono" | "immune" | "dual", description: string): TMTechnique => ({
    id: `type-matchups.${id}`, name, puzzles: [puzzle], level, description,
    practice: { params: { kinds: ["factor"] } },
    instances(p, s, visit) {
      const step = factorStep(p, s, want);
      if (step) visit(step);
    },
  });

  /** Pick-question steps: fix one type at a time (add a missing one, then drop a wrong one), then check. */
  const pickSteps = (p: TMPuzzle, s: TMState, kind: "weak" | "resist", visit: (step: Step<TMAction>) => boolean | void) => {
    const q = current(p, s);
    if (q?.kind !== kind) return;
    const T = types(p);
    const answer = q.kind === "weak" ? weaknesses(T, T.of(q.defender)) : resisters(T, q.attacks);
    const why = (t: string): string => {
      if (q.kind === "weak") {
        const def = T.of(q.defender);
        const f = factor(T, t, def);
        return `${t} ${def.map((d) => `vs ${d} ${factorText(single(T, t, d))}`).join(", ")}${def.length > 1 ? ` → ${factorText(f)}` : ""}`;
      }
      return `${t} takes ${q.attacks.map((a) => `${factorText(single(T, a, t))} from ${a}`).join(", ")}`;
    };
    const good = kind === "weak" ? "super effective" : "resists them all";
    const bad = kind === "weak" ? "not super effective" : "doesn't resist them all";
    for (const t of answer) {
      if (s.picked.includes(t)) continue;
      if (visit({ message: `${why(t)}: ${good}, pick it`, nudge: kind === "weak" ? "a type that hits it super effectively isn't picked yet" : "a type that resists all of them isn't picked yet", focus: { types: [t], defender: true } satisfies TMFocus, nudgeFocus: { defender: true } satisfies TMFocus, actions: [{ type: "pick", t }] })) return;
    }
    for (const t of s.picked) {
      if (answer.includes(t)) continue;
      if (visit({ message: `${why(t)}: ${bad}, drop it`, nudge: "one of your picks is wrong", focus: { types: [t] } satisfies TMFocus, actions: [{ type: "pick", t }] })) return;
    }
    visit({
      message: kind === "weak" ? "every type that hits it super effectively is picked, and nothing else" : "every type that resists all of them is picked, and nothing else",
      nudge: "your picks are right",
      focus: { types: answer } satisfies TMFocus,
      actions: [{ type: "submit" }],
    });
  };

  return [
    factorTechnique("one-type", "read the chart", 1, "mono",
      "against one with a single type, the factor is the chart's: what the attacking type does to that type (for pokémon: ×2, ×1, ×½ or ×0)."),
    factorTechnique("immunity", "an immunity wins", 1, "immune",
      "if either of its types is immune to the attacking type (in pokémon: normal and fighting vs ghost, ground vs flying, electric vs ground, …), the answer is ×0, whatever the other type does."),
    factorTechnique("multiply", "two types multiply", 2, "dual",
      "against two types, take each one alone and multiply: ×2 and ×2 make ×4, ×2 and ×½ cancel to ×1, ×½ and ×½ make ×¼."),
    {
      id: "type-matchups.weaknesses", name: "find the weaknesses", puzzles: [puzzle], level: 3,
      description: "go through the attacking types one at a time and multiply what each does to its types; every one that comes out at ×2 or ×4 is a weakness. a weakness of one type that the other resists (or is immune to) cancels out.",
      practice: { params: { kinds: ["weak"] } },
      instances: (p, s, visit) => pickSteps(p, s, "weak", visit),
    },
    {
      id: "type-matchups.resist-all", name: "resist them all", puzzles: [puzzle], level: 3,
      description: "for each defending type, look up what every one of the attacks does to it; it counts only if none does more than ×½ (immune counts too).",
      practice: { params: { kinds: ["resist"] } },
      instances: (p, s, visit) => pickSteps(p, s, "resist", visit),
    },
  ];
}
