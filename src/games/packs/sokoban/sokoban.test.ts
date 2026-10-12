import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { rleFormat, sokoban, xsbFormat, type SokoAction } from "./logic";
import { boxRoute, solvePushes, stuckBoxes, type SokoPuzzle } from "./solver";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(sokoban, params, seed, sig()) as Promise<SokoPuzzle>;

const solved = (p: SokoPuzzle) => {
  let s = sokoban.init(p);
  for (const m of (sokoban.solve!(p, s) as { moves: SokoAction[] }).moves) s = sokoban.reduce(p, s, m);
  return s;
};
const CLAIRE = ["#######", "#.@ # #", "#$* $ #", "#   $ #", "# ..  #", "#  *  #", "#######"].join("\n");

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 7, boxes: 3 }, "abc");
  expect(await gen({ width: 7, height: 7, boxes: 3 }, "abc")).toEqual(a);
  expect(await gen({ width: 7, height: 7, boxes: 3 }, "abd")).not.toEqual(a);
});

test("generated levels are solvable, and the solver's pushes really solve them", async () => {
  for (const params of sokoban.presets!.slice(0, 4).map((x) => x.params)) {
    for (const seed of ["a", "b"]) {
      const p = await gen(params, seed);
      const r = solvePushes(p, { boxes: p.boxes, player: p.player });
      expect(r.pushes).not.toBeNull();
      expect(r.pushes!.length).toBeGreaterThanOrEqual(p.boxes.length * 3);
      const s = solved(p);
      expect(sokoban.isSolved(p, s)).toBe(true);
      expect(s.pushes).toBe(r.pushes!.length);
      expect(sokoban.isSolved(p, sokoban.init(p))).toBe(false);
    }
  }
}, 60000);

test("xsb and run-length xsb read the same level, and round-trip", async () => {
  const a = xsbFormat.parse(CLAIRE);
  const b = rleFormat.parse("7#|#.@-#-#|#$*-$-#|#3-$-#|#-..--#|#--*--#|7#");
  expect(b).toEqual(a);
  expect(a.boxes.length).toBe(5);
  expect(a.goals.length).toBe(5);
  expect(xsbFormat.parse(xsbFormat.serialize!(a))).toEqual(a);
  expect(rleFormat.parse(rleFormat.serialize!(a))).toEqual(a);
  const p = await gen({ width: 8, height: 8, boxes: 4 }, "fmt");
  expect(rleFormat.parse(rleFormat.serialize!(p))).toEqual(p);
  expect(xsbFormat.parse(xsbFormat.serialize!(p))).toEqual(p);
  expect(() => xsbFormat.parse("#####\n#$ .#\n#####")).toThrow();
  expect(() => xsbFormat.parse("#####\n#@$$.#\n#####")).toThrow();
});

test("the simplest level takes one push, and Claire is solved", () => {
  const p = xsbFormat.parse("#####\n#@$.#\n#####");
  expect(solvePushes(p, { boxes: p.boxes, player: p.player }).pushes).toEqual([{ box: 7, dir: 1 }]);
  const claire = xsbFormat.parse(CLAIRE);
  const r = solvePushes(claire, { boxes: claire.boxes, player: claire.player });
  expect(r.pushes).not.toBeNull();
  expect(sokoban.isSolved(claire, solved(claire))).toBe(true);
});

test("steps, walks and pushes", () => {
  const p = xsbFormat.parse(["######", "#@   #", "# $  #", "#  . #", "######"].join("\n"));
  let s = sokoban.init(p);
  expect(sokoban.reduce(p, s, { type: "step", dir: 0 })).toBe(s);
  s = sokoban.reduce(p, s, { type: "walk", to: 10 });
  expect(s.player).toBe(10);
  expect(s.moves).toBe(3);
  s = sokoban.reduce(p, s, { type: "push", box: 14, dir: 2 });
  expect(s.boxes).toEqual([20]);
  expect(s.pushes).toBe(1);
  expect(s.moves).toBe(6);
  expect(sokoban.describeAction!(p, { type: "push", box: 14, dir: 2 }, s, s)).toBe("push C3 down");
  const t = sokoban.reduce(p, s, { type: "step", dir: 1 });
  expect(sokoban.reduce(p, t, { type: "step", dir: 2 }).player).toBe(t.player + p.w);
  expect(boxRoute(p, s.boxes, s.player, 20, 21)).toEqual([{ box: 20, dir: 1 }]);
});

test("stuck boxes: corners and squares", () => {
  const p = xsbFormat.parse(["######", "#@   #", "#    #", "#   .#", "######"].map((r, i) => (i === 1 ? "#@  $#" : r)).join("\n"));
  expect(stuckBoxes(p, p.boxes)).toEqual(p.boxes);
  const q = xsbFormat.parse(["#######", "#@    #", "# $$  #", "# $$ .#", "#  ...#", "#######"].join("\n"));
  expect(stuckBoxes(q, q.boxes).length).toBe(4);
});

test("hint names stuck boxes and says nothing otherwise", async () => {
  const p = await gen({ width: 7, height: 7, boxes: 3 }, "hint");
  const s = new Session(sokoban, p, { kind: "imported" });
  expect(s.hint()?.actions).toBeUndefined();
  const corner = xsbFormat.parse(["######", "#@ $ #", "#   .#", "######"].join("\n"));
  const c = new Session(sokoban, corner, { kind: "imported" });
  const h = c.hint()!;
  expect(h.message).toContain("can't be moved onto a goal");
  expect(h.actions).toBeUndefined();
});

