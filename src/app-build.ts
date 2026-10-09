import { readdirSync, existsSync } from "fs";
import { basename, join, dirname, relative, resolve } from "path";
import type { BunPlugin } from "bun";
import type { AppConfig } from "./site-config";
import { packHash, type PackList } from "./games/core/mods";

export interface AppOutput {
  /** Path relative to the app's URL root, e.g. "main.js", "packs/sudoku/index.js", "packs.json". */
  path: string;
  body: Blob | string;
  type: string;
  /** A loadable pack module, which the player's pack store versions on its own. */
  pack?: boolean;
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
  "core/anim.ts",
  "core/define.ts",
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
      build.onResolve({ filter: /^\.{0,2}\// }, (args) => {
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

async function bundle(entry: string, root: string, outName: string, opts: { minify: boolean }, plugins: BunPlugin[] = []): Promise<AppOutput> {
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
  return { path: outName, body: o, type: o.type };
}

/**
 * Bundle pack directories (each with an index.ts) into self-contained modules (one file, no
 * shared chunks, loadable from anywhere) at `<base><id>/index.js`, plus their list at `packs.json`: the
 * manifest naming every pack with its hash, in the given order. `root` is the app root the
 * packs may reach into (see PACK_SDK). A pack that fails to build is listed with its error and
 * never takes the others down; `failed` names every such pack.
 */
export async function buildPacks(dirs: string[], root: string, base: string, listName: string, opts: { minify: boolean }): Promise<{ outputs: AppOutput[]; failed: { id: string; error: string }[] }> {
  const out: AppOutput[] = [];
  const list: PackList["packs"] = [];
  const failed: { id: string; error: string }[] = [];
  for (const dir of dirs) {
    const id = basename(dir);
    const path = `${base}${id}/index.js`;
    try {
      const o = await bundle(join(dir, "index.ts"), root, path, opts, [packBoundary(root, dir)]);
      out.push({ ...o, pack: true });
      list.push({ id, name: id, url: `./${path}`, hash: await packHash(await new Response(o.body).arrayBuffer()) });
    } catch (e) {
      const error = String(e instanceof Error ? e.message : e);
      failed.push({ id, error });
      list.push({ id, name: id, url: `./${path}`, error: error.slice(0, 800) });
    }
  }
  const manifest: PackList = { name: listName, packs: list };
  out.push({ path: "packs.json", type: "application/json", body: JSON.stringify(manifest, null, 2) });
  return { outputs: out, failed };
}

/** Bundle an app: the engine entry on its own, and every pack directory through buildPacks. */
export async function buildApp(app: AppConfig, opts: { minify: boolean }): Promise<{ outputs: AppOutput[]; failed: { id: string; error: string }[] }> {
  const root = resolve(dirname(app.entry));
  const packsDir = app.packs ? resolve(app.packs) : "";
  const packDirs = packsDir && existsSync(packsDir)
    ? readdirSync(packsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(packsDir, d.name, "index.ts"))).map((d) => join(packsDir, d.name)).sort()
    : [];
  const packs = await buildPacks(packDirs, root, `${relative(root, packsDir)}/`, "built-in", opts);
  return { outputs: [await bundle(app.entry, root, "main.js", opts), ...packs.outputs], failed: packs.failed };
}
