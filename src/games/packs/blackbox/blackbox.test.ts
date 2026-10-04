import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost } from "../../core/techniques";
import { entryAt, entryOf, fireAt, hitCode, reflectCode } from "./beam";
import { blackbox, sgtFormat, type BlackboxPuzzle } from "./logic";
import { checkMarks } from "./plugins";
import { expand, families, familySize } from "./reason";
import { blackboxTechniques, evidence } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(blackbox, params, seed, sig()) as Promise<BlackboxPuzzle>;

test("lasers follow the original's rules", () => {
  // the example from the original's manual, 8×8 with balls at C1, E1, G6, F8
  const w = 8, h = 8;
  const balls = new Set([2, 4, 46, 61]);
  const top = (x: number) => x, right = (y: number) => w + y, bottom = (x: number) => w + h + (w - 1 - x), left = (y: number) => 2 * w + h + (h - 1 - y);
  expect(fireAt(w, h, balls, top(1))).toBe(reflectCode(w, h));
  expect(fireAt(w, h, balls, top(2))).toBe(hitCode(w, h));
  expect(fireAt(w, h, balls, top(3))).toBe(reflectCode(w, h));
  expect(fireAt(w, h, balls, top(0))).toBe(bottom(0));
  expect(fireAt(w, h, balls, left(1))).toBe(bottom(1));
  expect(fireAt(w, h, balls, right(1))).toBe(left(4));
  expect(fireAt(w, h, balls, left(6))).toBe(hitCode(w, h));
  expect(fireAt(w, h, balls, bottom(3))).toBe(reflectCode(w, h));
  expect(fireAt(w, h, balls, bottom(4))).toBe(reflectCode(w, h));
  for (let i = 0; i < 2 * (w + h); i++) {
    const { x, y } = entryAt(w, h, i);
    expect(entryOf(w, h, x, y)).toBe(i);
  }
});

test("generation is deterministic and respects the ball range", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  for (let i = 0; i < 10; i++) {
    const p = await gen({ minBalls: 3, maxBalls: 6 }, `r${i}`);
    expect(p.balls.length).toBeGreaterThanOrEqual(3);
    expect(p.balls.length).toBeLessThanOrEqual(6);
    expect(new Set(p.balls).size).toBe(p.balls.length);
  }
});

test("the families of layouts are exactly the layouts that fit the shots", () => {
  const rng = createRng("fam");
  for (let t = 0; t < 30; t++) {
    const w = rng.range(3, 4), h = rng.range(3, 4), nb = rng.range(1, 3);
    const balls = new Set(rng.shuffle(Array.from({ length: w * h }, (_, i) => i)).slice(0, nb));
    const shots: [number, number][] = rng.shuffle(Array.from({ length: 2 * (w + h) }, (_, i) => i)).slice(0, rng.range(1, 5)).map((e) => [e, fireAt(w, h, balls, e)]);
    const fam = families({ w, h, minBalls: nb, maxBalls: nb, shots });
    expect(fam.complete).toBe(true);
    const found = new Set(expand(fam.list, 1e6).map((l) => l.join(",")));
    expect(found.size).toBe(fam.list.reduce((a, f) => a + familySize(f), 0));
    const all: number[][] = [];
    const pick = (from: number, cur: number[]) => {
      if (cur.length === nb) { all.push(cur.slice()); return; }
      for (let c = from; c < w * h; c++) { cur.push(c); pick(c + 1, cur); cur.pop(); }
    };
    pick(0, []);
    for (const l of all) {
      const set = new Set(l);
      const fits = shots.every(([e, r]) => fireAt(w, h, set, e) === r);
      expect(found.has(l.join(","))).toBe(fits);
    }
  }
});

test("checking finds a laser that shows wrong balls, and accepts any layout with the same results", () => {
  const p: BlackboxPuzzle = { w: 4, h: 4, minBalls: 1, maxBalls: 1, balls: [5] };
  let s = blackbox.init(p);
  s = blackbox.reduce(p, s, { type: "ball", cells: [10], value: true });
  s = blackbox.reduce(p, s, { type: "check" });
  expect(s.solved).toBe(false);
  expect(s.wrong.length).toBe(1);
  expect(s.revealed.length).toBe(1);
  s = blackbox.reduce(p, s, { type: "ball", cells: [10], value: false });
  s = blackbox.reduce(p, s, { type: "ball", cells: [5], value: true });
  s = blackbox.reduce(p, s, { type: "check" });
  expect(s.solved).toBe(true);
});

test("hints only use fired lasers, and lead to a win", async () => {
  for (let t = 0; t < 6; t++) {
    const p = await gen({ width: 6, height: 6, minBalls: 3, maxBalls: 3 }, `play${t}`);
    const registry = new Registry();
    for (const tq of blackboxTechniques) registry.technique(tq);
    const s = new Session(blackbox, p, { kind: "imported" });
    new TechniqueHost(registry, s);
    checkMarks.setup!({ session: s, settings: {}, owner: "check" });
    for (let i = 0; i < 80 && !s.solved; i++) {
      const h = s.hint();
      expect(h?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of h!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
    expect(s.state.checks).toBe(1);
    // the hints never peeked: every ball placed by a hint fits every laser fired
    const ev = evidence(p, s.state);
    const mine = new Set(s.state.guesses.flatMap((g, c) => (g ? [c] : [])));
    for (const [e, r] of ev.shots) expect(fireAt(p.w, p.h, mine, e)).toBe(r);
  }
}, 60000);

test("game ids round-trip and use the original's hidden form", async () => {
  const p = await gen({ width: 10, height: 7, minBalls: 3, maxBalls: 6 }, "fmt");
  const text = sgtFormat.serialize!(p);
  expect(text.startsWith("w10h7m3M6:")).toBe(true);
  expect(sgtFormat.parse(text)).toEqual(p);
  expect(() => sgtFormat.parse("w8h8m5M5:00")).toThrow();
});
