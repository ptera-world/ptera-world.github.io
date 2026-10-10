import { expect, test } from "bun:test";
import { applyStep, findStep, stepsOf } from "../../core/techniques";
import { Registry } from "../../core/registry";
import { flip } from "./logic";
import pack from "./index";
import { api } from "../../api";

const registry = new Registry();
pack({ ...api, registry });
const chase = registry.techniquesFor(flip, { w: 3, h: 3, shape: "cross", lights: [] }).find((t) => t.id === "flip.chase")!;

test("chasing leaves only the bottom row lit, one row at a time", () => {
  const p = flip.formats[0]!.parse("4x4:cross:1011010000101101");
  let s = flip.init(p);
  expect(stepsOf(flip, chase, p, s).length).toBe(3);
  for (let guard = 0; guard < 50; guard++) {
    const step = findStep(flip, chase, p, s);
    if (!step) break;
    s = applyStep(flip, p, s, step);
  }
  expect(s.lights.slice(0, 12).every((l) => l === 0)).toBe(true);
});

test("chasing is only offered where presses form a cross", () => {
  expect(registry.techniquesFor(flip, flip.formats[0]!.parse("3x3:x:100000000")).some((t) => t.id === "flip.chase")).toBe(false);
});

test("reveal's answer presses clear the board from wherever it is", () => {
  const p = flip.formats[0]!.parse("3x3:cross:110100000");
  const s = flip.reduce(p, flip.init(p), { type: "press", cell: 4 });
  const ans = flip.solve!(p, s)!;
  expect("moves" in ans).toBe(true);
  const end = ("moves" in ans ? ans.moves : []).reduce((st, a) => flip.reduce(p, st, a), s);
  expect(flip.isSolved(p, end)).toBe(true);
});
