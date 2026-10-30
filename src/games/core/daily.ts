import { namespace } from "./storage";

/**
 * Puzzles of the day that nobody can know in advance. A date's seed is drawn from the drand
 * quicknet beacon (a public randomness beacon run by the League of Entropy, a round every 3 s) at
 * the moment that date first begins anywhere: its midnight at UTC+14. Before then the round
 * doesn't exist, so no page, link or source code holds a future answer; after it, everyone
 * computes the same seed. Once fetched, a date's seed is kept, so it plays offline from then on.
 *
 * The beacon's signature is not verified here (that needs BLS12-381 code); the relays are trusted
 * over HTTPS. Quicknet's randomness is the SHA-256 of its signature, so any relay gives the same.
 */

const GENESIS = 1692803367;
const PERIOD = 3;
const CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const RELAYS: ((round: number) => string)[] = [
  (r) => `https://api.drand.sh/v2/beacons/quicknet/rounds/${r}`,
  (r) => `https://api2.drand.sh/v2/beacons/quicknet/rounds/${r}`,
  (r) => `https://drand.cloudflare.com/${CHAIN}/public/${r}`,
];
/** The earliest time zone: a date starts there first. */
const EARLIEST_OFFSET_H = 14;

export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The player's local date, YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The date `days` after `date`. */
export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** When `date` first begins anywhere (ms since the epoch). */
export function dateStarts(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EARLIEST_OFFSET_H * 3600_000;
}

/** The first beacon round at or after `ms`. */
export function roundAt(ms: number): number {
  return Math.max(1, Math.ceil((ms / 1000 - GENESIS) / PERIOD) + 1);
}

const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (h: string): Uint8Array<ArrayBuffer> => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** The beacon's randomness for a round (hex), from the first relay that answers. */
export async function beacon(round: number, fetchImpl: typeof fetch = fetch): Promise<string> {
  let last: unknown = null;
  for (const url of RELAYS) {
    try {
      const res = await fetchImpl(url(round));
      if (!res.ok) { last = new Error(`${res.status}`); continue; }
      const body = (await res.json()) as { round?: number; signature?: string };
      if (body.round !== round || !body.signature || !/^[0-9a-f]+$/.test(body.signature)) { last = new Error("unexpected answer"); continue; }
      return hex(await crypto.subtle.digest("SHA-256", bytes(body.signature)));
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`couldn't reach the randomness beacon (${last instanceof Error ? last.message : String(last)})`);
}

const kept = namespace("daily");

/**
 * The seed of `date`'s puzzles: `<date>.<16 hex digits>`. Throws if the date hasn't started
 * anywhere yet, or when the beacon can't be reached and the seed wasn't fetched before.
 */
export async function dailySeed(date: string, opts: { now?: number; fetch?: typeof fetch } = {}): Promise<string> {
  const known = kept.get<string | null>(date, null);
  if (known) return known;
  const starts = dateStarts(date);
  if ((opts.now ?? Date.now()) < starts) throw new Error(`the puzzle for ${date} doesn't exist yet`);
  const seed = `${date}.${(await beacon(roundAt(starts), opts.fetch)).slice(0, 16)}`;
  kept.set(date, seed);
  return seed;
}
