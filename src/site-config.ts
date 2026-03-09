/** Site-level configuration. Change these values to rebrand the site. */

export interface CollectionConfig {
  name: string;
  metaNodeId: string;
  /** Content directories to include when building this collection's graph. */
  contentDirs: string[];
}

export const siteConfig = {
  /** Display name shown in title bars and landing page. */
  name: "ptera",
  /** Full domain for og:url and og:site_name. */
  domain: "ptera.world",
  /** Base path for all site URLs. "/" is the default (root deployment). Override for subpath deployments, e.g. "/hubris". */
  basePath: "/",
  /** ID of the meta/landing node (default collection). */
  metaNodeId: "meta/pteraworld",
  /** Per-collection overrides. */
  collections: {
    default: {
      name: "ptera",
      metaNodeId: "meta/pteraworld",
      contentDirs: ["ecosystem", "meta", "project", "prose", "domain", "technology", "status"],
    },
    unfiltered: {
      name: "unfiltered",
      metaNodeId: "meta/unfiltered",
      contentDirs: ["meta", "unfiltered"],
    },
    intent: {
      name: "intent",
      metaNodeId: "meta/intent",
      contentDirs: ["meta", "intent"],
    },
    hubris: {
      name: "hubris",
      metaNodeId: "meta/hubris",
      contentDirs: ["meta", "hubris"],
    },
  } satisfies Record<string, CollectionConfig>,
} as const;

export type CollectionId = keyof typeof siteConfig.collections;

/** Detect active collection from <html data-collection="...">. Browser-only. */
export function getActiveCollection(): CollectionId {
  if (typeof document === "undefined") return "default";
  return (document.documentElement.dataset.collection as CollectionId) ?? "default";
}

/** Prepend basePath to an absolute-path string. Falls back to "/" if basePath is missing. */
export function siteUrl(path: string): string {
  const base = siteConfig.basePath ?? "/";
  return (base === "/" ? "" : base) + path;
}
