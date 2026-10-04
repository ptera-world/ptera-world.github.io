import { shadeSuite } from "../../lib/shade-kit/suite";
import { analyze, initialDoms, layout, model, pzprFormat, starbattle, textFormat, type StarBattlePuzzle } from "./logic";
import { checkMarks } from "./plugins";
import { starbattleTechniques } from "./techniques";

shadeSuite<StarBattlePuzzle>({
  def: starbattle,
  techniques: starbattleTechniques,
  checkMarks,
  levels: ["easy", "normal", "hard"],
  params: (difficulty, i) => (i === 3 && difficulty !== "easy" ? { size: 8, stars: "2", difficulty } : { size: 6 + (i % 3), stars: "1", difficulty }),
  model, initialDoms, analyze,
  random(rng) {
    for (;;) {
      const n = rng.range(4, 6);
      const l = layout(n, 1, rng);
      if (l) return { w: n, h: n, k: 1, regions: l.regions };
    }
  },
  formats: [pzprFormat, textFormat],
  presetBudgetMs: 8000,
});
