import type { DataAttribute, DataItem, Dataset } from "../../core/types";

/** One named opening line: the moves from the starting position that the name belongs to. */
export interface OpeningItem extends DataItem {
  /** Its moves from the start, in SAN (with + and #), white's first. */
  moves: readonly string[];
}

export type OpeningsDataset = Dataset<OpeningItem>;

/** data.json: the attributes, and each line as upstream gives it (eco, name, SAN moves joined by spaces). */
export interface OpeningsDataFile {
  version: string;
  credits: string;
  attributes: DataAttribute[];
  lines: [eco: string, name: string, moves: string][];
}

declare module "../../core/types" {
  interface Datasets {
    openings: OpeningsDataset;
  }
}
