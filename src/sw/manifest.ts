import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";
import { keyForFile, type SwManifest } from "./routes";

/** Files left out of the manifest. */
export interface ManifestOptions {
  /** Keys of the worker itself and of files whose caching belongs to other code. */
  exclude: ReadonlySet<string>;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

/** Lists every file under `root` except `exclude`, with a version that is a digest of their keys and bytes. */
export function buildManifest(root: string, opts: ManifestOptions): SwManifest {
  const entries = walk(root)
    .map((p) => ({ path: p, key: keyForFile(relative(root, p).split(sep).join("/")) }))
    .filter((e) => !opts.exclude.has(e.key))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const hash = new Bun.CryptoHasher("sha256");
  for (const e of entries) {
    hash.update(e.key);
    hash.update("\0");
    hash.update(readFileSync(e.path));
    hash.update("\0");
  }
  return { version: hash.digest("hex").slice(0, 16), files: entries.map((e) => e.key) };
}
