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

/** A file's identity in the manifest: the first 16 hex digits of the SHA-256 of its bytes. */
export async function fileHash(bytes: BufferSource): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SwManifest {
  /** Identifies the exact set of files; changes whenever any listed file changes. */
  version: string;
  /** Key of every file the worker may keep, to the hash of its bytes in this deploy. */
  files: Record<string, string>;
}
