import { shadeSuite } from "../../lib/shade-kit/suite";
import { analyze, initialDoms, layout, model, norinori, pzprFormat, textFormat, type NorinoriPuzzle } from "./logic";
import { checkMarks } from "./plugins";
import { norinoriTechniques } from "./techniques";

shadeSuite<NorinoriPuzzle>({
  def: norinori,
  techniques: norinoriTechniques,
  checkMarks,
  levels: ["easy", "normal", "hard"],
  params: (difficulty, i) => ({ width: 6 + (i % 3), height: 6 + (i % 2), difficulty }),
  model, initialDoms, analyze,
  random(rng) {
    for (;;) {
      const w = rng.range(3, 5), h = rng.range(3, 5);
      const l = layout(w, h, rng);
      if (l) return { w, h, regions: l.regions };
    }
  },
  formats: [pzprFormat, textFormat],
  presetBudgetWork: 32_000_000,
});
