import { createRng } from "./rng";
import { canonical, resolve } from "./schema";
import type { AnyPuzzleDef, GenerateContext } from "./types";

const FRAME_BUDGET_MS = 12;

export function makeGenerateContext(signal: AbortSignal): GenerateContext {
  let last = performance.now();
  return {
    signal,
    async yield() {
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      if (performance.now() - last < FRAME_BUDGET_MS) return;
      await new Promise((r) => setTimeout(r, 0));
      last = performance.now();
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
    },
  };
}

/** The rng seed string for (puzzle, params, seed). Different params never share a stream. */
export function generationSeed(def: AnyPuzzleDef, params: Record<string, unknown>, seed: string): string {
  return `${def.id}|${canonical(def.params, resolve(def.params, params))}|${seed}`;
}

export async function generate(
  def: AnyPuzzleDef,
  params: Record<string, unknown>,
  seed: string,
  signal: AbortSignal,
): Promise<unknown> {
  const values = resolve(def.params, params);
  const rng = createRng(generationSeed(def, values, seed));
  return await def.generate(values, rng, makeGenerateContext(signal));
}
