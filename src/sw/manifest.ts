import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";
import { fileHash, keyForFile, type SwManifest } from "./routes";

/** Files left out of the manifest. */
export interface ManifestOptions {
  /** Keys of the worker itself and of files whose caching belongs to other code. */
  exclude: ReadonlySet<string>;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

/** Every file under `root` except `exclude`, with its hash; the version is a digest of all of them. */
export async function buildManifest(root: string, opts: ManifestOptions): Promise<SwManifest> {
  const entries = walk(root)
    .map((p) => ({ path: p, key: keyForFile(relative(root, p).split(sep).join("/")) }))
    .filter((e) => !opts.exclude.has(e.key))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const files: Record<string, string> = {};
  for (const e of entries) files[e.key] = await fileHash(readFileSync(e.path));
  const version = await fileHash(new TextEncoder().encode(JSON.stringify(files)));
  return { version, files };
}
