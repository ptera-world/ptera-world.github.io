/**
 * YAML frontmatter parser for build-time use.
 */
import { parse as parseYaml } from "yaml";

export interface Frontmatter {
  label: string;
  description: string;
  parent?: string;
  tags?: string[];
  url?: string;
  status?: "production" | "fleshed-out" | "early" | "planned";
  radius?: number;
  color?: string;
  cluster?: string;
  collections?: string[];
}

/** Strip frontmatter from markdown source, returning the body. */
export function stripFrontmatter(src: string): string {
  if (src.startsWith("---\n")) {
    const end = src.indexOf("\n---", 4);
    if (end !== -1) return src.slice(end + 4).trimStart();
  }
  return src;
}

/** Parse YAML frontmatter from markdown source. Returns null if no frontmatter found. */
export function parseFrontmatter(src: string): Frontmatter | null {
  if (!src.startsWith("---\n")) return null;
  const end = src.indexOf("\n---", 4);
  if (end === -1) return null;

  const yaml = src.slice(4, end);
  const result = parseYaml(yaml);

  if (!result || typeof result !== "object") return null;
  if (typeof result.label !== "string" || typeof result.description !== "string") return null;

  return result as Frontmatter;
}

