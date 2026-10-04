/**
 * Structural diffs between JSON values. apply(a, diff(a, b)) deep-equals b for any JSON a, b.
 * Arrays of equal length diff element-wise and objects key-wise, so a move that touches a few
 * cells of a large grid yields a few entries.
 */

export type Patch =
  | { r: unknown }
  | { a: [number, Patch][] }
  | { o: [string, Patch | null][] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** null when equal. */
export function diff(a: unknown, b: unknown): Patch | null {
  if (Object.is(a, b)) return null;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    const out: [number, Patch][] = [];
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i]);
      if (d) out.push([i, d]);
    }
    return out.length ? { a: out } : null;
  }
  if (isObj(a) && isObj(b)) {
    const out: [string, Patch | null][] = [];
    for (const k of Object.keys(b)) {
      if (!(k in a)) out.push([k, { r: b[k] }]);
      else {
        const d = diff(a[k], b[k]);
        if (d) out.push([k, d]);
      }
    }
    for (const k of Object.keys(a)) if (!(k in b)) out.push([k, null]);
    return out.length ? { o: out } : null;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  return { r: b };
}

/** New value; `a` is not mutated. */
export function apply(a: unknown, p: Patch | null): unknown {
  if (!p) return a;
  if ("r" in p) return structuredClone(p.r);
  if ("a" in p) {
    const out = (a as unknown[]).slice();
    for (const [i, d] of p.a) out[i] = apply(out[i], d);
    return out;
  }
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, d] of p.o) {
    if (d === null) delete out[k];
    else out[k] = apply(out[k], d);
  }
  return out;
}

const b64url = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Compact URL-safe text for any JSON value. */
export async function packJson(value: unknown): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  return b64url.encode(await pipe(raw, new CompressionStream("deflate-raw")));
}

export async function unpackJson(text: string): Promise<unknown> {
  const raw = await pipe(b64url.decode(text), new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(raw));
}
