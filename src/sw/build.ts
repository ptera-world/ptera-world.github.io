import { join } from "path";
import { buildManifest } from "./manifest";

/**
 * Writes `<root>/sw.js` for the files currently under `root`. Call after everything else in
 * `root` is final; `exclude` holds the keys of files the worker must leave alone.
 */
export async function writeServiceWorker(root: string, exclude: ReadonlySet<string>): Promise<void> {
  const manifest = await buildManifest(root, { exclude: new Set([...exclude, "/sw.js"]) });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "worker.ts")],
    target: "browser",
    minify: true,
    define: { __MANIFEST__: JSON.stringify(manifest) },
  });
  if (!result.success) throw new AggregateError(result.logs, result.logs.map(String).join("\n"));
  await Bun.write(join(root, "sw.js"), result.outputs[0]!);
  console.log(`service worker ${manifest.version}: ${Object.keys(manifest.files).length} files`);
}
