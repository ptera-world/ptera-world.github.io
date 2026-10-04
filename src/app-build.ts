import { readdirSync, existsSync } from "fs";
import { join, dirname, relative, resolve } from "path";
import type { BunPlugin } from "bun";
import type { AppConfig } from "./site-config";

export interface AppOutput {
  /** Path relative to the app's URL root, e.g. "main.js", "packs/sudoku/index.js", "packs.json". */
  path: string;
  body: Blob | string;
  type: string;
}

/**
 * Engine files a pack may bundle into itself: stateless helpers (no module-level state, no
 * singletons) that a third-party pack could equally copy or bundle. Paths are relative to the
 * app root. Everything else in the engine is reachable only through the `games` object a pack's
 * entry receives, so built-in packs have no access a third-party pack lacks.
 */
const PACK_SDK = new Set([
  "core/types.ts",
  "core/names.ts",
  "core/schema.ts",
  "core/rng.ts",
  "core/hooks.ts",
  "core/commands.ts",
  "core/gestures.ts",
  "core/patch.ts",
  "core/dom.ts",
  "core/storage.ts",
]);

/**
 * Fails the build when a pack reaches into the engine outside PACK_SDK, or into another pack.
 * `lib/` holds shared code packs may bundle; like PACK_SDK it must not carry state that matters
 * across packs (each pack gets its own copy; memo caches are fine).
 */
function packBoundary(root: string, packDir: string): BunPlugin {
  return {
    name: "pack-boundary",
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (!args.importer) return undefined;
        const target = resolve(dirname(args.importer), args.path);
        const withExt = existsSync(target) ? target : `${target}.ts`;
        if (withExt.startsWith(packDir + "/")) return undefined;
        const rel = relative(root, withExt);
        if (rel.startsWith("..") || PACK_SDK.has(rel) || rel.startsWith("lib/")) return undefined;
        throw new Error(`${relative(root, args.importer)} imports ${rel}: packs may only bundle lib/ and ${[...PACK_SDK].join(", ")}; use the games object for anything else`);
      });
    },
  };
}

async function bundle(entry: string, root: string, outName: string, opts: { minify: boolean }, plugins: BunPlugin[] = []) {
  const result = await Bun.build({
    entrypoints: [entry],
    root,
    target: "browser",
    splitting: false,
    minify: opts.minify,
    sourcemap: opts.minify ? "none" : "inline",
    plugins,
    throw: false,
  });
  if (!result.success) throw new AggregateError(result.logs, result.logs.map(String).join("\n"));
  const o = result.outputs.find((x) => x.kind === "entry-point")!;
  return { path: outName, body: o, type: o.type } satisfies AppOutput;
}

/**
 * Bundle an app: the engine entry on its own, every pack directory as its own self-contained
 * module (one file, no shared chunks, loadable from anywhere), and a pack list (packs.json)
 * naming every pack in directory order. A pack that fails to build is listed with its error
 * and never takes the others down.
 */
export async function buildApp(app: AppConfig, opts: { minify: boolean }): Promise<AppOutput[]> {
  const root = resolve(dirname(app.entry));
  const packsDir = app.packs ? resolve(app.packs) : "";
  const packIds = packsDir && existsSync(packsDir)
    ? readdirSync(packsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(packsDir, d.name, "index.ts"))).map((d) => d.name).sort()
    : [];
  const out: AppOutput[] = [await bundle(app.entry, root, "main.js", opts)];
  const packsBase = relative(root, packsDir);
  const list: { id: string; name: string; url: string; error?: string }[] = [];
  for (const id of packIds) {
    const path = `${packsBase}/${id}/index.js`;
    try {
      out.push(await bundle(join(packsDir, id, "index.ts"), root, path, opts, [packBoundary(root, join(packsDir, id))]));
      list.push({ id, name: id, url: `./${path}` });
    } catch (e) {
      list.push({ id, name: id, url: `./${path}`, error: String(e instanceof Error ? e.message : e).slice(0, 800) });
    }
  }
  out.push({ path: "packs.json", type: "application/json", body: JSON.stringify({ name: "built-in", packs: list }, null, 2) });
  return out;
}
