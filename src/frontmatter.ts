/**
 * YAML frontmatter parser for build-time use.
 */
import { parse as parseYaml } from "yaml";

export interface Frontmatter {
  label: string;
  description: string;
  tier?: "region" | "artifact" | "meta";
  parent?: string;
  tags?: string[];
  url?: string;
  status?: "production" | "fleshed-out" | "early" | "planned";
  radius?: number;
  color?: string;
  cluster?: string;
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

/** Infer tier from content directory path. */
export function inferTier(category: string): "region" | "artifact" | "meta" | null {
  switch (category) {
    case "ecosystem":
      return "region";
    case "project":
    case "prose":
      return "artifact";
    case "meta":
      return "meta";
    default:
      return null;
  }
}

/** Infer auto-tags based on category and tier. */
export function inferTags(category: string, tier: string): string[] {
  const auto: string[] = [];
  if (tier === "artifact" && category !== "prose") auto.push("code");
  if (tier === "region") auto.push("region");
  if (tier === "meta") auto.push("meta");
  if (category === "prose") auto.push("essay");
  return auto;
}
