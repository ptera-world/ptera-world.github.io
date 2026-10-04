import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { api } from "./api";
import { generate } from "./core/generate";
import { Registry } from "./core/registry";
import { resolve } from "./core/schema";
import { Session } from "./core/session";
import { TechniqueHost } from "./core/techniques";

const registry = new Registry();
// same rule as the build: a directory is a pack once it has an index.ts
for (const dir of readdirSync(new URL("./packs", import.meta.url)).filter((d) => existsSync(new URL(`./packs/${d}/index.ts`, import.meta.url)))) {
  const mod = (await import(`./packs/${dir}/index.ts`)) as { default: (games: typeof api) => void };
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

/** A session with the sudoku naked-single technique switched to auto, attached as the shell does it. */
function nakedAuto(): Session<any, any, any, any> {
  const def = registry.getPuzzle("sudoku")!;
  const naked = registry.techniquesFor("sudoku").find((t) => t.id === "sudoku.naked-single")!;
  const reg = new Registry();
  reg.puzzle(def);
  reg.technique({ ...naked, defaults: { auto: true } });
  // one empty cell: a naked single from the very first moment
  const solved = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
  const puzzle = def.formats.find((f) => f.id !== "json")!.parse(`.${solved.slice(1)}`);
  const session = new Session(def, puzzle, { kind: "imported" });
  new TechniqueHost(reg, session);
  return session;
}

test("settle: naked singles present at the start get filled", () => {
  const session = nakedAuto();
  expect(session.solved).toBe(false);
  session.settle(false);
  expect(session.solved).toBe(true);
});

test("settle: owner filter only runs that assist", () => {
  const session = nakedAuto();
  expect(session.settle(true, "someone-else")).toBe(false);
  expect(session.settle(true, "techniques")).toBe(true);
  expect(session.canUndo).toBe(true);
});
