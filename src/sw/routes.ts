/**
 * URL keys shared by the build (which lists every file of a deploy) and the worker (which maps a
 * request onto that list). A key is a root-relative URL path; a directory's index.html is keyed
 * by the directory URL, so a file and the URL that serves it always agree.
 */

/** Key of a deployed file, given its path relative to the deploy root with "/" separators. */
export function keyForFile(rel: string): string {
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel}`;
}

/** Keys a request path may be served by, most specific first. A bare directory name is the directory. */
export function keysForPath(pathname: string): string[] {
  return pathname.endsWith("/") ? [pathname] : [pathname, `${pathname}/`];
}

export interface SwManifest {
  /** Identifies the exact set of files; changes whenever any listed file changes. */
  version: string;
  /** Keys of every file the worker keeps for offline use. */
  files: string[];
}
