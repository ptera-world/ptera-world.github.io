/**
 * inspect-layout.ts - Compact ASCII layout inspector with area-accurate rendering.
 * Usage: bun run src/inspect-layout.ts
 *
 * Fully data-driven: all logic derived from generatedNodes structural properties.
 * No content-specific constants, no hardcoded IDs, no CSS-derived dimensions.
 */

import { generatedNodes } from "./generated-graph";
import { convexHull, expandHull, filterOutliers, hullSeparation, boundingCircle } from "./hull";

const W = 90;
const H = 38;
const PAD = 50;

const xs = generatedNodes.map((n) => n.x);
const ys = generatedNodes.map((n) => n.y);
const minX = Math.min(...xs) - PAD, maxX = Math.max(...xs) + PAD;
const minY = Math.min(...ys) - PAD, maxY = Math.max(...ys) + PAD;
const scaleX = (W - 1) / (maxX - minX);
const scaleY = (H - 1) / (maxY - minY);

function toC(wx: number, wy: number): [number, number] {
  return [Math.round((wx - minX) * scaleX), Math.round((wy - minY) * scaleY)];
}

const bg: string[][] = Array.from({ length: H }, () => Array(W).fill(" "));
const fg: Array<Array<{ ch: string; count: number }>> = Array.from(
  { length: H }, () => Array.from({ length: W }, () => ({ ch: " ", count: 0 })),
);

function bgSet(cx: number, cy: number, ch: string, force = false) {
  if (cx < 0 || cx >= W || cy < 0 || cy >= H) return;
  if (bg[cy]![cx] === " " || force) bg[cy]![cx] = ch;
}
function bgStr(cx: number, cy: number, s: string, force = false) {
  for (let i = 0; i < s.length; i++) bgSet(cx + i, cy, s[i]!, force);
}
function fgArea(wx: number, wy: number, wr: number, ch: string) {
  const [ccx, ccy] = toC(wx, wy);
  const rx = Math.max(1, wr * scaleX);
  const ry = Math.max(1, wr * scaleY);
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1.0) {
        const cx = ccx + dx, cy = ccy + dy;
        if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
        fg[cy]![cx]!.count++;
        if (fg[cy]![cx]!.count === 1) fg[cy]![cx]!.ch = ch;
      }
    }
  }
}
/** Draw an axis-aligned bounding box outline in the background layer. */
function drawRect(wxMin: number, wyMin: number, wxMax: number, wyMax: number, ch: string) {
  const [x0, y0] = toC(wxMin, wyMin);
  const [x1, y1] = toC(wxMax, wyMax);
  for (let cx = x0; cx <= x1; cx++) { bgSet(cx, y0, ch); bgSet(cx, y1, ch); }
  for (let cy = y0; cy <= y1; cy++) { bgSet(x0, cy, ch); bgSet(x1, cy, ch); }
}

function drawCircle(wx: number, wy: number, wr: number, ch: string) {
  const steps = Math.max(80, Math.ceil(2 * Math.PI * wr * Math.max(scaleX, scaleY) * 2));
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    const [cx, cy] = toC(wx + wr * Math.cos(a), wy + wr * Math.sin(a));
    bgSet(cx, cy, ch);
  }
}

// Origin
{ const [cx, cy] = toC(0, 0); bgSet(cx, cy, "+"); }

// Meta nodes: mark position
for (const n of generatedNodes.filter((n) => n.tags.includes("meta"))) {
  const [cx, cy] = toC(n.x, n.y);
  bgStr(cx - 1, cy, "[L]", true);
}

// Cluster bounding circles — grouped by cluster id from generated data (no hardcoded names)
const artifacts = generatedNodes.filter((n) => !n.tags.includes("meta"));

// Group artifacts by cluster id dynamically
const clusterMap = new Map<string, typeof artifacts>();
for (const n of artifacts) {
  if (!n.cluster) continue;
  const grp = clusterMap.get(n.cluster) ?? [];
  grp.push(n);
  clusterMap.set(n.cluster, grp);
}
for (const [clusterId, members] of clusterMap) {
  const b = boundingCircle(members.map((n) => ({ x: n.x, y: n.y })));
  drawCircle(b.cx, b.cy, b.r, "╌");
  const lbl = `${clusterId}(${members.length})`;
  const [cx, cy] = toC(b.cx, b.cy);
  bgStr(cx - Math.floor(lbl.length / 2), cy, lbl, true);
}

// AABBs — axis-aligned bounding boxes for every group (drawn as outlines in background)
type AABB = { minX: number; minY: number; maxX: number; maxY: number; label: string };
const aabbs: AABB[] = [];

function groupAABB(nodes: typeof artifacts): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...nodes.map((n) => n.x - n.radius)),
    minY: Math.min(...nodes.map((n) => n.y - n.radius)),
    maxX: Math.max(...nodes.map((n) => n.x + n.radius)),
    maxY: Math.max(...nodes.map((n) => n.y + n.radius)),
  };
}

for (const [clusterId, members] of clusterMap) {
  const bb = groupAABB(members);
  aabbs.push({ ...bb, label: clusterId });
  drawRect(bb.minX, bb.minY, bb.maxX, bb.maxY, "·");
}

// Build hulls for clusters (used for collision reporting below; display uses bounding circles)
type NodeHull = { hull: ReturnType<typeof convexHull>; members: typeof artifacts; maxR: number };
const clusterHulls = new Map<string, NodeHull>();
for (const [clusterId, members] of clusterMap) {
  const maxR = Math.max(...members.map((n) => n.radius), 1);
  const pts = filterOutliers(members.map((n) => ({ x: n.x, y: n.y })));
  const hull = expandHull(convexHull(pts), maxR);
  clusterHulls.set(clusterId, { hull, members, maxR });
}

// Draw all artifact nodes as filled area disks
// prose = ·  orphan (parentless non-prose) = O  ecosystem child = first letter of label uppercase
for (const n of artifacts) {
  const ch = n.tags.includes("essay") ? "·"
    : !n.parent ? "O"
    : n.label[0]?.toUpperCase() ?? "?";
  fgArea(n.x, n.y, n.radius, ch);
}

// Print
console.log(`\nBounds x[${Math.round(minX)}…${Math.round(maxX)}] y[${Math.round(minY)}…${Math.round(maxY)}]  scale ${(1/scaleX).toFixed(1)}wu/col ${(1/scaleY).toFixed(1)}wu/row\n`);
console.log("┌" + "─".repeat(W) + "┐");
for (let cy = 0; cy < H; cy++) {
  let row = "";
  for (let cx = 0; cx < W; cx++) {
    const cell = fg[cy]![cx]!;
    if (cell.count === 0) row += bg[cy]![cx];
    else if (cell.count === 1) row += cell.ch;
    else row += cell.count <= 9 ? String(cell.count) : "+";
  }
  console.log("│" + row + "│");
}
console.log("└" + "─".repeat(W) + "┘");
console.log("Legend: ╌=cluster boundary  [L]=meta  ·=prose  O=orphan  UPPER=eco-child\n");

// ── Collision report ──────────────────────────────────────────────────────────

// Node-level: pairwise dot overlap (bounding circles)
const dotOverlaps: Array<{ a: typeof generatedNodes[0]; b: typeof generatedNodes[0]; overlap: number }> = [];

for (let i = 0; i < generatedNodes.length; i++) {
  for (let j = i + 1; j < generatedNodes.length; j++) {
    const a = generatedNodes[i]!, b = generatedNodes[j]!;
    if (a.tags.includes("meta") || b.tags.includes("meta")) continue;
    if (a.radius === 0 || b.radius === 0) continue;
    if (a.parent && b.parent && a.parent === b.parent) continue; // siblings: ring handles spacing
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const gap = dist - a.radius - b.radius;
    if (gap < 0) dotOverlaps.push({ a, b, overlap: -gap });
  }
}

dotOverlaps.sort((a, b) => b.overlap - a.overlap);

if (dotOverlaps.length === 0) {
  console.log("✓ No dot overlaps.\n");
} else {
  const shown = dotOverlaps.slice(0, 12);
  console.log(`Dot overlaps (${dotOverlaps.length} total, worst ${shown.length} shown):`);
  for (const { a, b, overlap } of shown)
    console.log(`  ▲ ${overlap.toFixed(0).padStart(3)}px  ${a.id}  ↔  ${b.id}`);
  if (dotOverlaps.length > shown.length) console.log(`  … +${dotOverlaps.length - shown.length} more`);
  console.log();
}

// Group-level: hull-based separation between clusters and regions
// Uses convex hull of node centers expanded by max node radius per group.
// Outliers (>1.5σ from centroid) are excluded from hull computation but not from display.
type GroupHull = { id: string; label: string; hull: ReturnType<typeof convexHull> };
const groupHulls: GroupHull[] = [];

for (const [clusterId, { hull }] of clusterHulls) {
  groupHulls.push({ id: `cluster:${clusterId}`, label: clusterId, hull });
}

const groupOverlaps: Array<{ a: string; b: string; overlap: number }> = [];
const groupGaps: Array<{ a: string; b: string; gap: number }> = [];

for (let i = 0; i < groupHulls.length; i++) {
  for (let j = i + 1; j < groupHulls.length; j++) {
    const ga = groupHulls[i]!, gb = groupHulls[j]!;
    const sep = hullSeparation(ga.hull, gb.hull);
    if (sep <= 0) groupOverlaps.push({ a: ga.label, b: gb.label, overlap: -sep });
    else groupGaps.push({ a: ga.label, b: gb.label, gap: sep });
  }
}

groupOverlaps.sort((a, b) => b.overlap - a.overlap);
groupGaps.sort((a, b) => a.gap - b.gap);

if (groupOverlaps.length === 0) {
  console.log("✓ No hull overlaps between groups.\n");
} else {
  console.log(`Hull overlaps (${groupOverlaps.length}):`);
  for (const { a, b, overlap } of groupOverlaps)
    console.log(`  ▲ ${overlap.toFixed(0).padStart(4)}  ${a}  ↔  ${b}`);
  console.log();
}

if (groupGaps.length > 0) {
  console.log("Closest group pairs (hull separation):");
  for (const { a, b, gap } of groupGaps.slice(0, 5))
    console.log(`  ${gap.toFixed(0).padStart(4)}  ${a}  —  ${b}`);
  console.log();
}

// ── Summaries ─────────────────────────────────────────────────────────────────

console.log("Clusters:");
for (const [clusterId, members] of clusterMap) {
  const b = boundingCircle(members.map((n) => ({ x: n.x, y: n.y })));
  const extra = members.length <= 6 ? `  nodes: ${members.map((n) => n.label).join(", ")}` : "";
  console.log(`  ${clusterId}(${members.length}): centroid=(${Math.round(b.cx)},${Math.round(b.cy)})  r=${Math.round(b.r)}${extra}`);
}

console.log("\nAABBs (minX minY → maxX maxY):");
for (const { label, minX, minY, maxX, maxY } of aabbs) {
  const w = maxX - minX, h = maxY - minY;
  console.log(`  ${label.padEnd(14)} (${Math.round(minX)}, ${Math.round(minY)}) → (${Math.round(maxX)}, ${Math.round(maxY)})  ${Math.round(w)}×${Math.round(h)}`);
}

const metaNodes = generatedNodes.filter((n) => n.tags.includes("meta"));
if (metaNodes.length > 0) {
  console.log(`\nMeta nodes: ${metaNodes.map((n) => `${n.id}@(${n.x},${n.y})`).join("  ")}`);
}
console.log();
