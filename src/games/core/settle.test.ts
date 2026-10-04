import { expect, test } from "bun:test";
import { readdirSync } from "fs";
import { api } from "../api";
import { generate } from "./generate";
import { Registry } from "./registry";
import { resolve } from "./schema";
import { Session } from "./session";

const registry = new Registry();
for (const dir of readdirSync(new URL("../packs", import.meta.url))) {
  const mod = (await import(`../packs/${dir}/index.ts`)) as { default: (games: typeof api) => void };
  mod.default({ ...api, registry });
}

/** Every plugin, settled on its own against a fresh board, must be idempotent and leave no history. */
for (const def of registry.listPuzzles()) {
  test(`settle: ${def.id} assists are idempotent on a fresh board`, async () => {
    const small = def.presets?.[0]?.params ?? {};
    const puzzle = await generate(def, small, "settle", new AbortController().signal);
    for (const p of registry.pluginsFor(def.id)) {
      if (!p.setup) continue;
      const session = new Session(def, puzzle, { kind: "imported" });
      p.setup({ session, settings: p.settings ? resolve(p.settings, {}) : {}, owner: p.id });
      session.settle(false);
      const once = session.state;
      expect(session.canUndo).toBe(false);
      expect(session.settle(true, p.id)).toBe(false);
      expect(session.state).toBe(once);
    }
  }, 30000);
}

test("settle: naked singles present at the start get filled", async () => {
  const def = registry.getPuzzle("sudoku")!;
  const fill = registry.pluginsFor("sudoku").find((p) => p.id === "sudoku.fill-naked")!;
  // one empty cell: a naked single from the very first moment
  const solved = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
  const puzzle = def.formats.find((f) => f.id !== "json")!.parse(`.${solved.slice(1)}`);
  const session = new Session(def, puzzle, { kind: "imported" });
  fill.setup!({ session, settings: resolve(fill.settings!, {}), owner: fill.id });
  expect(session.solved).toBe(false);
  session.settle(false);
  expect(session.solved).toBe(true);
});

test("settle: owner filter only runs that assist", async () => {
  const def = registry.getPuzzle("sudoku")!;
  const fill = registry.pluginsFor("sudoku").find((p) => p.id === "sudoku.fill-naked")!;
  const solved = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
  const puzzle = def.formats.find((f) => f.id !== "json")!.parse(`.${solved.slice(1)}`);
  const session = new Session(def, puzzle, { kind: "imported" });
  fill.setup!({ session, settings: resolve(fill.settings!, {}), owner: fill.id });
  expect(session.settle(true, "someone-else")).toBe(false);
  expect(session.settle(true, fill.id)).toBe(true);
  expect(session.canUndo).toBe(true);
});
