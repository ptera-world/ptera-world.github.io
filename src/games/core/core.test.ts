import { expect, test } from "bun:test";
import { solvePresses, toggle as flip } from "./fixture";
import { generate } from "./generate";
import { createRng } from "./rng";
import { canonical, defineSchema, fromQuery, resolve, toQuery } from "./schema";
import { Session } from "./session";

test("rng is deterministic and forks are independent", () => {
  const a = createRng("x"), b = createRng("x");
  const seqA = Array.from({ length: 50 }, () => a.int(1000));
  const seqB = Array.from({ length: 50 }, () => b.int(1000));
  expect(seqA).toEqual(seqB);
  const c = createRng("x");
  c.fork("other").next();
  expect(c.int(1000)).toBe(seqA[0]!);
  expect(createRng("y").int(1000000)).not.toBe(createRng("x").int(1000000));
});

test("schema resolve/canonical/query round-trip", () => {
  const s = defineSchema({
    n: { type: "int", label: "n", default: 3, min: 1, max: 9 },
    b: { type: "bool", label: "b", default: false },
    e: { type: "enum", label: "e", default: "a", options: [{ value: "a", label: "a" }, { value: "z", label: "z" }] },
    set: { type: "set", label: "set", default: [], options: [{ value: "p", label: "p" }, { value: "q", label: "q" }] },
  });
  const v = resolve(s, { n: 42, b: "1", e: "nope", set: ["q", "p", "bogus"] });
  expect(v).toEqual({ n: 9, b: true, e: "a", set: ["p", "q"] });
  const q = new URLSearchParams();
  toQuery(s, v, q);
  expect(q.has("e")).toBe(false);
  expect(fromQuery(s, q)).toEqual(v);
  expect(canonical(s, v)).toBe(canonical(s, resolve(s, { set: "q,p", b: true, n: 99 })));
});

test("seeded generation is reproducible", async () => {
  const sig = new AbortController().signal;
  const p1 = await generate(flip, { width: 6, height: 4 }, "seed1", sig);
  const p2 = await generate(flip, { width: 6, height: 4 }, "seed1", sig);
  const p3 = await generate(flip, { width: 6, height: 4 }, "seed2", sig);
  expect(p1).toEqual(p2);
  expect(p1).not.toEqual(p3);
});

test("session: dispatch, apply hook, batch, undo/redo, solve", async () => {
  const puzzle = await generate(flip, { width: 4, height: 4 }, "s", new AbortController().signal) as Parameters<typeof flip.init>[0];
  const session = new Session(flip, puzzle, { kind: "imported" });
  let applied = 0;
  session.hooks.apply.tap((s) => { applied++; return s; }, { owner: "t" });
  session.dispatch({ type: "press", cell: 0 });
  expect(applied).toBe(1);
  expect(session.canUndo).toBe(true);
  session.batch(() => {
    session.dispatch({ type: "press", cell: 1 });
    session.dispatch({ type: "press", cell: 2 });
  });
  expect(session.actionLog().length).toBe(3);
  session.undo();
  expect(session.actionLog().length).toBe(1);
  session.redo();
  session.undo();
  session.undo();
  expect(session.state.lights).toEqual(puzzle.lights);
  session.hooks.apply.untapOwner("t");

  const presses = solvePresses(puzzle, session.state.lights)!;
  session.batch(() => presses.forEach((v, cell) => v && session.dispatch({ type: "press", cell })));
  expect(session.solved).toBe(true);

  const restored = Session.restore(flip, JSON.parse(JSON.stringify(session.snapshot())));
  expect(restored.state).toEqual(session.state);
  expect(restored.canUndo).toBe(true);
});

test("action hook can veto", () => {
  const puzzle = flip.formats[0]!.parse("2x2:1000");
  const session = new Session(flip, puzzle, { kind: "imported" });
  session.hooks.action.tap(() => null, { owner: "veto" });
  expect(session.dispatch({ type: "press", cell: 0 })).toBe(false);
});

test("cross-event batch is one undo step; restart clears solved", () => {
  const puzzle = flip.formats[0]!.parse("1x2:11");
  const session = new Session(flip, puzzle, { kind: "imported" });
  let solvedCount = 0;
  session.hooks.solved.tap(() => { solvedCount++; });
  session.beginBatch();
  session.dispatch({ type: "press", cell: 0 });
  expect(session.solved).toBe(false);
  session.endBatch();
  expect(session.solved).toBe(true);
  expect(solvedCount).toBe(1);
  session.restart();
  expect(session.solved).toBe(false);
  expect(session.elapsedMs()).toBeLessThan(50);
  session.dispatch({ type: "press", cell: 1 });
  expect(solvedCount).toBe(2);
  session.undo();
  session.undo();
  expect(session.state.lights).toEqual([0, 0]);
});

test("checkSolved fires for a puzzle that opens already solved", () => {
  const session = new Session(flip, flip.formats[0]!.parse("2x1:00"), { kind: "imported" });
  let fired = false;
  session.hooks.solved.tap(() => { fired = true; });
  session.checkSolved();
  expect(fired).toBe(true);
});

test("apply taps run to a fixpoint, so one assist's change can trigger another", () => {
  // tap A: a lit cell 0 turns cell 1 on. tap B (runs after A): lit cell 1 turns cell 2 on.
  // a single pass would light cell 2 only if B saw A's output; a second round is needed for
  // tap A to react to B. Here: cell 2 lit → cell 3 lit, handled by A again.
  const puzzle = flip.formats[0]!.parse("4x1:0000");
  const session = new Session(flip, puzzle, { kind: "imported" });
  const light = (s: { lights: number[] }, c: number) => (s.lights[c] ? s : { lights: s.lights.map((v, i) => (i === c ? 1 : v)) });
  session.hooks.apply.tap((s) => {
    let out = s;
    if (out.lights[0]) out = light(out, 1);
    if (out.lights[2]) out = light(out, 3);
    return out;
  }, { owner: "a", priority: 1 });
  session.hooks.apply.tap((s) => (s.lights[1] ? light(s, 2) : s), { owner: "b", priority: 2 });
  session.dispatch({ type: "press", cell: 0 }); // toggles cells 0 and 1
  expect(session.state.lights).toEqual([1, 1, 1, 1]);
  expect(session.depth).toBe(1);
});

test("shared history rebuilds the exact game, independent of assists", async () => {
  const { packJson, unpackJson, diff, apply } = await import("./patch");
  expect(apply({ a: [1, 2, 3], b: "x" }, diff({ a: [1, 2, 3], b: "x" }, { a: [1, 9, 3], c: [1] }))).toEqual({ a: [1, 9, 3], c: [1] });
  const puzzle = flip.formats[0]!.parse("3x3:010111010");
  const s = new Session(flip, puzzle, { kind: "imported" });
  s.dispatch({ type: "press", cell: 0 });
  s.dispatch({ type: "press", cell: 8 });
  const shared = await unpackJson(await packJson(s.exportHistory())) as Parameters<typeof Session.fromShared>[3]["history"];
  const r = Session.fromShared(flip, puzzle, { kind: "imported" }, { history: shared });
  expect(r.state).toEqual(s.state);
  expect(r.depth).toBe(2);
  r.undo();
  r.undo();
  expect(r.state).toEqual(flip.init(puzzle));
  const st = Session.fromShared(flip, puzzle, { kind: "imported" }, { state: s.exportState() });
  expect(st.state).toEqual(s.state);
  expect(st.canUndo).toBe(false);
});
