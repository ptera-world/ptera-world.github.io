import { parseMarkdown } from "./markdown";
import { createGraph, type GraphData } from "./graph";
import { generatedNodes, generatedEdges } from "./generated-graph";
import { siteConfig, type CollectionId } from "./site-config";
import { generateGraph } from "./gen-graph";
import { buildApp, skippedWarning, type AppOutput } from "./app-build";

const appCache = new Map<string, Map<string, AppOutput>>();

const isProduction = Bun.argv.includes("--production");

const portArgIdx = Bun.argv.indexOf("--port");
const portArg = portArgIdx !== -1 ? Number(Bun.argv[portArgIdx + 1]) : undefined;
const port = portArg ?? (Bun.env.PORT ? Number(Bun.env.PORT) : 3000);

const dir = isProduction ? "dist" : "public";

// In dev mode, generate each collection's graph data at startup and bundle the page script once
const dataCache = new Map<string, GraphData>();
let pageScript: ArrayBuffer | null = null;

if (!isProduction) {
  for (const [id, config] of Object.entries(siteConfig.collections) as [CollectionId, typeof siteConfig.collections[CollectionId]][]) {
    console.log(`Generating graph for ${config.name} [${config.contentDirs.join(", ")}]...`);
    dataCache.set(id === "default" ? "/graph.json" : `/${id}/graph.json`, await generateGraph(config.contentDirs, id));
  }
  const result = await Bun.build({ entrypoints: ["src/main.ts"], target: "browser" });
  if (result.outputs[0]) pageScript = await result.outputs[0].arrayBuffer();
}

const graph = isProduction ? createGraph({ nodes: generatedNodes, edges: generatedEdges }) : null;
const nodeMap = graph ? new Map(graph.nodes.map((n) => [n.id, n])) : null;

function contentPage(id: string, html: string): string {
  const title = nodeMap?.get(id)?.label ?? id;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${siteConfig.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      background: #0a0a0a; color: #ddd;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6; font-size: 16px;
    }
    nav {
      padding: 16px 24px; border-bottom: 1px solid #222;
      display: flex; justify-content: space-between; align-items: center;
    }
    nav a { color: #6a9; text-decoration: none; font-size: 14px; }
    nav a:hover { text-decoration: underline; }
    article {
      max-width: 680px; margin: 0 auto; padding: 32px 24px 64px;
    }
    h1 { font-size: 28px; color: #fff; margin: 24px 0 12px; }
    h2 { font-size: 22px; color: #eee; margin: 28px 0 10px; }
    h3 { font-size: 17px; color: #ddd; margin: 20px 0 8px; }
    p { margin: 0 0 14px; color: #bbb; }
    a { color: #6a9; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { margin: 0 0 14px; padding-left: 24px; }
    li { margin: 4px 0; color: #bbb; }
    code {
      background: #1a1a1a; padding: 1px 5px; border-radius: 3px;
      font-size: 14px; color: #ccc;
    }
    pre {
      background: #111; border: 1px solid #333; border-radius: 6px;
      padding: 14px; overflow-x: auto; margin: 0 0 14px;
    }
    pre code { background: none; padding: 0; }
    hr { border: none; border-top: 1px solid #333; margin: 20px 0; }
    strong { color: #ddd; }
  </style>
</head>
<body>
  <nav>
    <a href="/">← back to map</a>
    <a href="/?focus=${id}">view on map</a>
  </nav>
  <article>
${html}
  </article>
</body>
</html>`;
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    for (const [id, app] of Object.entries(siteConfig.apps)) {
      if (path === `/${id}`) return Response.redirect(`/${id}/${url.search}`, 302);
      if (path === `/${id}/`) path = `/${id}/index.html`;
      if (!isProduction && path.startsWith(`/${id}/`)) {
        const rel = path.slice(id.length + 2);
        // rebuilt when the entry script is requested, so a reload picks up source changes
        if (rel === "main.js" || !appCache.has(id)) {
          try {
            const { outputs, failed, skipped } = await buildApp(app, { minify: false });
            if (skipped.length) console.warn(`[dev] warning: ${skippedWarning(app.name, skipped)}`);
            for (const f of failed) console.error(`[dev] pack ${f.id} failed to build:\n${f.error}`);
            appCache.set(id, new Map(outputs.map((o) => [o.path, o])));
          } catch (e) {
            return new Response(String(e instanceof AggregateError ? e.errors.join("\n") : e), { status: 500 });
          }
        }
        const hit = appCache.get(id)!.get(rel);
        if (hit) return new Response(hit.body, { headers: { "Content-Type": hit.type } });
      }
    }

    // Detect collection from path prefix
    let collectionId: CollectionId = "default";
    for (const id of Object.keys(siteConfig.collections) as CollectionId[]) {
      if (id !== "default" && (path === `/${id}` || path === `/${id}/` || path.startsWith(`/${id}/`))) {
        collectionId = id;
        break;
      }
    }

    // Serve collection entry points
    if (collectionId !== "default" && (path === `/${collectionId}` || path === `/${collectionId}/`)) {
      path = `/${collectionId}/index.html`;
    } else if (path === "/") {
      path = "/index.html";
    }

    // The page script (shared by every collection) and each collection's graph data
    if (!isProduction) {
      if (path === "/main.js" && pageScript) return new Response(pageScript, { headers: { "Content-Type": "application/javascript" } });
      const data = dataCache.get(path);
      if (data) return Response.json(data);
    }

    const file = Bun.file(dir + path);
    if (await file.exists()) {
      return new Response(file);
    }

    // Fallback: try serving as a content page
    const slug = path.replace(/^\/|\/$/g, "");
    if (slug) {
      const mdFile = Bun.file(`${dir}/content/${slug}.md`);
      if (await mdFile.exists()) {
        const md = await mdFile.text();
        const html = parseMarkdown(md);
        return new Response(contentPage(slug, html), {
          headers: { "Content-Type": "text/html" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`listening on http://localhost:${server.port}`);
