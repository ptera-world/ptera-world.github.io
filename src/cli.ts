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
 *
 * Options:
 *   --help             Show this help
 *   --collection <id>  Build only this collection (for build command)
 */
import { mkdir, cp } from "fs/promises";
import { join } from "path";
import { generateGraph } from "./gen-graph";
import { generateHeadings } from "./gen-headings";
import { generatePages } from "./gen-pages";
import { buildApp } from "./app-build";
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
  await generateGraph(config.contentDirs, id);

  // 2. Generate headings
  const headingsPath = join(outDir, "headings.json");
  await mkdir(outDir, { recursive: true });
  console.log(`\nGenerating headings → ${headingsPath}...`);
  await generateHeadings(config.contentDirs, headingsPath);

  // 3. Bundle JS
  const jsOutDir = prefix ? `dist/${prefix}` : "dist";
  console.log(`\nBundling → ${jsOutDir}/main.js...`);
  const result = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: jsOutDir,
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

  // Build each collection: gen-graph → gen-headings → bundle
  for (const id of Object.keys(collections) as CollectionId[]) {
    await buildCollection(id);
  }

  // After all collections are built, restore generated-graph.ts to the default
  // collection so dev server and tooling see the correct data.
  if (!collectionFilter) {
    const def = siteConfig.collections.default;
    await generateGraph(def.contentDirs, "default");
  }

  // Generate content pages (shared, once)
  console.log("\nGenerating content pages...");
  await generatePages();

  // Copy static assets
  console.log("\nCopying static assets...");
  await cp("public/style.css", "dist/style.css");
  await cp("public/favicon.svg", "dist/favicon.svg");
  await cp("public/index.html", "dist/index.html");

  // Copy collection entry points
  for (const id of Object.keys(collections) as CollectionId[]) {
    if (id === "default") continue;
    const srcHtml = `public/${id}/index.html`;
    const destDir = `dist/${id}`;
    await mkdir(destDir, { recursive: true });
    await cp(srcHtml, `${destDir}/index.html`);
  }

  if (!collectionFilter) await buildApps();

  console.log("\nBuild complete.");
}

async function buildApps(): Promise<void> {
  for (const [id, app] of Object.entries(siteConfig.apps) as [AppId, AppConfig][]) {
    const outDir = `dist/${id}`;
    console.log(`\nBundling app ${app.name} → ${outDir}/...`);
    await cp(`public/${id}`, outDir, { recursive: true });
    try {
      for (const o of await buildApp(app, { minify: true })) await Bun.write(join(outDir, o.path), o.body);
    } catch (e) {
      console.error("Bundle failed:", e);
      process.exit(1);
    }
  }
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
