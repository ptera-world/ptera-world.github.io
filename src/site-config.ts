/** Site-level configuration. Change these values to rebrand the site. */

export interface CollectionConfig {
  name: string;
  metaNodeId: string;
  /** Content directories to include when building this collection's graph. */
  contentDirs: string[];
  /** Override neighborhoodFocus for this collection. Undefined = inherit from settings. */
  neighborhoodFocus?: boolean;
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
      contentDirs: ["meta", "fragments", "portal"],
      neighborhoodFocus: true,
    },
    projects: {
      name: "projects",
      metaNodeId: "meta/projects",
      contentDirs: ["meta", "project", "ecosystem", "domain", "technology", "status"],
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
    prose: {
      name: "prose",
      metaNodeId: "meta/prose",
      contentDirs: ["meta", "prose"],
    },
    hubris: {
      name: "hubris",
      metaNodeId: "meta/hubris",
      contentDirs: ["meta", "hubris"],
    },
    taste: {
      name: "taste",
      metaNodeId: "meta/taste",
      contentDirs: ["meta", "taste"],
    },
    intelligence: {
      name: "intelligence",
      metaNodeId: "meta/intelligence",
      contentDirs: ["meta", "intelligence"],
    },
  } satisfies Record<string, CollectionConfig>,
  /** Standalone apps served at /<id>/: own JS entry, own static dir under public/<id>/, no graph. */
  apps: {
    games: {
      name: "games",
      entry: "src/games/main.ts",
      packs: "src/games/packs",
    },
  } satisfies Record<string, AppConfig>,
} as const;

export interface AppConfig {
  name: string;
  /** Bundled to /<id>/main.js. */
  entry: string;
  /** Directory whose subdirectories (each with index.ts) are bundled as loadable packs and listed in /<id>/packs.json. */
  packs?: string;
}

export type AppId = keyof typeof siteConfig.apps;

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
