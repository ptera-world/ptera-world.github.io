import { parseMarkdown } from "./markdown";
import { createGraph } from "./graph";
import { siteConfig } from "./site-config";

const isProduction = Bun.argv.includes("--production");

const dir = isProduction ? "dist" : "public";

const graph = createGraph();
const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

function contentPage(id: string, html: string): string {
  const node = nodeMap.get(id);
  const title = node?.label ?? id;
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
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;

    // In dev, serve TS files as bundled JS
    if (!isProduction && path === "/main.js") {
      const result = await Bun.build({
        entrypoints: ["src/main.ts"],
        target: "browser",
      });
      const output = result.outputs[0];
      if (output) {
        return new Response(output.stream(), {
          headers: { "Content-Type": "application/javascript" },
        });
      }
    }

    const file = Bun.file(dir + path);
    if (await file.exists()) {
      return new Response(file);
    }

    // Fallback: try serving as a content page (supports category/slug paths)
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
