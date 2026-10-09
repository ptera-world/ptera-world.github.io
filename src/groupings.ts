/**
 * Groupings define alternative spatial arrangements of the graph.
 * Each grouping has its own regions (top-level containers) and
 * positions for project nodes.
 *
 * Grouping data is generated at build time from content files.
 */


export interface Region {
  id: string;
  label: string;
  description: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface NodePosition {
  x: number;
  y: number;
  regionId?: string;
  regionIds?: string[]; // Multi-match: edges to multiple regions
  color?: string;
}

export interface Grouping {
  id: string;
  label: string;
  regions: Region[];
  /** Position overrides for nodes. If not specified, node uses default position. */
  positions: Record<string, NodePosition>;
}

/** The collection's groupings; filled from its data before anything reads them. */
export const groupings: Grouping[] = [];

export function getGrouping(id: string): Grouping | undefined {
  return groupings.find((g) => g.id === id);
}
