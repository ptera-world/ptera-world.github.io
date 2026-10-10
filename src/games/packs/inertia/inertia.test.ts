import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost } from "../../core/techniques";
import { GEM, MINE, STOP, canCollectAll, gridFormat, inertia, roll, sgtFormat, type InertiaPuzzle } from "./logic";
import { checkReachable, hint } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(inertia, params, seed, sig()) as Promise<InertiaPuzzle>;

test("generation is deterministic with sgt's proportions", async () => {
  expect(await gen({ width: 10, height: 8 }, "a")).toEqual(await gen({ width: 10, height: 8 }, "a"));
  expect(await gen({ width: 10, height: 8 }, "a")).not.toEqual(await gen({ width: 10, height: 8 }, "b"));
  const p = await gen({ width: 10, height: 8 }, "c");
  const count = (k: number) => p.grid.filter((v) => v === k).length;
  expect(count(GEM)).toBe(16);
  expect(count(MINE)).toBe(16);
  expect(count(STOP)).toBe(17);
});

test("every generated board can be fully collected, and the hint alone does it without dying", async () => {
  for (const pr of [...inertia.presets!.map((x) => x.params), { width: 5, height: 9 }]) {
    for (const seed of ["s1", "s2", "s3"]) {
      const p = await gen(pr, seed);
      let s = inertia.init(p);
      expect(canCollectAll(p, s.pos, s.gems)).toBe(true);
      for (let i = 0; i < 2000 && !inertia.isSolved(p, s); i++) {
        const h = hint(p, s);
        expect(h).not.toBeNull();
        s = h!.actions!.reduce((t, a) => inertia.reduce(p, t, a), s);
        expect(s.dead).toBe(false);
      }
      expect(inertia.isSolved(p, s)).toBe(true);
    }
  }
}, 60000);

test("rolling: gems don't stop the ball, stops and walls do, mines kill", () => {
  const p = gridFormat.parse("@.*.o\n.....\nx...#");
  expect(roll(p, 0, 2).path).toEqual([1, 2, 3, 4]);
  expect(roll(p, 0, 4)).toEqual({ path: [5, 10], dead: true });
  expect(roll(p, 0, 0).path).toEqual([]);
  let s = inertia.init(p);
  s = inertia.reduce(p, s, { type: "move", dir: 2 });
  expect(s.pos).toBe(4);
  expect(inertia.isSolved(p, s)).toBe(true);
  const dead = inertia.reduce(p, inertia.init(p), { type: "move", dir: 4 });
  expect(inertia.isLost!(p, dead)).toBeTruthy();
});

test("a roll that cuts a gem off is never hinted, and is pointed out once made", async () => {
  let checked = 0;
  for (let i = 0; i < 400 && checked < 5; i++) {
    const p = await gen({ width: 6, height: 5 }, `cut${i}`);
    let found: { path: number[]; bad: number } | null = null;
    let layer: { s: ReturnType<typeof inertia.init>; path: number[] }[] = [{ s: inertia.init(p), path: [] }];
    for (let depth = 0; depth < 3 && !found; depth++) {
      const next: typeof layer = [];
      for (const { s, path } of layer) {
        for (let d = 0; d < 8 && !found; d++) {
          const t2 = inertia.reduce(p, s, { type: "move", dir: d });
          if (t2 === s || t2.dead || !t2.gems.some(Boolean)) continue;
          if (!canCollectAll(p, t2.pos, t2.gems)) found = { path, bad: d };
          else next.push({ s: t2, path: [...path, d] });
        }
      }
      layer = next;
    }
    if (!found) continue;
    const bad = found.bad;
    checked++;
    const session = new Session({ ...inertia, hint }, p, { kind: "imported" });
    for (const d of found.path) session.dispatch({ type: "move", dir: d });
    const registry = new Registry();
    new TechniqueHost(registry, session);
    checkReachable.setup!({ session, settings: {}, owner: "check" });
    expect(session.hint()?.actions?.[0]).not.toEqual({ type: "move", dir: bad });
    session.dispatch({ type: "move", dir: bad });
    expect(session.hint()?.message).toMatch(/never reach|no single route/);
  }
  expect(checked).toBeGreaterThan(0);
});

test("formats round-trip; sgt ids parse", async () => {
  const p = await gen({ width: 8, height: 6 }, "fmt");
  for (const f of inertia.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  expect(sgtFormat.parse("3x2:Sgbwms").start).toBe(0);
  expect(() => sgtFormat.parse("3x2:bgbwms")).toThrow();
  expect(() => sgtFormat.parse("3x2:Sbbwms")).toThrow();
});
