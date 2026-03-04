/**
 * Unified build script: reads frontmatter + edges from public/content/*.md
 * and generates src/generated-graph.ts with node definitions and edges.
 *
 * Run standalone: bun run src/gen-graph.ts [dir1 dir2 ...]
 * Or import: import { generateGraph } from "./gen-graph";
 */
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { parseFrontmatter, stripFrontmatter } from "./frontmatter";
import { type Point, convexHull, expandHull, filterOutliers, hullSeparation } from "./hull";
import { findMarkdownFiles, CONTENT_DIR } from "./content";

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
  parent?: string;
  iconRadius?: number;
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
// Cluster / force layout types and helpers
// ---------------------------------------------------------------------------

interface ClusterConfig {
  id: string;
  label: string;
  layout: "ring" | "force";
  color: string;
  near?: string;
  ringRadius?: number;
  padding?: number;
  directories?: string[];
  autoTags?: string[];
  tagColors?: Record<string, number>; // tag → hue (degrees)
  groupingMatch: boolean; // false = exclude from tag grouping rings
  groupingPlacement?: "free"; // 'free' = free particle in alt grouping sims (not fixed obstacle)
  iconRadius?: number; // visual dot radius (defaults to node radius)
}

interface ForceParams {
  minDist: number; restLen: number; repulsion: number;
  attraction: number; gravity: number; iterations: number;
}

function initialForceParams(members: ParsedNode[]): ForceParams & { seedR: number } {
  const n = members.length;
  const maxR = Math.max(...members.map((m) => m.radius));
  const minDist = maxR * 2 + 8;
  const restLen = minDist * 1.5;
  const repulsion = restLen ** 2 * 8;
  const seedR = Math.ceil((n * minDist) / (2 * Math.PI)) + 50;
  const gravity = repulsion / (restLen ** 2 * seedR);
  return { minDist, restLen, repulsion, attraction: 0.15, gravity, iterations: 400 + n * 10, seedR };
}

interface LayoutQuality {
  overlaps: number;
  spreadRadius: number;
  edgeRatio: number | null;
  clusterScore: number | null;
}

function measureLayoutQuality(
  members: ParsedNode[],
  adj: Map<string, Set<string>>,
  center: [number, number],
): LayoutQuality {
  const [cx, cy] = center;

  let overlaps = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!, b = members[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius) overlaps++;
    }
  }

  const spreadRadius = Math.max(...members.map((n) => Math.hypot(n.x - cx, n.y - cy) + n.radius));

  let connDist = 0, connPairs = 0, unconnDist = 0, unconnPairs = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!, b = members[j]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (adj.get(a.id)?.has(b.id)) { connDist += dist; connPairs++; }
      else { unconnDist += dist; unconnPairs++; }
    }
  }
  const edgeRatio = connPairs > 0 && unconnPairs > 0
    ? (connDist / connPairs) / (unconnDist / unconnPairs) : null;

  let sharedDist = 0, sharedPairs = 0, isolDist = 0, isolPairs = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!, b = members[j]!;
      if (adj.get(a.id)?.has(b.id)) continue;
      const aN = adj.get(a.id) ?? new Set<string>();
      const bN = adj.get(b.id) ?? new Set<string>();
      const hasShared = [...aN].some((id) => bN.has(id));
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (hasShared) { sharedDist += dist; sharedPairs++; }
      else { isolDist += dist; isolPairs++; }
    }
  }
  const clusterScore = sharedPairs > 0 && isolPairs > 0
    ? (sharedDist / sharedPairs) / (isolDist / isolPairs) : null;

  return { overlaps, spreadRadius, edgeRatio, clusterScore };
}

function qualityScore(q: LayoutQuality): number {
  return q.overlaps * 1000
    + (q.edgeRatio != null ? Math.max(0, q.edgeRatio - 0.75) * 100 : 0)
    + (q.clusterScore != null ? Math.max(0, q.clusterScore - 0.85) * 50 : 0);
}

/** Run force-directed layout on a set of nodes. Positions are modified in-place. */
function runForceLayout(
  members: ParsedNode[],
  center: [number, number],
  adj: Map<string, Set<string>>,
  opts: ForceParams,
): void {
  const { minDist, restLen, repulsion, attraction, gravity, iterations } = opts;
  const [cx, cy] = center;

  const vx = new Map<string, number>(members.map((e) => [e.id, 0]));
  const vy = new Map<string, number>(members.map((e) => [e.id, 0]));

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    const fx = new Map<string, number>(members.map((e) => [e.id, 0]));
    const fy = new Map<string, number>(members.map((e) => [e.id, 0]));

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

    for (const e of members) {
      fx.set(e.id, fx.get(e.id)! + (cx - e.x) * gravity);
      fy.set(e.id, fy.get(e.id)! + (cy - e.y) * gravity);
    }

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

function runForceLayoutAdaptive(
  members: ParsedNode[],
  center: [number, number],
  adj: Map<string, Set<string>>,
  clusterId: string,
): void {
  if (members.length === 0) return;

  const seed = members.map((m) => ({ x: m.x, y: m.y }));
  let params = initialForceParams(members);
  let best: { positions: { x: number; y: number }[]; quality: LayoutQuality } | null = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    members.forEach((m, i) => { m.x = seed[i]!.x; m.y = seed[i]!.y; });
    runForceLayout(members, center, adj, params);
    const q = measureLayoutQuality(members, adj, center);

    if (!best || qualityScore(q) < qualityScore(best.quality)) {
      best = { positions: members.map((m) => ({ x: m.x, y: m.y })), quality: q };
    }

    const edgeOk = q.edgeRatio == null || q.edgeRatio < 0.75;
    const clusterOk = q.clusterScore == null || q.clusterScore < 0.85;
    if (q.overlaps === 0 && edgeOk && clusterOk) break;

    if (q.overlaps > 0) {
      params = { ...params, repulsion: params.repulsion * 1.6, minDist: params.minDist * 1.1 };
    } else {
      params = { ...params, attraction: params.attraction * 1.5, repulsion: params.repulsion * 0.85 };
    }
    params = { ...params, iterations: Math.min(params.iterations + 150, 1800) };
  }

  if (best) {
    members.forEach((m, i) => { m.x = best!.positions[i]!.x; m.y = best!.positions[i]!.y; });
    const q = best.quality;
    const edgePart = q.edgeRatio != null
      ? `  edge=${q.edgeRatio.toFixed(2)} cluster=${q.clusterScore?.toFixed(2) ?? "n/a"}` : "";
    console.log(`  ${clusterId}(${members.length}): overlaps=${q.overlaps} spread=${Math.round(q.spreadRadius)}${edgePart}`);
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate the graph for specified content directories.
 * If dirs is omitted, scans all content directories.
 */
export async function generateGraph(dirs?: string[], collectionId?: string): Promise<void> {

const allFiles = await findMarkdownFiles(CONTENT_DIR, dirs);

// ---------------------------------------------------------------------------
// 2. Cluster configs from public/content/cluster/
// ---------------------------------------------------------------------------

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
  clusterConfigs.set(clusterId, {
    id: clusterId,
    label: (raw.label as string) ?? clusterId,
    layout: (raw.layout as "ring" | "force") ?? "ring",
    color: (raw.color as string) ?? "oklch(0.78 0.09 45)",
    near: raw.near != null ? String(raw.near) : undefined,
    ringRadius: raw.ringRadius != null ? Number(raw.ringRadius) : undefined,
    padding: raw.padding != null ? Number(raw.padding) : undefined,
    directories: Array.isArray(raw.directories) ? raw.directories.map(String) : undefined,
    autoTags: Array.isArray(raw.autoTags) ? raw.autoTags.map(String) : undefined,
    tagColors: raw.tagColors != null && typeof raw.tagColors === "object" && !Array.isArray(raw.tagColors)
      ? Object.fromEntries(Object.entries(raw.tagColors as Record<string, unknown>).map(([k, v]) => [k, Number(v)]))
      : undefined,
    groupingMatch: raw.groupingMatch === false ? false : true,
    groupingPlacement: raw.groupingPlacement === "free" ? "free" : undefined,
    iconRadius: raw.iconRadius != null ? Number(raw.iconRadius) : undefined,
  });
}

// ---------------------------------------------------------------------------
// 3. Parse all content files
// ---------------------------------------------------------------------------

const dirToCluster = new Map<string, ClusterConfig>();
for (const config of clusterConfigs.values()) {
  if (config.directories) {
    for (const dir of config.directories) {
      dirToCluster.set(dir, config);
    }
  }
}

const CONFIG_ONLY_DIRS = new Set(["cluster"]);

const files = allFiles.filter((f) => !CONFIG_ONLY_DIRS.has(f.category));
const nodes: ParsedNode[] = [];
const nodeIds = new Set<string>();

for (const { id, path, category } of files) {
  const text = await readFile(path, "utf-8");
  const fm = parseFrontmatter(text);
  if (!fm) continue;

  if (collectionId && fm.collections && !fm.collections.includes(collectionId)) continue;

  const clusterForDir = dirToCluster.get(category);
  const isMeta = fm.tags?.includes("meta") ?? false;
  if (!clusterForDir && !isMeta) continue;

  const cluster = fm.cluster ?? (
    clusterForDir && !fm.parent ? clusterForDir.id : undefined
  );

  const autoTags = [...(clusterForDir?.autoTags ?? [])];
  const userTags = fm.tags ?? [];
  const allTags = [...new Set([...autoTags, ...userTags])];

  const radius = fm.radius ?? radiusFromStatus(fm.status);

  nodes.push({
    id,
    label: fm.label,
    description: fm.description,
    url: fm.url,
    parent: fm.parent,
    status: fm.status,
    tags: allTags,
    radius,
    iconRadius: clusterForDir?.iconRadius,
    color: fm.color ?? "",
    cluster,
    x: 0,
    y: 0,
  });
  nodeIds.add(id);
}

interface GroupingRegionDef {
  id: string;
  label: string;
  description: string;
  color: string;
  category: string;
}

const groupingRegions: GroupingRegionDef[] = [];

for (const { id, path, category } of files) {
  if (nodeIds.has(id)) continue;
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
// 5. Extract edges
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
// 4. Layout — computes base node positions (n.x / n.y)
// ---------------------------------------------------------------------------

interface GroupingOutput {
  id: string;
  label: string;
  regions: { id: string; label: string; description: string; x: number; y: number; radius: number; color: string }[];
  positions: Record<string, { x: number; y: number; regionId?: string; regionIds?: string[]; color?: string }>;
}

{
  const eligibleNodes = nodes.filter((n) => !n.tags.includes("meta"));
  const metaNodes = nodes.filter((n) => n.tags.includes("meta"));

  // Ecosystem regions from content — same source as buildTagGrouping uses.
  interface LayoutRegion { id: string; label: string; description: string; color: string; x: number; y: number; radius: number; }
  const regions: LayoutRegion[] = groupingRegions
    .filter((r) => r.category === "ecosystem")
    .map((r) => ({ id: r.id, label: r.label, description: r.description, color: r.color, x: 0, y: 0, radius: 0 }));

  // Free-placement nodes are handled by a free-particle sim, not cluster layout.
  const freePlacementIds = new Set<string>(
    eligibleNodes
      .filter((n) => n.cluster && clusterConfigs.get(n.cluster)?.groupingPlacement === "free")
      .map((n) => n.id),
  );

  // Auto-tag nodes: status → status tag, parent → ecosystem leaf tag for buildTagGrouping matching.
  for (const n of eligibleNodes) {
    if (n.status && !n.tags.includes(n.status)) n.tags.push(n.status);
    if (n.parent) {
      const leaf = n.parent.split("/").pop()!;
      if (!n.tags.includes(leaf)) n.tags.push(leaf);
    }
  }

  // --- Region layout: ring around origin ---
  {
    for (const region of regions) {
      const children = eligibleNodes.filter((n) => n.parent === region.id);
      if (!region.color) {
        const i = regions.indexOf(region);
        const hue = Math.round((360 * i) / Math.max(regions.length, 1));
        region.color = `oklch(0.7 0.12 ${hue})`;
      }
      if (children.length === 0) {
        region.radius = Math.max(140, region.radius);
        continue;
      }
      const maxChildR = Math.max(...children.map((c) => c.radius), 20);
      const ringR = Math.max(100, Math.ceil(children.length * (maxChildR + 8) / Math.PI));
      region.radius = Math.max(140, ringR + maxChildR + 20);
    }

    const anchoredOuterR = [...clusterConfigs.values()]
      .filter((c) => c.near)
      .reduce((maxR, c) => {
        const clusterMembers = eligibleNodes.filter((n) => n.cluster === c.id);
        const maxMemberR = clusterMembers.length > 0
          ? Math.max(...clusterMembers.map((m) => m.radius), 20) : 20;
        const padding = c.padding ?? 15;
        const outerR = (c.ringRadius ?? Math.max(80, 60 + clusterMembers.length * 15)) + maxMemberR + padding;
        return Math.max(maxR, outerR);
      }, 0);

    if (regions.length === 1) {
      const region = regions[0]!;
      if (anchoredOuterR > 0) {
        const clearance = anchoredOuterR + region.radius + 40;
        region.x = -clearance;
        region.y = 0;
      } else {
        region.x = 0;
        region.y = 0;
      }
    } else if (regions.length > 1) {
      const maxRadius = Math.max(...regions.map((r) => r.radius));
      const baseRingR = maxRadius + 100;
      const ringR = anchoredOuterR > 0
        ? Math.max(baseRingR, anchoredOuterR + maxRadius + 40)
        : baseRingR;
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
    for (const node of eligibleNodes) {
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
      const ringR = Math.max(100, Math.ceil(children.length * (maxChildR + 8) / Math.PI));
      ringLayout(parent.x, parent.y, ringR, children);

      if (children.some((c) => !c.color)) {
        const m = parent.color.match(/oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/);
        const hue = m ? m[2] : "0";
        for (const child of children) {
          if (!child.color) child.color = `oklch(0.78 0.09 ${hue})`;
        }
      }
    }
  }

  function computeClusterCenter(
    config: ClusterConfig,
    members: ParsedNode[],
    allNodes: { id: string; x: number; y: number }[],
    placedHulls: Point[][],
  ): [number, number] {
    if (config.near) {
      const anchor = allNodes.find((n) => n.id === config.near);
      if (anchor) return [anchor.x, anchor.y];
      console.warn(`  warn: cluster "${config.id}" near: "${config.near}" not found, auto-placing`);
    }

    const spreadEstimate = config.layout === "ring"
      ? (config.ringRadius ?? Math.max(80, 60 + members.length * 15))
      : initialForceParams(members).seedR;

    const placementR = Math.max(...regions.map((r) => r.radius), 100)
      + spreadEstimate + 80;

    let bestAngle = 0, bestScore = -Infinity;
    for (let i = 0; i < 72; i++) {
      const angle = (2 * Math.PI * i) / 72;
      const cx = placementR * Math.cos(angle);
      const cy = placementR * Math.sin(angle);

      const minRegionDist = regions.length > 0
        ? Math.min(...regions.map((r) => Math.hypot(cx - r.x, cy - r.y) - r.radius - spreadEstimate))
        : Infinity;

      const minHullDist = placedHulls.length > 0
        ? Math.min(...placedHulls.map((h) => hullSeparation([{ x: cx, y: cy }], h) - spreadEstimate))
        : Infinity;

      const score = Math.min(minRegionDist, minHullDist);
      if (score > bestScore) { bestScore = score; bestAngle = angle; }
    }

    return [
      Math.round(placementR * Math.cos(bestAngle)),
      Math.round(placementR * Math.sin(bestAngle)),
    ];
  }

  // --- Meta nodes: origin ---
  for (const meta of metaNodes) {
    meta.x = 0;
    meta.y = 0;
    meta.radius = 0;
    if (!meta.color) meta.color = "#fff";
  }

  // --- Cluster layout ---
  const clusterCenters = new Map<string, [number, number]>();
  const placedHulls: Point[][] = [];

  for (const [clusterId, config] of clusterConfigs) {
    const members = eligibleNodes.filter((n) => n.cluster === clusterId);
    if (members.length === 0) continue;

    for (const m of members) {
      if (!m.color) {
        if (config.tagColors) {
          const matchingHues = m.tags
            .filter((t) => config.tagColors![t] !== undefined)
            .map((t) => config.tagColors![t]!);
          if (matchingHues.length > 0) {
            const avgHue = Math.round(matchingHues.reduce((a, b) => a + b, 0) / matchingHues.length);
            m.color = `oklch(0.78 0.12 ${avgHue})`;
          } else {
            m.color = config.color;
          }
        } else {
          m.color = config.color;
        }
      }
    }

    const center = computeClusterCenter(config, members, [...regions, ...metaNodes, ...eligibleNodes], placedHulls);
    clusterCenters.set(clusterId, center);

    if (config.groupingPlacement === "free") {
      // Seed at cluster center ring so free-particle sim has valid initial positions.
      const { seedR } = initialForceParams(members);
      ringLayout(center[0], center[1], seedR, members);
      continue; // Free-particle sim handles final placement; skip hull tracking.
    }

    if (config.layout === "ring") {
      const ringR = config.ringRadius ?? Math.max(80, 60 + members.length * 15);
      ringLayout(center[0], center[1], ringR, members);
    } else {
      const { seedR } = initialForceParams(members);
      ringLayout(center[0], center[1], seedR, members);
    }

    const maxMemberR = Math.max(...members.map((m) => m.radius), 20);
    const padding = config.padding ?? 15;
    const corePts = filterOutliers(members.map((m) => ({ x: m.x, y: m.y })));
    const hull = expandHull(convexHull(corePts), maxMemberR + padding);
    placedHulls.push(hull);
  }

  // ---------------------------------------------------------------------------
  // 6. Force-directed layout for force clusters
  // ---------------------------------------------------------------------------

  console.log("Force layout:");
  for (const [clusterId, config] of clusterConfigs) {
    if (config.layout !== "force") continue;
    const members = eligibleNodes.filter((n) => n.cluster === clusterId);
    if (members.length === 0) continue;

    const memberIds = new Set(members.map((m) => m.id));
    const adj = new Map<string, Set<string>>();
    for (const m of members) adj.set(m.id, new Set());
    for (const edge of edges) {
      if (memberIds.has(edge.from) && memberIds.has(edge.to)) {
        adj.get(edge.from)!.add(edge.to);
        adj.get(edge.to)!.add(edge.from);
      }
    }

    runForceLayoutAdaptive(members, clusterCenters.get(clusterId)!, adj, clusterId);
  }

  // ---------------------------------------------------------------------------
  // 6b. Detect and resolve cross-cluster overlaps
  // ---------------------------------------------------------------------------
  {
    const overlaps: [ParsedNode, ParsedNode, number][] = [];
    for (let i = 0; i < eligibleNodes.length; i++) {
      for (let j = i + 1; j < eligibleNodes.length; j++) {
        const a = eligibleNodes[i]!, b = eligibleNodes[j]!;
        if (freePlacementIds.has(a.id) || freePlacementIds.has(b.id)) continue;
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
        for (let i = 0; i < eligibleNodes.length; i++) {
          for (let j = i + 1; j < eligibleNodes.length; j++) {
            const a = eligibleNodes[i]!, b = eligibleNodes[j]!;
            if (freePlacementIds.has(a.id) || freePlacementIds.has(b.id)) continue;
            if (a.parent && a.parent === b.parent) continue;
            const minDist = a.radius + b.radius + 4;
            const dx = a.x - b.x, dy = a.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist < minDist && dist > 0) {
              const push = (minDist - dist) + 0.5;
              const nx = dx / dist, ny = dy / dist;
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

      for (const n of eligibleNodes) {
        n.x = Math.round(n.x);
        n.y = Math.round(n.y);
      }
      console.warn("  separation applied.");
    }

    const anchoredClusters = new Set(
      [...clusterConfigs.values()].filter((c) => c.near).map((c) => c.id),
    );
    let regionPushCount = 0;
    for (let pass = 0; pass < 20; pass++) {
      for (const region of regions) {
        for (const n of eligibleNodes) {
          if (n.parent) continue;
          if (freePlacementIds.has(n.id)) continue;
          if (n.cluster && anchoredClusters.has(n.cluster)) continue;
          const dist = Math.hypot(n.x - region.x, n.y - region.y);
          if (dist < region.radius + n.radius + 8) {
            const push = region.radius + n.radius + 8 - dist + 0.5;
            const nx = dist > 0 ? (n.x - region.x) / dist : 1;
            const ny = dist > 0 ? (n.y - region.y) / dist : 0;
            n.x = Math.round(n.x + nx * push);
            n.y = Math.round(n.y + ny * push);
            regionPushCount++;
          }
        }
      }
    }
    if (regionPushCount > 0) {
      console.warn(`  pushed ${regionPushCount} region-vs-artifact overlaps.`);
    }
  }

  // Final quality report
  {
    let anyForce = false;
    for (const [clusterId, config] of clusterConfigs) {
      if (config.layout !== "force") continue;
      if (config.groupingPlacement === "free") continue;
      const members = eligibleNodes.filter((n) => n.cluster === clusterId);
      if (members.length === 0) continue;
      if (!anyForce) { console.log("Force layout (final, post-separation):"); anyForce = true; }
      const memberIds = new Set(members.map((m) => m.id));
      const adj = new Map<string, Set<string>>();
      for (const m of members) adj.set(m.id, new Set());
      for (const edge of edges) {
        if (memberIds.has(edge.from) && memberIds.has(edge.to)) {
          adj.get(edge.from)!.add(edge.to);
          adj.get(edge.to)!.add(edge.from);
        }
      }
      const q = measureLayoutQuality(members, adj, clusterCenters.get(clusterId)!);
      const edgePart = q.edgeRatio != null
        ? `  edge=${q.edgeRatio.toFixed(2)} cluster=${q.clusterScore?.toFixed(2) ?? "n/a"}` : "";
      console.log(`  ${clusterId}(${members.length}): overlaps=${q.overlaps} spread=${Math.round(q.spreadRadius)}${edgePart}`);
    }
  }

  // Free-particle sim for groupingPlacement: free nodes.
  // Same model as buildTagGrouping: soft 1/d² free-free repulsion, region-free contact, meta-free contact, gravity.
  {
    const freeNodes = eligibleNodes
      .filter((n) => freePlacementIds.has(n.id))
      .map((n) => ({ id: n.id, x: n.x, y: n.y, r: n.radius }));

    if (freeNodes.length > 0) {
      const META_CLEARANCE = 100; // landing element visual radius
      const FREE_REPULSION = 8000;
      const PUSH = 2.0;
      const ffx = freeNodes.map(() => 0);
      const ffy = freeNodes.map(() => 0);

      for (let step = 0; step < 400; step++) {
        for (let k = 0; k < freeNodes.length; k++) { ffx[k] = 0; ffy[k] = 0; }

        // Free–free soft repulsion
        for (let i = 0; i < freeNodes.length; i++) {
          for (let j = i + 1; j < freeNodes.length; j++) {
            const a = freeNodes[i]!, b = freeNodes[j]!;
            const dx = a.x - b.x, dy = a.y - b.y;
            const d = Math.hypot(dx, dy) || 0.1;
            const force = FREE_REPULSION / (d * d);
            ffx[i]! += (dx / d) * force; ffy[i]! += (dy / d) * force;
            ffx[j]! -= (dx / d) * force; ffy[j]! -= (dy / d) * force;
          }
        }

        // Region–free contact repulsion (free nodes pushed outside regions)
        for (const region of regions) {
          for (let k = 0; k < freeNodes.length; k++) {
            const fp = freeNodes[k]!;
            const dx = fp.x - region.x, dy = fp.y - region.y;
            const d = Math.hypot(dx, dy) || 0.1;
            const minD = region.radius + fp.r + 15;
            if (d < minD) {
              const push = (minD - d) * PUSH;
              ffx[k]! += (dx / d) * push; ffy[k]! += (dy / d) * push;
            }
          }
        }

        // Meta–free contact repulsion
        for (const meta of metaNodes) {
          for (let k = 0; k < freeNodes.length; k++) {
            const fp = freeNodes[k]!;
            const dx = fp.x - meta.x, dy = fp.y - meta.y;
            const d = Math.hypot(dx, dy) || 0.1;
            const minD = META_CLEARANCE + fp.r + 20;
            if (d < minD) {
              const push = (minD - d) * PUSH;
              ffx[k]! += (dx / d) * push; ffy[k]! += (dy / d) * push;
            }
          }
        }

        // Apply
        for (let k = 0; k < freeNodes.length; k++) {
          freeNodes[k]!.x += ffx[k]!;
          freeNodes[k]!.y += ffy[k]!;
        }
      }

      // Write sim results back to eligibleNodes so the output loop picks them up.
      const freeMap = new Map(freeNodes.map((f) => [f.id, f]));
      for (const n of eligibleNodes) {
        const f = freeMap.get(n.id);
        if (f) { n.x = Math.round(f.x); n.y = Math.round(f.y); }
      }
    }
  }

}

// ---------------------------------------------------------------------------
// 7. Generate groupings
// ---------------------------------------------------------------------------

const generatedGroupings: GroupingOutput[] = [];

function buildTagGrouping(
  groupingId: string, groupingLabel: string,
  category: string, brighterLightness: string,
): GroupingOutput {
  const catRegions = groupingRegions
    .filter((r) => r.category === category)
    .sort((a, b) => a.id.localeCompare(b.id));
  const N = catRegions.length;

  const eligibleNodes = nodes.filter((n) => !n.tags.includes("meta"));

  // Nodes explicitly excluded from ring matching (groupingMatch: false).
  const noGroupingMatchIds = new Set<string>(
    eligibleNodes
      .filter((n) => n.cluster && clusterConfigs.get(n.cluster)?.groupingMatch === false)
      .map((n) => n.id),
  );

  // Step 1: Match nodes to regions by tag (excluding groupingMatch: false clusters).
  const nodeMatchedRegs = new Map<string, string[]>(); // nodeId → matching regIds
  for (const reg of catRegions) {
    const tag = reg.id.split("/")[1]!;
    for (const n of eligibleNodes) {
      if (!n.tags.includes(tag) || noGroupingMatchIds.has(n.id)) continue;
      const arr = nodeMatchedRegs.get(n.id) ?? [];
      arr.push(reg.id);
      nodeMatchedRegs.set(n.id, arr);
    }
  }

  // Step 2: Separate single-match (→ ring) from multi-match (→ force layout).
  const singleMatchOf = new Map<string, string>(); // nodeId → regId
  const multiMatchIds = new Set<string>();
  for (const [id, regs] of nodeMatchedRegs) {
    if (regs.length === 1) singleMatchOf.set(id, regs[0]!);
    else multiMatchIds.add(id);
  }

  // Step 3: Compute region radii based on actual single-match occupants.
  interface RegionLayout {
    reg: (typeof catRegions)[0];
    childIds: string[];
    childCount: number;
    radius: number;
    childColor: string;
    x: number;
    y: number;
  }
  const regionLayouts: RegionLayout[] = catRegions.map((reg) => {
    const childIds = [...singleMatchOf.entries()]
      .filter(([, rid]) => rid === reg.id)
      .map(([id]) => id)
      .sort();
    const childCount = childIds.length;
    const radius = Math.max(100, 60 + childCount * 12);
    const colorMatch = reg.color.match(/oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/);
    const chroma = colorMatch ? colorMatch[1] : "0.12";
    const hue = colorMatch ? colorMatch[2] : "0";
    return { reg, childIds, childCount, radius, childColor: `oklch(${brighterLightness} ${chroma} ${hue})`, x: 0, y: 0 };
  });

  // Step 4: Compute initial ringR — large enough that:
  // a) no two adjacent regions overlap (chord formula), and
  // b) regions clear the landing element at the origin (META_RADIUS).
  const META_RADIUS = 100; // safe clearance around origin (landing element)
  const maxRegRadius = regionLayouts.length > 0 ? Math.max(...regionLayouts.map((rl) => rl.radius)) : 0;
  let ringR = Math.max(200, maxRegRadius + META_RADIUS + 40);
  if (N >= 2) {
    const maxPairNeed = Math.max(
      ...regionLayouts.map((rl, i) => rl.radius + regionLayouts[(i + 1) % N]!.radius + 40),
    );
    ringR = Math.max(ringR, Math.ceil((maxPairNeed / 2) / Math.sin(Math.PI / N)));
  }

  // Step 5: Set initial ring positions for regions.
  regionLayouts.forEach((rl, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / N;
    rl.x = ringR * Math.cos(angle);
    rl.y = ringR * Math.sin(angle);
  });

  // Step 6: Prepare multi-match nodes (blended color, initial position = centroid of matched regions).
  interface MNode { id: string; x: number; y: number; r: number; regs: string[]; blendedColor?: string; }
  const mnodes: MNode[] = [];
  for (const id of multiMatchIds) {
    const regs = nodeMatchedRegs.get(id)!;
    const cx = regs.reduce((s, rid) => s + (regionLayouts.find((rl) => rl.reg.id === rid)?.x ?? 0), 0) / regs.length;
    const cy = regs.reduce((s, rid) => s + (regionLayouts.find((rl) => rl.reg.id === rid)?.y ?? 0), 0) / regs.length;
    const node = eligibleNodes.find((n) => n.id === id)!;
    const hues: number[] = [], chromas: number[] = [];
    for (const rid of regs) {
      const regColor = catRegions.find((r) => r.id === rid)?.color ?? "";
      const m = regColor.match(/oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/);
      if (m) { chromas.push(Number(m[1])); hues.push(Number(m[2])); }
    }
    const blendedColor = hues.length > 0
      ? `oklch(${brighterLightness} ${(chromas.reduce((a, b) => a + b, 0) / chromas.length).toFixed(3)} ${Math.round(hues.reduce((a, b) => a + b, 0) / hues.length)})`
      : undefined;
    mnodes.push({ id, x: cx, y: cy, r: node.radius, regs, blendedColor });
  }

  // Unmatched nodes: all nodes not placed in any ring (explicitly excluded or simply unmatched).
  interface UnmatchedNode { id: string; x: number; y: number; r: number; }
  const unmatchedNodes: UnmatchedNode[] = eligibleNodes
    .filter((n) => !singleMatchOf.has(n.id) && !multiMatchIds.has(n.id))
    .map((n, i, arr) => {
      const angle = (2 * Math.PI * i) / Math.max(arr.length, 1);
      return { id: n.id, x: Math.cos(angle) * 50, y: Math.sin(angle) * 50, r: n.radius };
    });

  // Step 7: Global sim — regions, multi-match nodes, unmatched nodes. No cross-grouping position inheritance.
  // Regions soft-anchored to ring positions; multi-match anchored to centroid of matched regions.
  // Unmatched nodes seeded near origin, pushed out by repulsion + gravity.
  const GSIM_STEPS = 400;
  const PUSH = 2.0;
  const REGION_ANCHOR_K = 0.05;
  const MULTI_ANCHOR_K = 0.03;
  const UNMATCHED_GRAVITY_K = 0.004;
  const UNMATCHED_REPULSION = 8000;
  for (let step = 0; step < GSIM_STEPS; step++) {
    const rfx = regionLayouts.map(() => 0);
    const rfy = regionLayouts.map(() => 0);
    const mfx = mnodes.map(() => 0);
    const mfy = mnodes.map(() => 0);
    const ufx = unmatchedNodes.map(() => 0);
    const ufy = unmatchedNodes.map(() => 0);

    // Region–region repulsion
    for (let i = 0; i < regionLayouts.length; i++) {
      for (let j = i + 1; j < regionLayouts.length; j++) {
        const a = regionLayouts[i]!, b = regionLayouts[j]!;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const minD = a.radius + b.radius + 40;
        if (d < minD) {
          const push = (minD - d) / 2 * PUSH;
          rfx[i]! += (dx / d) * push; rfy[i]! += (dy / d) * push;
          rfx[j]! -= (dx / d) * push; rfy[j]! -= (dy / d) * push;
        }
      }
    }

    // Region–landing repulsion
    for (let i = 0; i < regionLayouts.length; i++) {
      const rl = regionLayouts[i]!;
      const d = Math.hypot(rl.x, rl.y) || 0.1;
      const minD = rl.radius + META_RADIUS + 20;
      if (d < minD) {
        const push = (minD - d) * PUSH;
        rfx[i]! += (rl.x / d) * push; rfy[i]! += (rl.y / d) * push;
      }
    }

    // Region–unmatched repulsion (both move)
    for (let i = 0; i < regionLayouts.length; i++) {
      for (let k = 0; k < unmatchedNodes.length; k++) {
        const rl = regionLayouts[i]!, u = unmatchedNodes[k]!;
        const dx = u.x - rl.x, dy = u.y - rl.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const minD = rl.radius + u.r + 80;
        if (d < minD) {
          const push = (minD - d) / 2 * PUSH;
          ufx[k]! += (dx / d) * push; ufy[k]! += (dy / d) * push;
          rfx[i]! -= (dx / d) * push; rfy[i]! -= (dy / d) * push;
        }
      }
    }

    // Region–multi repulsion
    for (let i = 0; i < regionLayouts.length; i++) {
      for (let j = 0; j < mnodes.length; j++) {
        const r = regionLayouts[i]!, m = mnodes[j]!;
        const dx = m.x - r.x, dy = m.y - r.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const minD = r.radius + m.r + 15;
        if (d < minD) {
          const push = (minD - d) * PUSH;
          mfx[j]! += (dx / d) * push; mfy[j]! += (dy / d) * push;
        }
      }
    }

    // Multi–multi repulsion
    for (let i = 0; i < mnodes.length; i++) {
      for (let j = i + 1; j < mnodes.length; j++) {
        const a = mnodes[i]!, b = mnodes[j]!;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const minD = a.r + b.r + 8;
        if (d < minD) {
          const push = (minD - d) / 2 * PUSH;
          mfx[i]! += (dx / d) * push; mfy[i]! += (dy / d) * push;
          mfx[j]! -= (dx / d) * push; mfy[j]! -= (dy / d) * push;
        }
      }
    }

    // Multi–landing repulsion
    for (let j = 0; j < mnodes.length; j++) {
      const m = mnodes[j]!;
      const d = Math.hypot(m.x, m.y) || 0.1;
      const minD = m.r + META_RADIUS + 20;
      if (d < minD) {
        const push = (minD - d) * PUSH;
        mfx[j]! += (m.x / d) * push; mfy[j]! += (m.y / d) * push;
      }
    }

    // Multi–unmatched repulsion (both move)
    for (let j = 0; j < mnodes.length; j++) {
      for (let k = 0; k < unmatchedNodes.length; k++) {
        const m = mnodes[j]!, u = unmatchedNodes[k]!;
        const dx = m.x - u.x, dy = m.y - u.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const minD = m.r + u.r + 8;
        if (d < minD) {
          const push = (minD - d) / 2 * PUSH;
          mfx[j]! += (dx / d) * push; mfy[j]! += (dy / d) * push;
          ufx[k]! -= (dx / d) * push; ufy[k]! -= (dy / d) * push;
        }
      }
    }

    // Unmatched–unmatched: soft 1/d² repulsion
    for (let i = 0; i < unmatchedNodes.length; i++) {
      for (let j = i + 1; j < unmatchedNodes.length; j++) {
        const a = unmatchedNodes[i]!, b = unmatchedNodes[j]!;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const force = UNMATCHED_REPULSION / (d * d);
        ufx[i]! += (dx / d) * force; ufy[i]! += (dy / d) * force;
        ufx[j]! -= (dx / d) * force; ufy[j]! -= (dy / d) * force;
      }
    }

    // Unmatched–landing repulsion
    for (let k = 0; k < unmatchedNodes.length; k++) {
      const u = unmatchedNodes[k]!;
      const d = Math.hypot(u.x, u.y) || 0.1;
      const minD = u.r + META_RADIUS + 20;
      if (d < minD) {
        const push = (minD - d) * PUSH;
        ufx[k]! += (u.x / d) * push; ufy[k]! += (u.y / d) * push;
      }
    }

    // Unmatched gravity toward origin
    for (let k = 0; k < unmatchedNodes.length; k++) {
      const u = unmatchedNodes[k]!;
      ufx[k]! += (0 - u.x) * UNMATCHED_GRAVITY_K;
      ufy[k]! += (0 - u.y) * UNMATCHED_GRAVITY_K;
    }

    // Anchor: regions → ring positions
    for (let i = 0; i < regionLayouts.length; i++) {
      const rl = regionLayouts[i]!;
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / N;
      rfx[i]! += (ringR * Math.cos(angle) - rl.x) * REGION_ANCHOR_K;
      rfy[i]! += (ringR * Math.sin(angle) - rl.y) * REGION_ANCHOR_K;
    }

    // Anchor: multi-match → centroid of matched regions
    for (let j = 0; j < mnodes.length; j++) {
      const m = mnodes[j]!;
      const matchedRls = m.regs.map((rid) => regionLayouts.find((rl) => rl.reg.id === rid)).filter(Boolean) as RegionLayout[];
      const cx = matchedRls.reduce((s, rl) => s + rl.x, 0) / matchedRls.length;
      const cy = matchedRls.reduce((s, rl) => s + rl.y, 0) / matchedRls.length;
      mfx[j]! += (cx - m.x) * MULTI_ANCHOR_K;
      mfy[j]! += (cy - m.y) * MULTI_ANCHOR_K;
    }

    // Apply forces
    for (let i = 0; i < regionLayouts.length; i++) {
      regionLayouts[i]!.x += rfx[i]!;
      regionLayouts[i]!.y += rfy[i]!;
    }
    for (let j = 0; j < mnodes.length; j++) {
      mnodes[j]!.x += mfx[j]!;
      mnodes[j]!.y += mfy[j]!;
    }
    for (let k = 0; k < unmatchedNodes.length; k++) {
      unmatchedNodes[k]!.x += ufx[k]!;
      unmatchedNodes[k]!.y += ufy[k]!;
    }
  }

  // Step 8: Build output. Every eligible node gets an explicit position from this grouping's own computation.
  const builtRegions: GroupingOutput["regions"] = [];
  const allPositions: Record<string, { x: number; y: number; regionId?: string; regionIds?: string[]; color?: string }> = {};

  for (const rl of regionLayouts) {
    const rx = Math.round(rl.x), ry = Math.round(rl.y);
    builtRegions.push({
      id: rl.reg.id, label: rl.reg.label, description: rl.reg.description,
      x: rx, y: ry, radius: rl.radius, color: rl.reg.color,
    });
    const childRingR = Math.max(60, rl.radius * 0.7 + rl.childCount * 3);
    Object.assign(allPositions, ringPositions(rx, ry, childRingR, rl.childIds, rl.reg.id, rl.childColor));
  }

  for (const n of mnodes) {
    allPositions[n.id] = {
      x: Math.round(n.x), y: Math.round(n.y),
      ...(n.regs.length > 0 ? { regionIds: n.regs } : {}),
      ...(n.blendedColor ? { color: n.blendedColor } : {}),
    };
  }

  for (const u of unmatchedNodes) {
    allPositions[u.id] = { x: Math.round(u.x), y: Math.round(u.y) };
  }

  return { id: groupingId, label: groupingLabel, regions: builtRegions, positions: allPositions };
}

generatedGroupings.push(buildTagGrouping("ecosystem", "Ecosystems", "ecosystem", "0.75"));
generatedGroupings.push(buildTagGrouping("domain", "Domains", "domain", "0.75"));
generatedGroupings.push(buildTagGrouping("tech", "Technologies", "technology", "0.75"));
generatedGroupings.push(buildTagGrouping("status", "Status", "status", "0.75"));

// ---------------------------------------------------------------------------
// 8. Write output
// ---------------------------------------------------------------------------

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
  if (n.parent) fields.push(`parent: "${n.parent}"`);
  if (n.cluster) fields.push(`cluster: "${n.cluster}"`);
  fields.push(`x: ${n.x}`);
  fields.push(`y: ${n.y}`);
  fields.push(`radius: ${n.radius}`);
  if (n.iconRadius != null) fields.push(`iconRadius: ${n.iconRadius}`);
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

function quoteGrouping(s: string): string {
  if (s.includes('"') || s.includes("\n") || s.includes("\\")) {
    return JSON.stringify(s);
  }
  return `"${s}"`;
}

// Only emit groupings that have regions — empty groupings produce meaningless tabs
const nonEmptyGroupings = generatedGroupings.filter((g) => g.regions.length > 0);

const groupingLines = nonEmptyGroupings.map((g) => {
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
console.log(`wrote ${nonEmptyGroupings.length} groupings to ${groupingsOutFile}`);

} // end generateGraph

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------
if (import.meta.path === Bun.main) {
  const args = Bun.argv.slice(2).filter((a) => !a.startsWith("-"));
  await generateGraph(args.length > 0 ? args : undefined);
}
