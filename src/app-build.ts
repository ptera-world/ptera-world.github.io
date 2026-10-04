import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { AppConfig } from "./site-config";

export interface AppOutput {
  /** Path relative to the app's URL root, e.g. "main.js", "packs/sudoku/index.js", "packs.json". */
  path: string;
  body: Blob | string;
  type: string;
}

/**
 * Bundle an app: its entry plus every pack directory as separate entry points with shared
 * chunks (so packs and the engine share one copy of core code), and a pack list (packs.json)
 * naming every pack in directory order. Pack ids come from directory names.
 */
export async function buildApp(app: AppConfig, opts: { minify: boolean }): Promise<AppOutput[]> {
  const root = dirname(app.entry);
  const packIds = app.packs && existsSync(app.packs)
    ? readdirSync(app.packs, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(app.packs!, d.name, "index.ts"))).map((d) => d.name).sort()
    : [];
  const result = await Bun.build({
    entrypoints: [app.entry, ...packIds.map((id) => join(app.packs!, id, "index.ts"))],
    root,
    target: "browser",
    splitting: true,
    minify: opts.minify,
    sourcemap: opts.minify ? "none" : "inline",
    naming: { entry: "[dir]/[name].[ext]", chunk: "chunks/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
  });
  if (!result.success) throw new AggregateError(result.logs, "bundle failed");
  const out: AppOutput[] = result.outputs.map((o) => ({ path: o.path.replace(/^(\.\/)+/, ""), body: o, type: o.type }));
  const packsBase = app.packs ? app.packs.slice(root.length).replace(/^\//, "") : "";
  out.push({
    path: "packs.json",
    type: "application/json",
    body: JSON.stringify({ name: "built-in", packs: packIds.map((id) => ({ id, name: id, url: `./${packsBase}/${id}/index.js` })) }, null, 2),
  });
  return out;
}
