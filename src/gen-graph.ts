/**
 * Unified build script: reads frontmatter + edges from public/content/*.md
 * and generates src/generated-graph.ts with node definitions and edges.
 *
 * Replaces gen-edges.ts. Run with: bun run src/gen-graph.ts
 */
import { readdir, readFile, writeFile, stat } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, stripFrontmatter, inferTier, inferTags } from "./frontmatter";

const contentDir = join(import.meta.dir, "../public/content");
const outFile = join(import.meta.dir, "generated-graph.ts");
const groupingsOutFile = join(import.meta.dir, "generated-groupings.ts");

// ---------------------------------------------------------------------------
// 1. Walk content directory
// ---------------------------------------------------------------------------

async function findMarkdownFiles(dir: string, prefix = ""): Promise<{ id: string; path: string; category: string }[]> {
  const entries = await readdir(dir);
  const results: { id: string; path: string; category: string }[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const entryStat = await stat(fullPath);

    if (entryStat.isDirectory()) {
      const subResults = await findMarkdownFiles(fullPath, prefix ? `${prefix}/${entry}` : entry);
      results.push(...subResults);
    } else if (entry.endsWith(".md")) {
      const basename = entry.replace(/\.md$/, "");
      const id = prefix ? `${prefix}/${basename}` : basename;
      const category = prefix.split("/")[0] || "";
      results.push({ id, path: fullPath, category });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. Parse all files
// ---------------------------------------------------------------------------

interface ParsedNode {
  id: string;
  label: string;
  description: string;
  url?: string;
  tier: "region" | "artifact" | "detail" | "meta";
  parent?: string;
  status?: "production" | "fleshed-out" | "early" | "planned";
  tags: string[];
  radius: number;
  color: string;
  // Set later by layout
  x: number;
  y: number;
}

// Content-only directories: files here don't become nodes unless they have tier: in frontmatter
const CONTENT_ONLY_DIRS = new Set(["domain", "technology", "status"]);

const files = await findMarkdownFiles(contentDir);
const nodes: ParsedNode[] = [];
const nodeIds = new Set<string>();

for (const { id, path, category } of files) {
  const text = await readFile(path, "utf-8");
  const fm = parseFrontmatter(text);
  if (!fm) {
    // Content-only dirs without frontmatter are skipped
    if (CONTENT_ONLY_DIRS.has(category)) continue;
    // Other files without frontmatter are also skipped (they need frontmatter to be nodes)
    continue;
  }

  // Skip content-only dirs unless they explicitly set tier
  if (CONTENT_ONLY_DIRS.has(category) && !fm.tier) continue;

  const tier = fm.tier ?? inferTier(category);
  if (!tier) continue; // Can't determine tier — skip

  const autoTags = inferTags(category, tier);
  const userTags = fm.tags ?? [];
  const allTags = [...new Set([...autoTags, ...userTags])];

  const radius = fm.radius ?? radiusFromStatus(fm.status);

  nodes.push({
    id,
    label: fm.label,
    description: fm.description,
    url: fm.url,
    tier,
    parent: fm.parent,
    status: fm.status,
    tags: allTags,
    radius,
    color: fm.color ?? "", // Filled in by layout
    x: 0,
    y: 0,
  });
  nodeIds.add(id);
}

// Also collect content-only pages (domain/technology/status) for grouping regions
interface GroupingRegionDef {
  id: string;
  label: string;
  description: string;
  color: string;
  category: string;
}

const groupingRegions: GroupingRegionDef[] = [];

for (const { id, path, category } of files) {
  if (!CONTENT_ONLY_DIRS.has(category)) continue;
  const text = await readFile(path, "utf-8");
  const fm = parseFrontmatter(text);
  if (!fm) continue;
  groupingRegions.push({
    id,
    label: fm.label,
    description: fm.description,
    color: fm.color ?? "",
    category,
  });
}

function radiusFromStatus(status?: string): number {
  switch (status) {
    case "production": return 30;
    case "fleshed-out": return 26;
    case "early": return 22;
    case "planned": return 20;
    default: return 24; // essays, meta, etc.
  }
}

// ---------------------------------------------------------------------------
// 3. Compute layout: positions and colors
// ---------------------------------------------------------------------------

/** Place nodes evenly on a circle, starting from the top and going clockwise. */
function ringLayout(cx: number, cy: number, r: number, items: ParsedNode[]): void {
  for (let i = 0; i < items.length; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / items.length;
    items[i]!.x = Math.round(cx + r * Math.cos(angle));
    items[i]!.y = Math.round(cy + r * Math.sin(angle));
  }
}

// Separate nodes by type
const regions = nodes.filter((n) => n.tier === "region");
const metaNodes = nodes.filter((n) => n.tier === "meta");
const projectNodes = nodes.filter((n) => n.tier === "artifact");

// --- Region layout: ring around origin ---
const regionHues: Map<string, number> = new Map();
{
  // Assign hues evenly on oklch wheel
  const baseHues = [155, 320]; // rhi=green, exo=pink — extend as regions grow
  regions.forEach((region, i) => {
    const hue = baseHues[i] ?? (360 * i) / regions.length;
    regionHues.set(region.id, hue);
    if (!region.color) {
      region.color = `oklch(0.7 0.12 ${hue})`;
    }
  });

  // Size regions by child count (before positioning, so radii inform spacing)
  for (const region of regions) {
    const children = projectNodes.filter((n) => n.parent === region.id);
    if (region.radius === 24) {
      // Default — compute from child count
      region.radius = Math.max(140, 100 + children.length * 6);
    }
  }

  // Position regions on a ring around origin
  if (regions.length === 1) {
    regions[0]!.x = 0;
    regions[0]!.y = 0;
  } else {
    // Ring radius: enough to keep regions separated
    const maxRadius = Math.max(...regions.map((r) => r.radius));
    const ringR = maxRadius + 100;
    for (let i = 0; i < regions.length; i++) {
      // Start from the left, spread evenly
      const angle = Math.PI + (2 * Math.PI * i) / regions.length;
      regions[i]!.x = Math.round(ringR * Math.cos(angle));
      regions[i]!.y = Math.round(ringR * Math.sin(angle));
    }
  }
}

// --- Children of regions: ring around parent ---
const parentGroups = new Map<string, ParsedNode[]>();
for (const node of projectNodes) {
  if (node.parent) {
    const group = parentGroups.get(node.parent) ?? [];
    group.push(node);
    parentGroups.set(node.parent, group);
  }
}

for (const [parentId, children] of parentGroups) {
  const parent = regions.find((r) => r.id === parentId);
  if (!parent) continue;

  const hue = regionHues.get(parentId) ?? 0;
  // Ring radius based on parent visual radius
  const ringR = Math.max(80, parent.radius + children.length * 2);
  ringLayout(parent.x, parent.y, ringR, children);

  for (const child of children) {
    if (!child.color) {
      child.color = `oklch(0.78 0.09 ${hue})`;
    }
  }
}

// --- Orphan projects (no parent, not essay): cluster ---
const orphans = projectNodes.filter((n) => !n.parent && !n.tags.includes("essay"));
const essays = projectNodes.filter((n) => n.tags.includes("essay"));

// Orphans: spread above and below
{
  const orphanColor = "oklch(0.78 0.09 85)";
  // Place orphans in a ring at a neutral position
  if (orphans.length > 0) {
    // Split into top and bottom clusters for visual balance
    const topOrphans = orphans.slice(0, Math.ceil(orphans.length / 2));
    const bottomOrphans = orphans.slice(Math.ceil(orphans.length / 2));

    if (topOrphans.length > 0) {
      ringLayout(0, -280, 60 + topOrphans.length * 15, topOrphans);
    }
    if (bottomOrphans.length > 0) {
      ringLayout(80, 230, 60 + bottomOrphans.length * 15, bottomOrphans);
    }

    for (const o of orphans) {
      if (!o.color) o.color = orphanColor;
    }
  }
}

// --- Essays: ring cluster ---
{
  const essayHue = 45;
  const essayColor = `oklch(0.78 0.09 ${essayHue})`;
  const essayCenter = { x: 80, y: 40 };

  // Find "the-great-deceit" — it goes in the center
  const centerEssay = essays.find((e) => e.id === "prose/the-great-deceit");
  const ringEssays = essays.filter((e) => e.id !== "prose/the-great-deceit");

  if (ringEssays.length > 0) {
    ringLayout(essayCenter.x, essayCenter.y, 120, ringEssays);
  }
  if (centerEssay) {
    centerEssay.x = essayCenter.x;
    centerEssay.y = essayCenter.y;
  }

  for (const e of essays) {
    if (!e.color) e.color = essayColor;
  }
}

// --- Meta nodes: fixed position ---
for (const meta of metaNodes) {
  meta.x = 0;
  meta.y = -170;
  meta.radius = 0;
  if (!meta.color) meta.color = "#fff";
}

// ---------------------------------------------------------------------------
// 4. Extract edges from ## Related projects / ## See also
// ---------------------------------------------------------------------------

interface EdgeDef {
  from: string;
  to: string;
  strength: number;
}

const seen = new Set<string>();
const edges: EdgeDef[] = [];

for (const { id, path } of files) {
  const text = await readFile(path, "utf-8");
  const body = stripFrontmatter(text);

  const match = body.match(/## (?:Related projects|See also)\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (!match) continue;

  const section = match[1]!;
  const linkPattern = /\[([^\]]+)\]\(\/([^)]+)\)/g;
  let linkMatch;
  while ((linkMatch = linkPattern.exec(section)) !== null) {
    const target = linkMatch[2]!;
    const key = [id, target].sort().join("|");
    if (!seen.has(key)) {
      seen.add(key);
      const sorted = [id, target].sort();
      edges.push({ from: sorted[0]!, to: sorted[1]!, strength: 0.5 });
    }
  }
}

edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

// ---------------------------------------------------------------------------
// 5. Generate groupings
// ---------------------------------------------------------------------------

interface GroupingOutput {
  id: string;
  label: string;
  regions: { id: string; label: string; description: string; x: number; y: number; radius: number; color: string }[];
  positions: Record<string, { x: number; y: number; regionId?: string; color?: string }>;
}

/** Place ids evenly on a circle, returning position map. */
function ringPositions(
  cx: number, cy: number, r: number,
  ids: string[], regionId: string, color?: string,
): Record<string, { x: number; y: number; regionId?: string; color?: string }> {
  const positions: Record<string, { x: number; y: number; regionId?: string; color?: string }> = {};
  ids.forEach((id, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / ids.length;
    positions[id] = {
      x: Math.round(cx + r * Math.cos(angle)),
      y: Math.round(cy + r * Math.sin(angle)),
      ...(regionId && { regionId }),
      ...(color && { color }),
    };
  });
  return positions;
}

/** Compute essay/meta floating positions for a grouping. */
function essayAndMetaPositions(
  essayCx: number, essayCy: number,
  metaX: number, metaY: number,
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  const essayIds = essays.map((e) => e.id);
  const centerEssayId = "prose/the-great-deceit";

  const ringIds = essayIds.filter((id) => id !== centerEssayId);
  if (ringIds.length > 0) {
    Object.assign(result, ringPositions(essayCx, essayCy, 90, ringIds, ""));
  }
  if (essayIds.includes(centerEssayId)) {
    result[centerEssayId] = { x: essayCx, y: essayCy };
  }

  for (const m of metaNodes) {
    result[m.id] = { x: metaX, y: metaY };
  }
  return result;
}

const generatedGroupings: GroupingOutput[] = [];

// --- Ecosystem grouping (default): uses graph positions ---
{
  const ecoRegions = regions.map((r) => ({
    id: r.id, label: r.label, description: r.description,
    x: r.x, y: r.y, radius: r.radius, color: r.color,
  }));
  generatedGroupings.push({
    id: "ecosystem",
    label: "Ecosystems",
    regions: ecoRegions,
    positions: {}, // default positions from graph
  });
}

// --- Tag-based groupings (domain, tech) ---
function buildTagGrouping(
  groupingId: string, groupingLabel: string,
  category: string, brighterLightness: string,
  essayCx: number, essayCy: number,
  metaX: number, metaY: number,
): GroupingOutput {
  const catRegions = groupingRegions
    .filter((r) => r.category === category)
    .sort((a, b) => a.id.localeCompare(b.id));

  // Build regions with algorithmic positions
  const regionCount = catRegions.length;
  const maxChildCount = Math.max(
    ...catRegions.map((r) => {
      const tag = r.id.split("/")[1]!;
      return projectNodes.filter((n) => n.tags.includes(tag)).length;
    }),
    1,
  );
  const ringR = Math.max(200, 100 + maxChildCount * 10);

  const builtRegions: GroupingOutput["regions"] = [];
  const allPositions: Record<string, { x: number; y: number; regionId?: string; color?: string }> = {};

  catRegions.forEach((reg, i) => {
    const tag = reg.id.split("/")[1]!;
    const children = projectNodes.filter((n) => n.tags.includes(tag));
    const childCount = children.length;

    // Position region on a ring
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / regionCount;
    const rx = Math.round(ringR * Math.cos(angle));
    const ry = Math.round(ringR * Math.sin(angle));
    const radius = Math.max(100, 60 + childCount * 12);

    // Derive lighter color for children
    const colorMatch = reg.color.match(/oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/);
    const chroma = colorMatch ? colorMatch[1] : "0.12";
    const hue = colorMatch ? colorMatch[2] : "0";
    const childColor = `oklch(${brighterLightness} ${chroma} ${hue})`;

    builtRegions.push({
      id: reg.id, label: reg.label, description: reg.description,
      x: rx, y: ry, radius, color: reg.color,
    });

    // Position children in a ring
    const childIds = children.map((c) => c.id).sort();
    const childRingR = Math.max(60, radius * 0.7 + childCount * 3);
    Object.assign(allPositions, ringPositions(rx, ry, childRingR, childIds, reg.id, childColor));
  });

  // Add essays and meta
  Object.assign(allPositions, essayAndMetaPositions(essayCx, essayCy, metaX, metaY));

  return { id: groupingId, label: groupingLabel, regions: builtRegions, positions: allPositions };
}

generatedGroupings.push(
  buildTagGrouping("domain", "Domains", "domain", "0.75", 420, 180, 0, 0),
);

generatedGroupings.push(
  buildTagGrouping("tech", "Technologies", "technology", "0.75", 20, 130, 0, -170),
);

// --- Status grouping ---
{
  const statusRegionDefs = groupingRegions
    .filter((r) => r.category === "status")
    .sort((a, b) => a.id.localeCompare(b.id));

  const statusOrder = ["planned", "early", "fleshed-out", "mature", "production"];

  // Sort by lifecycle order
  statusRegionDefs.sort((a, b) => {
    const aSlug = a.id.split("/")[1]!;
    const bSlug = b.id.split("/")[1]!;
    return statusOrder.indexOf(aSlug) - statusOrder.indexOf(bSlug);
  });

  const regionCount = statusRegionDefs.length;
  const builtRegions: GroupingOutput["regions"] = [];
  const allPositions: Record<string, { x: number; y: number; regionId?: string; color?: string }> = {};

  statusRegionDefs.forEach((reg, i) => {
    const statusSlug = reg.id.split("/")[1]!;
    // Match nodes by status field; "mature" maps to "production" status
    const matchStatuses = statusSlug === "mature" ? ["production"] : [statusSlug];
    const children = projectNodes.filter((n) => n.status && matchStatuses.includes(n.status));
    const childCount = children.length;

    // Position: clockwise rectangle layout
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / regionCount;
    const rx = Math.round(280 * Math.cos(angle));
    const ry = Math.round(150 * Math.sin(angle));
    const radius = Math.max(100, 60 + childCount * 10);

    const colorMatch = reg.color.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
    const lightness = colorMatch ? (Number(colorMatch[1]) + 0.05).toFixed(2) : "0.75";
    const chroma = colorMatch ? colorMatch[2] : "0.12";
    const hue = colorMatch ? colorMatch[3] : "0";
    const childColor = `oklch(${lightness} ${chroma} ${hue})`;

    builtRegions.push({
      id: reg.id, label: reg.label, description: reg.description,
      x: rx, y: ry, radius, color: reg.color,
    });

    const childIds = children.map((c) => c.id).sort();
    const childRingR = Math.max(60, radius * 0.7 + childCount * 3);
    Object.assign(allPositions, ringPositions(rx, ry, childRingR, childIds, reg.id, childColor));
  });

  // Essays at center, meta at top
  Object.assign(allPositions, essayAndMetaPositions(0, 0, 0, -170));

  generatedGroupings.push({ id: "status", label: "Status", regions: builtRegions, positions: allPositions });
}

// ---------------------------------------------------------------------------
// 6. Write output
// ---------------------------------------------------------------------------

// Sort nodes by id for stable output
nodes.sort((a, b) => a.id.localeCompare(b.id));

function quote(s: string): string {
  if (s.includes('"') || s.includes("\n") || s.includes("\\")) {
    return JSON.stringify(s);
  }
  return `"${s}"`;
}

const nodeLines = nodes.map((n) => {
  const fields: string[] = [
    `id: "${n.id}"`,
    `label: ${quote(n.label)}`,
    `description: ${quote(n.description)}`,
  ];
  if (n.url) fields.push(`url: "${n.url}"`);
  fields.push(`tier: "${n.tier}"`);
  if (n.parent) fields.push(`parent: "${n.parent}"`);
  fields.push(`x: ${n.x}`);
  fields.push(`y: ${n.y}`);
  fields.push(`radius: ${n.radius}`);
  fields.push(`color: ${quote(n.color)}`);
  if (n.status) fields.push(`status: "${n.status}"`);
  fields.push(`tags: [${n.tags.map((t) => `"${t}"`).join(", ")}]`);
  return `  { ${fields.join(", ")} },`;
}).join("\n");

const edgeLines = edges
  .map((e) => `  { from: "${e.from}", to: "${e.to}", strength: ${e.strength} },`)
  .join("\n");

const content = `// Auto-generated by gen-graph.ts - do not edit
import type { Node, Edge } from "./graph";

export const generatedNodes: Omit<Node, "baseX" | "baseY">[] = [
${nodeLines}
];

export const generatedEdges: Edge[] = [
${edgeLines}
];
`;

await writeFile(outFile, content);
console.log(`wrote ${nodes.length} nodes and ${edges.length} edges to ${outFile}`);

// Write groupings
function quoteGrouping(s: string): string {
  if (s.includes('"') || s.includes("\n") || s.includes("\\")) {
    return JSON.stringify(s);
  }
  return `"${s}"`;
}

const groupingLines = generatedGroupings.map((g) => {
  const regionLines = g.regions.map((r) =>
    `    { id: "${r.id}", label: ${quoteGrouping(r.label)}, description: ${quoteGrouping(r.description)}, x: ${r.x}, y: ${r.y}, radius: ${r.radius}, color: ${quoteGrouping(r.color)} },`
  ).join("\n");

  const posEntries = Object.entries(g.positions).sort(([a], [b]) => a.localeCompare(b));
  const posLines = posEntries.map(([id, pos]) => {
    const fields = [`x: ${pos.x}`, `y: ${pos.y}`];
    if (pos.regionId) fields.push(`regionId: "${pos.regionId}"`);
    if (pos.color) fields.push(`color: ${quoteGrouping(pos.color)}`);
    return `    "${id}": { ${fields.join(", ")} },`;
  }).join("\n");

  return `  {
    id: "${g.id}",
    label: "${g.label}",
    regions: [
${regionLines}
    ],
    positions: {
${posLines}
    },
  },`;
}).join("\n");

const groupingsContent = `// Auto-generated by gen-graph.ts - do not edit
import type { Grouping } from "./groupings";

export const generatedGroupings: Grouping[] = [
${groupingLines}
];
`;

await writeFile(groupingsOutFile, groupingsContent);
console.log(`wrote ${generatedGroupings.length} groupings to ${groupingsOutFile}`);
