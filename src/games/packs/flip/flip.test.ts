import { expect, test } from "bun:test";
import { applyStep, findStep, stepsOf } from "../../core/techniques";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { coerce, fromQuery, resolve, toQuery } from "../../core/schema";
import { chaseDirection, chaseMoves, cellAt, flip, params, toCoord, type FlipPuzzle } from "./logic";
import pack from "./index";
import { api } from "../../api";

const registry = new Registry();
pack({ ...api, registry });
const chaseOf = (p: FlipPuzzle) => registry.techniquesFor(flip, p).find((t) => t.id === "flip.chase");

const make = (partial: Record<string, unknown>, seed: string): FlipPuzzle =>
  flip.generate(resolve(params, partial), createRng(seed), {} as never) as FlipPuzzle;

const BOARDS: [string, Record<string, unknown>][] = [
  ["cross", { neighborhood: "cross" }],
  ["x", { neighborhood: "x" }],
  ["square", { neighborhood: "square" }],
  ["hex", { grid: "hex", width: 6, height: 5 }],
  ["drawn square", { neighborhood: "drawn", drawn: "-1,0;0,0;1,1;0,-1" }],
  ["drawn hex", { grid: "hex", hexNeighborhood: "drawn", drawnHex: "-1,1;0,0;1,0;0,-1" }],
];

/** Chases until nothing is left to chase; returns the end state. */
function chaseAll(p: FlipPuzzle) {
  const t = chaseOf(p)!;
  let s = flip.init(p);
  for (let guard = 0; guard < 2000; guard++) {
    const step = findStep(flip, t, p, s);
    if (!step) return s;
    s = applyStep(flip, p, s, step);
  }
  throw new Error("chase did not finish");
}

for (const [name, params0] of BOARDS) {
  for (const holes of [0, 20]) {
    test(`chasing leaves only far lines: ${name}, ${holes}% holes`, () => {
      for (let i = 0; i < 6; i++) {
        const p = make({ width: 7, height: 6, ...params0, holes }, `chase-${name}-${holes}-${i}`);
        expect(chaseOf(p)).toBeDefined();
        const end = chaseAll(p);
        const d = chaseDirection(p)!;
        end.lights.forEach((l, c) => {
          if (p.holes[c]) expect(l).toBe(0);
          if (!l) return;
          const [a, b] = toCoord(p, c);
          expect(cellAt(p, a - d.back[0], b - d.back[1])).toBe(-1);
        });
        expect(chaseMoves(p, end.lights)).toEqual([]);
      }
    });
  }
}

test("chase steps name the light and the press, and the press touches nothing behind it", () => {
  const p = flip.formats[0]!.parse("4x4:cross:1011010000101101");
  const t = chaseOf(p)!;
  const s = flip.init(p);
  const steps = stepsOf(flip, t, p, s);
  expect(steps.length).toBe(3);
  const [light, press] = steps[0]!.focus as number[];
  expect(steps[0]!.message).toContain("is the first light along the chase");
  expect(Math.floor(press! / 4)).toBe(Math.floor(light! / 4) + 1);
});

test("chasing is not offered where no direction has a single furthest-back offset", () => {
  const p: FlipPuzzle = { w: 3, h: 3, grid: "square", holes: Array(9).fill(0), offsets: [], lights: Array(9).fill(0) };
  expect(chaseOf(p)).toBeUndefined();
  expect(registry.techniquesFor(flip, make({}, "a")).some((t) => t.id === "flip.chase")).toBe(true);
});

test("the diagonal directions are tried down-right, down-left, up-right, up-left", () => {
  const x = flip.formats[0]!.parse("3x3:x:100000000");
  expect(chaseDirection(x)!.name).toBe("down-right");
});

test("hex boards chase to the right", () => {
  const p = make({ grid: "hex" }, "h");
  expect(chaseDirection(p)!.name).toBe("right");
});

test("text formats round-trip, old and new", () => {
  const f = flip.formats[0]!;
  const old = "3x3:cross:010111010";
  expect(f.serialize!(f.parse(old))).toBe(old);
  const strings = [
    "3x3:hex:-1,0;-1,1;0,-1;0,0;0,1;1,-1;1,0:01-110010",
    "3x3:square:0,0;1,0:0101-1010",
    "2x2:square:-1,0;0,0;1,0;0,-1;0,1:1-01",
    "2x2:square::1001",
  ];
  for (const t of strings) {
    expect(f.detect!(t)).toBe(true);
    const p = f.parse(t);
    expect(f.parse(f.serialize!(p))).toEqual(p);
  }
  expect(f.serialize!(f.parse("3x3:square:-1,0;0,0;1,0;0,-1;0,1:010111010"))).toBe(old);
  for (const [name, q] of BOARDS) {
    const p = make({ ...q, holes: 20 }, `rt-${name}`);
    expect(f.parse(f.serialize!(p))).toEqual(p);
  }
  expect(() => f.parse("3x3:hex:0,0:0101")).toThrow();
});

test("solve clears generated hex and holed boards", () => {
  for (const [name, q] of BOARDS) {
    for (const holes of [0, 25]) {
      const p = make({ ...q, holes }, `solve-${name}-${holes}`);
      expect(p.lights.some((l, i) => l && p.holes[i])).toBe(false);
      expect(p.lights.some(Boolean)).toBe(true);
      const ans = flip.solve!(p, flip.init(p))!;
      const end = ("moves" in ans ? ans.moves : []).reduce((st, a) => flip.reduce(p, st, a), flip.init(p));
      expect(flip.isSolved(p, end)).toBe(true);
    }
  }
});

test("holes are never lit or pressable", () => {
  const p = make({ holes: 30 }, "holes");
  expect(p.holes.filter(Boolean).length).toBe(Math.round(25 * 0.3));
  const hole = p.holes.indexOf(1);
  const s = flip.init(p);
  expect(flip.reduce(p, s, { type: "press", cell: hole })).toBe(s);
});

test("the hint never has actions", () => {
  for (const [name, q] of BOARDS) {
    const p = make({ ...q, holes: 10 }, `hint-${name}`);
    let s = flip.init(p);
    const check = () => {
      const h = flip.hint!(p, s);
      if (h) expect(h.actions).toBeUndefined();
    };
    check();
    s = chaseAll(p);
    check();
    if (!flip.isSolved(p, s)) expect(flip.hint!(p, s)!.message).toContain("can't be chased any further");
  }
  const none: FlipPuzzle = { w: 3, h: 3, grid: "square", holes: Array(9).fill(0), offsets: [], lights: Array(9).fill(1) };
  const h = flip.hint!(none, flip.init(none))!;
  expect(h.actions).toBeUndefined();
  expect(h.focus).toBeUndefined();
  expect(flip.hint!(none, { lights: Array(9).fill(0) })).toBeNull();
});

test("reveal's answer presses clear the board from wherever it is", () => {
  const p = flip.formats[0]!.parse("3x3:cross:110100000");
  const s = flip.reduce(p, flip.init(p), { type: "press", cell: 4 });
  const ans = flip.solve!(p, s)!;
  expect("moves" in ans).toBe(true);
  const end = ("moves" in ans ? ans.moves : []).reduce((st, a) => flip.reduce(p, st, a), s);
  expect(flip.isSolved(p, end)).toBe(true);
});

test("generation throws when the neighborhood lights nothing", () => {
  expect(() => make({ neighborhood: "drawn", drawn: "" }, "e")).toThrow("can't light any cell");
});

test("cells fields keep valid offsets in canonical form and fall back otherwise", () => {
  const f = params.drawn;
  expect(coerce(f, "1,0;0,0;1,0")).toBe("0,0;1,0");
  expect(coerce(f, "")).toBe("");
  expect(coerce(f, "3,0")).toBe(f.default);
  expect(coerce(f, "a,b")).toBe(f.default);
  expect(coerce(f, 5)).toBe(f.default);
  const g = params.drawnHex;
  expect(coerce(g, "2,0;-2,2")).toBe("-2,2;2,0");
  expect(coerce(g, "2,1")).toBe(g.default);
  const q = new URLSearchParams();
  const v = resolve(params, { drawn: "0,1;0,0", neighborhood: "drawn" });
  toQuery(params, v, q);
  expect(fromQuery(params, q).drawn).toBe("0,0;0,1");
});
