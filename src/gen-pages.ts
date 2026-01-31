import { readdir, mkdir } from "node:fs/promises";
import { parseMarkdown } from "./markdown";
import { createGraph } from "./graph";

const graph = createGraph();
const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

function pageHtml(
  id: string,
  title: string,
  description: string,
  body: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ptera</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="https://ptera.world/${id}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="ptera.world">
  <meta name="description" content="${description}">
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
${body}
  </article>
</body>
</html>`;
}

const contentDir = "public/content";
const files = await readdir(contentDir);

let count = 0;
for (const file of files) {
  if (!file.endsWith(".md")) continue;
  const id = file.slice(0, -3);
  const md = await Bun.file(`${contentDir}/${file}`).text();
  const html = parseMarkdown(md);

  const node = nodeMap.get(id);
  const title = node?.label ?? id;
  const description = node?.description ?? "";

  const outDir = `dist/${id}`;
  await mkdir(outDir, { recursive: true });
  await Bun.write(`${outDir}/index.html`, pageHtml(id, title, description, html));
  count++;
}

console.log(`generated ${count} content pages`);
