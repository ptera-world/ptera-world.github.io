/**
 * Unified build script: reads frontmatter + edges from public/content/*.md
 * and generates src/generated-graph.ts with node definitions and edges.
 *
 * Run with: bun run src/gen-graph.ts
 */
import { readdir, readFile, writeFile, stat } from "fs/promises";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { parseFrontmatter, stripFrontmatter, inferTier, inferTags } from "./frontmatter";

const contentDir = join(import.meta.dir, "../public/content");
const outFile = join(import.meta.dir, "generated-graph.ts");
const groupingsOutFile = join(import.meta.dir, "generated-groupings.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function radiusFromStatus(status?: string): number {
  switch (status) {
    case "production": return 30;
    case "fleshed-out": return 26;
    case "early": return 22;
    case "planned": return 20;
    default: return 24; // essays, meta, etc.
  }
}

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
  cluster?: string;
  // Set by layout
  x: number;
  y: number;
}

/** Place nodes evenly on a circle, starting from the top and going clockwise. */
function ringLayout(cx: number, cy: number, r: number, items: ParsedNode[]): void {
  for (let i = 0; i < items.length; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / items.length;
    items[i]!.x = Math.round(cx + r * Math.cos(angle));
    items[i]!.y = Math.round(cy + r * Math.sin(angle));
  }
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
// 2. Cluster configs from public/content/cluster/
// ---------------------------------------------------------------------------

interface ClusterConfig {
  id: string;
  label: string;
  center: [number, number];
  layout: "force" | "ring";
  color: string;
  // Force layout params
  minDist: number;
  restLen: number;
  repulsion: number;
  attraction: number;
  gravity: number;
  iterations: number;
}

const DEFAULT_FORCE = {
  minDist: 52,
  restLen: 80,
  repulsion: 20000,
  attraction: 0.2,
  gravity: 0.008,
  iterations: 500,
};

const allFiles = await findMarkdownFiles(contentDir);

const clusterConfigs = new Map<string, ClusterConfig>();
for (const { id, path, category } of allFiles) {
  if (category !== "cluster") continue;
  const clusterId = id.split("/")[1]!; // "cluster/essays" -> "essays"
  const text = await readFile(path, "utf-8");
  if (!text.startsWith("---\n")) continue;
  const end = text.indexOf("\n---", 4);
  if (end === -1) continue;
  const raw = parseYaml(text.slice(4, end)) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") continue;
  const centerRaw = raw.center as unknown[];
  if (!Array.isArray(centerRaw) || centerRaw.length < 2) continue;
  clusterConfigs.set(clusterId, {
    id: clusterId,
    label: (raw.label as string) ?? clusterId,
    center: [Number(centerRaw[0]), Number(centerRaw[1])],
    layout: (raw.layout as "force" | "ring") ?? "ring",
    color: (raw.color as string) ?? "oklch(0.78 0.09 45)",
    minDist: (raw.minDist as number) ?? DEFAULT_FORCE.minDist,
    restLen: (raw.restLen as number) ?? DEFAULT_FORCE.restLen,
    repulsion: (raw.repulsion as number) ?? DEFAULT_FORCE.repulsion,
    attraction: (raw.attraction as number) ?? DEFAULT_FORCE.attraction,
    gravity: (raw.gravity as number) ?? DEFAULT_FORCE.gravity,
    iterations: (raw.iterations as number) ?? DEFAULT_FORCE.iterations,
  });
}

// ---------------------------------------------------------------------------
// 3. Parse all content files
// ---------------------------------------------------------------------------

/** Infer which layout cluster a rootless artifact node belongs to. */
function inferCluster(category: string, tier: string, parent?: string): string | undefined {
  if (parent) return undefined; // positioned by parent region
  if (tier !== "artifact") return undefined;
  if (category === "prose") return "essays";
  if (category === "project") return "orphans";
  return undefined;
}

// Content-only directories: don't become nodes unless they have tier: in frontmatter
const CONTENT_ONLY_DIRS = new Set(["domain", "technology", "status"]);
// Config-only directories: parsed for config, not nodes
const CONFIG_ONLY_DIRS = new Set(["cluster"]);

const files = allFiles.filter((f) => !CONFIG_ONLY_DIRS.has(f.category));
const nodes: ParsedNode[] = [];
const nodeIds = new Set<string>();

for (const { id, path, category } of files) {
  const text = await readFile(path, "utf-8");
  const fm = parseFrontmatter(text);
  if (!fm) continue;

  // Skip content-only dirs unless they explicitly set tier
  if (CONTENT_ONLY_DIRS.has(category) && !fm.tier) continue;

  const tier = fm.tier ?? inferTier(category);
  if (!tier) continue;

  const autoTags = inferTags(category, tier);
  const userTags = fm.tags ?? [];
  const allTags = [...new Set([...autoTags, ...userTags])];

  const radius = fm.radius ?? radiusFromStatus(fm.status);
  const cluster = fm.cluster ?? inferCluster(category, tier, fm.parent);

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
    color: fm.color ?? "",
    cluster,
    x: 0,
    y: 0,
  });
  nodeIds.add(id);
}

// Also collect content-only pages for grouping regions
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

// ---------------------------------------------------------------------------
// 4. Compute layout: positions and colors
// ---------------------------------------------------------------------------

const regions = nodes.filter((n) => n.tier === "region");
const metaNodes = nodes.filter((n) => n.tier === "meta");
const projectNodes = nodes.filter((n) => n.tier === "artifact");

// --- Region layout: ring around origin ---
{
  for (const region of regions) {
    const children = projectNodes.filter((n) => n.parent === region.id);
    if (region.radius === 24) {
      region.radius = Math.max(140, 100 + children.length * 6);
    }
    if (!region.color) {
      // No color in frontmatter — compute from index as fallback
      const i = regions.indexOf(region);
      const hue = Math.round((360 * i) / Math.max(regions.length, 1));
      region.color = `oklch(0.7 0.12 ${hue})`;
    }
  }

  if (regions.length === 1) {
    regions[0]!.x = 0;
    regions[0]!.y = 0;
  } else {
    const maxRadius = Math.max(...regions.map((r) => r.radius));
    const ringR = maxRadius + 100;
    for (let i = 0; i < regions.length; i++) {
      const angle = Math.PI + (2 * Math.PI * i) / regions.length;
      regions[i]!.x = Math.round(ringR * Math.cos(angle));
      regions[i]!.y = Math.round(ringR * Math.sin(angle));
    }
  }
}

// --- Children of regions: ring around parent ---
{
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

    const maxChildR = Math.max(...children.map((c) => c.radius), 20);
    const ringR = Math.max(55, Math.ceil(children.length * (maxChildR + 8) / Math.PI));
    ringLayout(parent.x, parent.y, ringR, children);

    // Derive child color from parent's oklch hue
    if (children.some((c) => !c.color)) {
      const m = parent.color.match(/oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/);
      const hue = m ? m[2] : "0";
      for (const child of children) {
        if (!child.color) child.color = `oklch(0.78 0.09 ${hue})`;
      }
    }
  }
}

// --- Cluster layout: all non-parent artifact nodes ---
// Ring clusters are positioned now; force clusters are seeded and run after edge extraction.
for (const [clusterId, config] of clusterConfigs) {
  const members = projectNodes.filter((n) => n.cluster === clusterId);
  if (members.length === 0) continue;

  // Assign color
  for (const m of members) {
    if (!m.color) m.color = config.color;
  }

  if (config.layout === "ring") {
    const ringR = Math.max(80, 60 + members.length * 15);
    ringLayout(config.center[0], config.center[1], ringR, members);
  } else {
    // Force layout: seed on a ring, actual layout runs after edges
    const initialR = Math.ceil((members.length * config.minDist) / (2 * Math.PI)) + 200;
    ringLayout(config.center[0], config.center[1], initialR, members);
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
// 5. Extract edges from ## Related projects / ## See also
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
// 6. Force-directed layout for force clusters
// ---------------------------------------------------------------------------

/** Run force-directed layout on a set of nodes. Positions are modified in-place. */
function runForceLayout(
  members: ParsedNode[],
  center: [number, number],
  adj: Map<string, Set<string>>,
  opts: Pick<ClusterConfig, "minDist" | "restLen" | "repulsion" | "attraction" | "gravity" | "iterations">,
): void {
  const { minDist, restLen, repulsion, attraction, gravity, iterations } = opts;
  const [cx, cy] = center;

  const vx = new Map<string, number>(members.map((e) => [e.id, 0]));
  const vy = new Map<string, number>(members.map((e) => [e.id, 0]));

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    const fx = new Map<string, number>(members.map((e) => [e.id, 0]));
    const fy = new Map<string, number>(members.map((e) => [e.id, 0]));

    // Repulsion between all pairs
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!, b = members[j]!;
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.max(Math.hypot(dx, dy), 0.1);
        const force = dist < minDist
          ? repulsion * 4 / (dist * dist)
          : repulsion / (dist * dist);
        const nx = dx / dist, ny = dy / dist;
        fx.set(a.id, fx.get(a.id)! + nx * force);
        fy.set(a.id, fy.get(a.id)! + ny * force);
        fx.set(b.id, fx.get(b.id)! - nx * force);
        fy.set(b.id, fy.get(b.id)! - ny * force);
      }
    }

    // Attraction along edges — normalized by degree so hubs don't dominate
    for (const a of members) {
      const aDeg = Math.max(adj.get(a.id)?.size ?? 0, 1);
      for (const bid of adj.get(a.id) ?? []) {
        const b = members.find((e) => e.id === bid);
        if (!b || b.id < a.id) continue;
        const bDeg = Math.max(adj.get(b.id)?.size ?? 0, 1);
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.hypot(dx, dy), 0.1);
        const forceA = (attraction / aDeg) * (dist - restLen);
        const forceB = (attraction / bDeg) * (dist - restLen);
        const nx = dx / dist, ny = dy / dist;
        fx.set(a.id, fx.get(a.id)! + nx * forceA);
        fy.set(a.id, fy.get(a.id)! + ny * forceA);
        fx.set(b.id, fx.get(b.id)! - nx * forceB);
        fy.set(b.id, fy.get(b.id)! - ny * forceB);
      }
    }

    // Gravity toward cluster center
    for (const e of members) {
      fx.set(e.id, fx.get(e.id)! + (cx - e.x) * gravity);
      fy.set(e.id, fy.get(e.id)! + (cy - e.y) * gravity);
    }

    // Integrate with damping
    const damping = 0.85;
    const maxStep = 20 * cooling + 2;
    for (const e of members) {
      const nvx = (vx.get(e.id)! + fx.get(e.id)!) * damping;
      const nvy = (vy.get(e.id)! + fy.get(e.id)!) * damping;
      const speed = Math.hypot(nvx, nvy);
      const scale = speed > maxStep ? maxStep / speed : 1;
      vx.set(e.id, nvx * scale);
      vy.set(e.id, nvy * scale);
      e.x += vx.get(e.id)!;
      e.y += vy.get(e.id)!;
    }

    // Hard constraint: multiple passes to fully resolve overlaps
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i]!, b = members[j]!;
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < minDist && dist > 0) {
            const push = (minDist - dist) / 2 + 0.5;
            const nx = dx / dist, ny = dy / dist;
            a.x += nx * push; a.y += ny * push;
            b.x -= nx * push; b.y -= ny * push;
          }
        }
      }
    }
  }

  for (const e of members) {
    e.x = Math.round(e.x);
    e.y = Math.round(e.y);
  }
}

// Run force layout for each force cluster
for (const [clusterId, config] of clusterConfigs) {
  if (config.layout !== "force") continue;
  const members = projectNodes.filter((n) => n.cluster === clusterId);
  if (members.length === 0) continue;

  const memberIds = new Set(members.map((e) => e.id));
  const adj = new Map<string, Set<string>>();
  for (const m of members) adj.set(m.id, new Set());
  for (const edge of edges) {
    if (memberIds.has(edge.from) && memberIds.has(edge.to)) {
      adj.get(edge.from)!.add(edge.to);
      adj.get(edge.to)!.add(edge.from);
    }
  }

  runForceLayout(members, config.center, adj, config);
}

// ---------------------------------------------------------------------------
// 6b. Detect and resolve cross-cluster overlaps
// ---------------------------------------------------------------------------
{
  // Skip same-parent pairs — their ecosystem ring handles spacing
  const overlaps: [ParsedNode, ParsedNode, number][] = [];
  for (let i = 0; i < projectNodes.length; i++) {
    for (let j = i + 1; j < projectNodes.length; j++) {
      const a = projectNodes[i]!, b = projectNodes[j]!;
      if (a.parent && a.parent === b.parent) continue;
      const minDist = a.radius + b.radius + 4;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < minDist) overlaps.push([a, b, dist]);
    }
  }

  if (overlaps.length > 0) {
    console.warn(`\nwarn: ${overlaps.length} node overlaps — applying best-effort separation:`);
    for (const [a, b, dist] of overlaps) {
      console.warn(`  ${a.id} <-> ${b.id}: dist=${Math.round(dist)}, need ${Math.round(a.radius + b.radius + 4)}`);
    }

    for (let pass = 0; pass < 30; pass++) {
      for (let i = 0; i < projectNodes.length; i++) {
        for (let j = i + 1; j < projectNodes.length; j++) {
          const a = projectNodes[i]!, b = projectNodes[j]!;
          if (a.parent && a.parent === b.parent) continue;
          const minDist = a.radius + b.radius + 4;
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < minDist && dist > 0) {
            const push = (minDist - dist) + 0.5;
            const nx = dx / dist, ny = dy / dist;
            // Ecosystem children are fixed — only move the free (parentless) node
            if (a.parent && !b.parent) {
              b.x -= nx * push; b.y -= ny * push;
            } else if (b.parent && !a.parent) {
              a.x += nx * push; a.y += ny * push;
            } else {
              a.x += nx * push / 2; a.y += ny * push / 2;
              b.x -= nx * push / 2; b.y -= ny * push / 2;
            }
          }
        }
      }
    }

    for (const n of projectNodes) {
      n.x = Math.round(n.x);
      n.y = Math.round(n.y);
    }
    console.warn("  separation applied.");
  }
}

// ---------------------------------------------------------------------------
// 7. Generate groupings
// ---------------------------------------------------------------------------

interface GroupingOutput {
  id: string;
  label: string;
  regions: { id: string; label: string; description: string; x: number; y: number; radius: number; color: string }[];
  positions: Record<string, { x: number; y: number; regionId?: string; color?: string }>;
}

/**
 * Return positions for all cluster nodes (using their actual graph positions) plus meta nodes.
 * Used in secondary groupings so essays/orphans appear at their home positions in every view.
 */
function clusterPositionsForGroupings(
  metaX: number, metaY: number,
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  for (const n of projectNodes) {
    if (n.cluster && !n.parent) {
      result[n.id] = { x: n.x, y: n.y };
    }
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
  metaX: number, metaY: number,
): GroupingOutput {
  const catRegions = groupingRegions
    .filter((r) => r.category === category)
    .sort((a, b) => a.id.localeCompare(b.id));

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

    const angle = -Math.PI / 2 + (2 * Math.PI * i) / regionCount;
    const rx = Math.round(ringR * Math.cos(angle));
    const ry = Math.round(ringR * Math.sin(angle));
    const radius = Math.max(100, 60 + childCount * 12);

    const colorMatch = reg.color.match(/oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/);
    const chroma = colorMatch ? colorMatch[1] : "0.12";
    const hue = colorMatch ? colorMatch[2] : "0";
    const childColor = `oklch(${brighterLightness} ${chroma} ${hue})`;

    builtRegions.push({
      id: reg.id, label: reg.label, description: reg.description,
      x: rx, y: ry, radius, color: reg.color,
    });

    const childIds = children.map((c) => c.id).sort();
    const childRingR = Math.max(60, radius * 0.7 + childCount * 3);
    Object.assign(allPositions, ringPositions(rx, ry, childRingR, childIds, reg.id, childColor));
  });

  // Add cluster nodes and meta at their home positions
  Object.assign(allPositions, clusterPositionsForGroupings(metaX, metaY));

  return { id: groupingId, label: groupingLabel, regions: builtRegions, positions: allPositions };
}

generatedGroupings.push(
  buildTagGrouping("domain", "Domains", "domain", "0.75", 0, 0),
);

generatedGroupings.push(
  buildTagGrouping("tech", "Technologies", "technology", "0.75", 0, -170),
);

// --- Status grouping ---
{
  const statusRegionDefs = groupingRegions
    .filter((r) => r.category === "status")
    .sort((a, b) => a.id.localeCompare(b.id));

  const statusOrder = ["planned", "early", "fleshed-out", "mature", "production"];

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
    const matchStatuses = statusSlug === "mature" ? ["production"] : [statusSlug];
    const children = projectNodes.filter((n) => n.status && matchStatuses.includes(n.status));
    const childCount = children.length;

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

  Object.assign(allPositions, clusterPositionsForGroupings(0, -170));

  generatedGroupings.push({ id: "status", label: "Status", regions: builtRegions, positions: allPositions });
}

// ---------------------------------------------------------------------------
// 8. Write output
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
