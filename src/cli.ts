/**
 * Unified CLI entry point for pteraworld build tooling.
 *
 * Usage: bun run src/cli.ts <command> [options]
 *
 * Commands:
 *   build              Build all collections (or --collection <id> for one)
 *   graph [dirs...]     Generate graph for specified dirs
 *   headings [dirs...]  Extract headings for search
 *   pages              Generate static HTML content pages
 *   inspect            ASCII layout visualization
 *   dev                Dev server (--production for production mode, --port <n> to override, or PORT env var)
 *   pack <app> <dirs...> --out <dir> --name <name>   Build pack directories and their list (packs.json)
 *
 * Options:
 *   --help             Show this help
 *   --collection <id>  Build only this collection (for build command)
 */
import { mkdir, cp, rm } from "fs/promises";
import { dirname, join, resolve } from "path";
import { generateGraph } from "./gen-graph";
import { generateHeadings } from "./gen-headings";
import { generatePages } from "./gen-pages";
import { buildApp, buildPacks } from "./app-build";
import { writeServiceWorker } from "./sw/build";
import { siteConfig, type AppConfig, type AppId, type CollectionId } from "./site-config";

const args = Bun.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`Usage: bun run src/cli.ts <command> [options]

Commands:
  build              Build all collections (or --collection <id> for one)
  graph [dirs...]     Generate graph for specified dirs
  headings [dirs...]  Extract headings for search
  pages              Generate static HTML content pages
  inspect            ASCII layout visualization
  dev                Dev server (--production for production mode, --port <n> to override, or PORT env var)
  pack <app> <dirs...> --out <dir> --name <name>
                     Build pack directories (each with an index.ts) and the list naming
                     them with their hashes. Publish the whole --out directory; players
                     add the packs.json URL

Options:
  --help             Show this help
  --collection <id>  Build only this collection (for build command)`);
}

if (!command || command === "--help") {
  printHelp();
  process.exit(0);
}

async function buildCollection(id: CollectionId): Promise<void> {
  const config = siteConfig.collections[id];
  const prefix = id === "default" ? "" : id;
  const outDir = prefix ? `dist/${prefix}` : "dist";

  console.log(`\n=== Building collection: ${config.name} (${id}) ===`);

  // 1. Generate graph
  console.log(`\nGenerating graph for [${config.contentDirs.join(", ")}]...`);
  const data = await generateGraph(config.contentDirs, id);

  // 2. Generate headings
  const headingsPath = join(outDir, "headings.json");
  await mkdir(outDir, { recursive: true });
  console.log(`\nGenerating headings → ${headingsPath}...`);
  await generateHeadings(config.contentDirs, headingsPath);

  // 3. Graph data, loaded by the shared page script
  await Bun.write(join(outDir, "graph.json"), JSON.stringify(data));
}

/** The page script every collection shares; each page loads its collection's graph.json. */
async function bundlePageScript(): Promise<void> {
  console.log("\nBundling → dist/main.js...");
  const result = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: "dist",
    minify: true,
  });
  if (!result.success) {
    console.error("Bundle failed:", result.logs);
    process.exit(1);
  }
}

async function buildAll(collectionFilter?: CollectionId): Promise<void> {
  const collections = collectionFilter
    ? { [collectionFilter]: siteConfig.collections[collectionFilter] }
    : siteConfig.collections;

  // A full build is the whole deploy, so nothing from an earlier build may remain in it.
  if (!collectionFilter) await rm("dist", { recursive: true, force: true });

  // Static files first; everything generated below overwrites them.
  await cp("public", "dist", { recursive: true });

  // Build each collection: gen-graph → gen-headings → bundle
  for (const id of Object.keys(collections) as CollectionId[]) {
    await buildCollection(id);
  }
  await bundlePageScript();

  // After all collections are built, restore generated-graph.ts to the default
  // collection so dev server and tooling see the correct data.
  if (!collectionFilter) {
    const def = siteConfig.collections.default;
    await generateGraph(def.contentDirs, "default");
  }

  // Generate content pages (shared, once)
  console.log("\nGenerating content pages...");
  await generatePages();

  if (!collectionFilter) {
    const packs = await buildApps();
    await writeServiceWorker("dist", packs);
  }

  console.log("\nBuild complete.");
}

/** Returns the URL keys of every pack module, which the player's pack store versions itself. */
async function buildApps(): Promise<Set<string>> {
  const packs = new Set<string>();
  for (const [id, app] of Object.entries(siteConfig.apps) as [AppId, AppConfig][]) {
    const outDir = `dist/${id}`;
    console.log(`\nBundling app ${app.name} → ${outDir}/...`);
    await cp(`public/${id}`, outDir, { recursive: true });
    try {
      const { outputs, failed } = await buildApp(app, { minify: true });
      if (failed.length) {
        for (const f of failed) console.error(`pack ${f.id} failed to build:\n${f.error}\n`);
        console.error(`Bundle failed: ${failed.length} pack${failed.length > 1 ? "s" : ""} of ${app.name} didn't build.`);
        process.exit(1);
      }
      for (const o of outputs) {
        await Bun.write(join(outDir, o.path), o.body);
        if (o.pack) packs.add(`/${id}/${o.path}`);
      }
    } catch (e) {
      console.error("Bundle failed:", e);
      process.exit(1);
    }
  }
  return packs;
}

switch (command) {
  case "build": {
    const colIdx = args.indexOf("--collection");
    const collectionId = colIdx !== -1 ? args[colIdx + 1] as CollectionId : undefined;
    if (collectionId && !(collectionId in siteConfig.collections)) {
      console.error(`Unknown collection: ${collectionId}`);
      console.error(`Available: ${Object.keys(siteConfig.collections).join(", ")}`);
      process.exit(1);
    }
    await buildAll(collectionId);
    break;
  }

  case "graph": {
    const colIdx = args.indexOf("--collection");
    const collectionId = colIdx !== -1 ? args[colIdx + 1] as CollectionId : undefined;
    const dirs = collectionId
      ? siteConfig.collections[collectionId].contentDirs
      : args.slice(1).filter((a) => !a.startsWith("-"));
    await generateGraph(dirs.length > 0 ? dirs : undefined, collectionId);
    break;
  }

  case "headings": {
    const dirs = args.slice(1).filter((a) => !a.startsWith("-"));
    await generateHeadings(dirs.length > 0 ? dirs : undefined);
    break;
  }

  case "pages": {
    await generatePages();
    break;
  }

  case "pack": {
    const flag = (name: string): string | undefined => {
      const i = args.indexOf(name);
      return i === -1 ? undefined : args[i + 1];
    };
    const out = flag("--out");
    const name = flag("--name");
    const positional = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !["--out", "--name"].includes(all[i - 1]!));
    const [appId, ...dirs] = positional;
    const app = siteConfig.apps[appId as AppId] as AppConfig | undefined;
    if (!app || !out || !name || !dirs.length) {
      console.error(`Usage: bun run src/cli.ts pack <app> <dirs...> --out <dir> --name <name>\nApps: ${Object.keys(siteConfig.apps).join(", ")}`);
      process.exit(1);
    }
    const { outputs, failed } = await buildPacks(dirs.map((d) => resolve(d)), resolve(import.meta.dir, "..", dirname(app.entry)), "", name, { minify: true });
    for (const o of outputs) await Bun.write(join(out, o.path), o.body);
    for (const f of failed) console.error(`pack ${f.id} failed to build:\n${f.error}\n`);
    console.log(`${outputs.length - 1} pack(s) and packs.json → ${out}`);
    if (failed.length) process.exit(1);
    break;
  }

  case "inspect": {
    // Delegate to inspect-layout.ts (it reads generated-graph.ts)
    const proc = Bun.spawn(["bun", "run", "src/inspect-layout.ts"], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await proc.exited;
    process.exit(exitCode);
    break;
  }

  case "dev": {
    // Delegate to dev.ts
    const devArgs = args.slice(1);
    const proc = Bun.spawn(["bun", "run", "src/dev.ts", ...devArgs], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await proc.exited;
    process.exit(exitCode);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
