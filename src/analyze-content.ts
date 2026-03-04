/**
 * analyze-content.ts - content graph metrics and analysis.
 * Usage: bun run src/analyze-content.ts [command]
 *
 * Commands:
 *   degree      Node degree (total connections), sorted by count
 *   central     Betweenness centrality (nodes that bridge clusters)
 *   essays      Essay-specific analysis: degree, inter-essay links, project links
 *   neighbors   List neighbors of a node:  neighbors <id>
 *   paths       Shortest path between two nodes:  paths <id> <id>
 */

import { generatedNodes, generatedEdges } from "./generated-graph";

// ─────────────────────────────────────────────────────────────────────────────
// Graph utilities
// ─────────────────────────────────────────────────────────────────────────────

// Build adjacency: id → Set of neighbor ids
const adj = new Map<string, Set<string>>();
for (const n of generatedNodes) adj.set(n.id, new Set());
for (const e of generatedEdges) {
  adj.get(e.from)?.add(e.to);
  adj.get(e.to)?.add(e.from);
}

function degree(id: string): number {
  return adj.get(id)?.size ?? 0;
}

/** BFS shortest path. Returns node id list or null if unreachable. */
function bfs(from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const queue = [from];
  prev.set(from, "");
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path: string[] = [];
        let n: string = to;
        while (n) { path.unshift(n); n = prev.get(n)!; }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Approximate betweenness centrality via BFS from every node.
 * Returns map of id → centrality score (count of shortest paths passing through).
 */
function betweenness(): Map<string, number> {
  const scores = new Map<string, number>();
  for (const n of generatedNodes) scores.set(n.id, 0);

  const ids = generatedNodes.map((n) => n.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const path = bfs(ids[i]!, ids[j]!);
      if (!path || path.length <= 2) continue;
      // Increment all interior nodes
      for (let k = 1; k < path.length - 1; k++) {
        scores.set(path[k]!, (scores.get(path[k]!)! ?? 0) + 1);
      }
    }
  }
  return scores;
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

function nodeById(id: string) {
  // Allow partial match
  return generatedNodes.find((n) => n.id === id || n.id.endsWith("/" + id));
}

function fmt(id: string): string {
  const n = generatedNodes.find((n) => n.id === id);
  return n ? `${id} "${n.label}"` : id;
}

switch (cmd ?? "degree") {

  case "degree": {
    const sorted = [...generatedNodes]
      .map((n) => ({ n, d: degree(n.id) }))
      .sort((a, b) => b.d - a.d);

    const filterTag = args[0]; // optional tag filter e.g. "meta", "essay"
    const rows = filterTag ? sorted.filter((r) => r.n.tags.includes(filterTag)) : sorted;

    console.log(`\nDegree (connections) — ${filterTag ? `tag:${filterTag}` : "all nodes"}\n`);
    for (const { n, d } of rows) {
      if (d === 0) continue;
      console.log(`  ${String(d).padStart(3)}  ${n.id.padEnd(55)} "${n.label}"`);
    }
    break;
  }

  case "central": {
    console.log("\nComputing betweenness centrality (may take a moment)...");
    const scores = betweenness();
    const sorted = [...scores.entries()]
      .filter(([, s]) => s > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 30);

    console.log("\nBetweenness centrality — top 30\n");
    for (const [id, score] of sorted) {
      const n = generatedNodes.find((n) => n.id === id)!;
      console.log(`  ${String(score).padStart(5)}  ${id.padEnd(55)} "${n.label}"`);
    }
    break;
  }

  case "essays": {
    const essays = generatedNodes.filter((n) => n.tags.includes("essay"));
    const essayIds = new Set(essays.map((e) => e.id));

    const rows = essays
      .map((e) => {
        const neighbors = [...(adj.get(e.id) ?? [])];
        const interEssay = neighbors.filter((id) => essayIds.has(id));
        const projects = neighbors.filter((id) => !essayIds.has(id) && !generatedNodes.find((n) => n.id === id)?.tags.includes("meta"));
        return { e, total: neighbors.length, interEssay: interEssay.length, projects: projects.length };
      })
      .sort((a, b) => b.total - a.total);

    console.log(`\nEssay connectivity (${essays.length} total)\n`);
    console.log("  total  essay  proj  title");
    for (const { e, total, interEssay, projects } of rows) {
      console.log(`  ${String(total).padStart(5)}  ${String(interEssay).padStart(5)}  ${String(projects).padStart(4)}  "${e.label}"`);
    }
    break;
  }

  case "cluster": {
    // Zoomed ASCII view of a named cluster with edges and collision info
    // Usage: cluster essays | cluster rhi | cluster exo | cluster orphans
    const clusterName = args[0] ?? "essays";

    let clusterNodes: (typeof generatedNodes);
    if (clusterName === "essays") {
      clusterNodes = generatedNodes.filter((n) => n.tags.includes("essay"));
    } else if (clusterName === "orphans") {
      clusterNodes = generatedNodes.filter((n) => !n.tags.includes("meta") && !n.parent && !n.tags.includes("essay"));
    } else {
      // Try as cluster id: collect all nodes with matching cluster value
      clusterNodes = generatedNodes.filter((n) => n.cluster === clusterName);
      if (clusterNodes.length === 0) { console.error(`Unknown cluster: ${clusterName}`); process.exit(1); }
    }

    if (clusterNodes.length === 0) { console.log("No nodes in cluster."); break; }

    // Canvas dimensions
    const CW = 120, CH = 55;
    const CHAR_ASPECT = 2.0; // terminal chars ~2x taller than wide
    const pad = 40;

    const cxs = clusterNodes.map((n) => n.x);
    const cys = clusterNodes.map((n) => n.y);
    let cMinX = Math.min(...cxs) - pad, cMaxX = Math.max(...cxs) + pad;
    let cMinY = Math.min(...cys) - pad, cMaxY = Math.max(...cys) + pad;

    // Enforce aspect ratio so circles look right
    const worldW = cMaxX - cMinX;
    const worldH = cMaxY - cMinY;
    const scaleX = (CW - 1) / worldW;
    const scaleY = (CH - 1) / worldH;
    // If x scale >> y scale, pad y to match
    if (scaleX / CHAR_ASPECT > scaleY) {
      const targetH = worldW / CHAR_ASPECT * (CH - 1) / (CW - 1);
      const pad2 = (targetH - worldH) / 2;
      cMinY -= pad2; cMaxY += pad2;
    } else {
      const targetW = worldH * CHAR_ASPECT * (CW - 1) / (CH - 1);
      const pad2 = (targetW - worldW) / 2;
      cMinX -= pad2; cMaxX += pad2;
    }

    const sX = (CW - 1) / (cMaxX - cMinX);
    const sY = (CH - 1) / (cMaxY - cMinY);

    function tc(wx: number, wy: number): [number, number] {
      return [Math.round((wx - cMinX) * sX), Math.round((wy - cMinY) * sY)];
    }

    const cbg: string[][] = Array.from({ length: CH }, () => Array(CW).fill(" "));
    function cp(cx: number, cy: number, ch: string, force = false) {
      if (cx < 0 || cx >= CW || cy < 0 || cy >= CH) return;
      if (cbg[cy]![cx] === " " || force) cbg[cy]![cx] = ch;
    }

    // Draw edges between cluster nodes
    const clusterIds = new Set(clusterNodes.map((n) => n.id));
    for (const a of clusterNodes) {
      for (const bid of adj.get(a.id) ?? []) {
        if (!clusterIds.has(bid) || bid < a.id) continue;
        const b = generatedNodes.find((n) => n.id === bid)!;
        const [ax, ay] = tc(a.x, a.y);
        const [bx, by] = tc(b.x, b.y);
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
        for (let s = 1; s < steps; s++) {
          const ex = Math.round(ax + (bx - ax) * s / steps);
          const ey = Math.round(ay + (by - ay) * s / steps);
          cp(ex, ey, "·");
        }
      }
    }

    // Draw node dots and labels (3 chars of label)
    for (const n of clusterNodes) {
      const [cx, cy] = tc(n.x, n.y);
      const short = n.label.slice(0, 3).padEnd(3);
      cp(cx - 1, cy, short[0]!, true);
      cp(cx,     cy, short[1]!, true);
      cp(cx + 1, cy, short[2]!, true);
    }

    console.log(`\nCluster: ${clusterName}  (${clusterNodes.length} nodes)  scale: ${(1/sX).toFixed(1)} wu/col  ${(1/sY).toFixed(1)} wu/row\n`);
    console.log("┌" + "─".repeat(CW) + "┐");
    for (const row of cbg) console.log("│" + row.join("") + "│");
    console.log("└" + "─".repeat(CW) + "┘");

    // Collision report for this cluster
    const MIN_DOT_GAP = 10;
    type CPair = { a: (typeof generatedNodes)[0]; b: (typeof generatedNodes)[0]; overlap: number };
    const overlaps: CPair[] = [];
    for (let i = 0; i < clusterNodes.length; i++) {
      for (let j = i + 1; j < clusterNodes.length; j++) {
        const a = clusterNodes[i]!, b = clusterNodes[j]!;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const minD = a.radius + b.radius + MIN_DOT_GAP;
        if (dist < minD) overlaps.push({ a, b, overlap: minD - dist });
      }
    }
    overlaps.sort((a, b) => b.overlap - a.overlap);

    if (overlaps.length === 0) {
      console.log(`\n  ✓ No overlaps (min gap ${MIN_DOT_GAP}px)\n`);
    } else {
      console.log(`\n  ${overlaps.length} overlapping pairs (gap < ${MIN_DOT_GAP}px):`);
      for (const { a, b, overlap } of overlaps.slice(0, 10)) {
        console.log(`    ▲ ${overlap.toFixed(0).padStart(3)}px  "${a.label}"  ↔  "${b.label}"`);
      }
      if (overlaps.length > 10) console.log(`    ... and ${overlaps.length - 10} more`);
      console.log();
    }

    // Degree summary for this cluster
    const degRows = clusterNodes
      .map((n) => ({ n, d: [...(adj.get(n.id) ?? [])].filter((id) => clusterIds.has(id)).length }))
      .sort((a, b) => b.d - a.d)
      .slice(0, 10);
    console.log(`  Top connected (within cluster):`);
    for (const { n, d } of degRows) {
      console.log(`    ${String(d).padStart(3)}  "${n.label}"`);
    }
    console.log();
    break;
  }

  case "neighbors": {
    const id = args[0];
    if (!id) { console.error("Usage: neighbors <id>"); process.exit(1); }
    const node = nodeById(id);
    if (!node) { console.error(`Node not found: ${id}`); process.exit(1); }

    const neighbors = [...(adj.get(node.id) ?? [])].sort();
    console.log(`\nNeighbors of ${fmt(node.id)} (${neighbors.length})\n`);
    for (const nid of neighbors) {
      const n = generatedNodes.find((n) => n.id === nid)!;
      console.log(`  ${nid.padEnd(55)} "${n.label}"`);
    }
    break;
  }

  case "paths": {
    const [fromId, toId] = args;
    if (!fromId || !toId) { console.error("Usage: paths <id> <id>"); process.exit(1); }
    const a = nodeById(fromId);
    const b = nodeById(toId);
    if (!a) { console.error(`Not found: ${fromId}`); process.exit(1); }
    if (!b) { console.error(`Not found: ${toId}`); process.exit(1); }

    const path = bfs(a.id, b.id);
    if (!path) {
      console.log(`\nNo path between ${a.id} and ${b.id}\n`);
    } else {
      console.log(`\nShortest path (${path.length - 1} hops): ${a.id} → ${b.id}\n`);
      for (const id of path) {
        const n = generatedNodes.find((n) => n.id === id)!;
        console.log(`  ${id.padEnd(55)} "${n.label}"`);
      }
    }
    break;
  }

  case "links": {
    // Scan all markdown files for [text](/prose/slug#anchor) links and verify
    // that the target file exists and the target heading slug exists in it.
    const contentDir = new URL("../public/content", import.meta.url).pathname;
    const fs = await import("fs");
    const path = await import("path");

    /** Heading text → slug (matches GitHub/CommonMark: lowercase, spaces→hyphens, strip non-alphanum except hyphens) */
    function headingSlug(text: string): string {
      return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")   // strip punctuation (apostrophes, quotes, etc.)
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    }

    /** Read a file and return Set of heading slugs */
    function getSlugs(filePath: string): Set<string> {
      const text = fs.readFileSync(filePath, "utf8");
      const slugs = new Set<string>();
      for (const line of text.split("\n")) {
        const m = line.match(/^#{1,6}\s+(.+)$/);
        if (m) slugs.add(headingSlug(m[1]!));
      }
      return slugs;
    }

    /** Find all .md files recursively */
    function walk(dir: string): string[] {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...walk(full));
        else if (entry.name.endsWith(".md")) results.push(full);
      }
      return results;
    }

    const allFiles = walk(contentDir);
    // Cache slugs per file path (lazy)
    const slugCache = new Map<string, Set<string>>();
    function slugsFor(fp: string): Set<string> {
      if (!slugCache.has(fp)) slugCache.set(fp, getSlugs(fp));
      return slugCache.get(fp)!;
    }

    type BrokenLink = { sourceFile: string; linkText: string; href: string; reason: string };
    const broken: BrokenLink[] = [];
    // Link pattern: [text](/path#anchor) or [text](#anchor)
    const linkRe = /\[([^\]]*)\]\(((?:\/[^)#\s]*)?#([^)\s]+))\)/g;

    for (const srcFile of allFiles) {
      const text = fs.readFileSync(srcFile, "utf8");
      // Determine this file's slug (relative to contentDir)
      const relSrc = path.relative(contentDir, srcFile).replace(/\.md$/, "");

      let m: RegExpExecArray | null;
      linkRe.lastIndex = 0;
      while ((m = linkRe.exec(text)) !== null) {
        const [, linkText, href, anchor] = m as unknown as [string, string, string, string];
        // Determine target file
        let targetRel: string;
        if (href.startsWith("/")) {
          targetRel = href.replace(/^\//, "").replace(/#.*$/, ""); // e.g. "prose/foo"
        } else {
          // Relative anchor only (#anchor) → same file
          targetRel = relSrc;
        }
        const targetFile = path.join(contentDir, targetRel + ".md");
        if (!fs.existsSync(targetFile)) {
          broken.push({ sourceFile: relSrc, linkText, href, reason: `target file not found: ${targetRel}.md` });
          continue;
        }
        const slugs = slugsFor(targetFile);
        const wantSlug = headingSlug(anchor!);
        if (!slugs.has(wantSlug)) {
          broken.push({ sourceFile: relSrc, linkText, href, reason: `heading #${anchor} (→ slug "${wantSlug}") not found` });
        }
      }
    }

    if (broken.length === 0) {
      console.log("\n  ✓ All heading anchors resolve\n");
    } else {
      console.log(`\n  ${broken.length} broken anchor link(s):\n`);
      for (const b of broken) {
        console.log(`  ${b.sourceFile}`);
        console.log(`    [${b.linkText}](${b.href})`);
        console.log(`    → ${b.reason}`);
        console.log();
      }
    }
    break;
  }

  default:
    console.log(`
Usage: bun run src/analyze-content.ts <command>

Commands:
  degree [tag]           Node degree sorted by connections (optional tag filter e.g. "meta", "essay")
  central                Betweenness centrality — nodes that bridge clusters
  essays                 Essay connectivity breakdown (total / inter-essay / project links)
  cluster [name]         Zoomed ASCII view of a cluster with edges + collision info
                         name: essays (default) | rhi | exo | orphans
  neighbors <id>         List all neighbors of a node (partial id ok)
  paths <id> <id>        Shortest path between two nodes
  links                  Scan all markdown files for broken heading anchors
`);
}
