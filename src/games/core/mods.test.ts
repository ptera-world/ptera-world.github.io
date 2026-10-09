import { afterAll, beforeEach, expect, test } from "bun:test";
import { checkForUpdate, loadPacks, packHash, setTrack, type PackList } from "./mods";

const g = globalThis as Record<string, unknown>;
const saved = { localStorage: g.localStorage, location: g.location, fetch: g.fetch };
afterAll(() => Object.assign(g, saved));
const ls = new Map<string, string>();
g.localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => ls.set(k, v), removeItem: (k: string) => ls.delete(k) };
g.location = { href: "https://a.test/games/" };

const LIST = "https://a.test/games/packs.json";
const X = "https://a.test/games/x.js";
const Y = "https://b.test/y.js";
const files = new Map<string, string>();
let requests: string[] = [];
let online = true;
g.fetch = async (input: string | URL) => {
  const url = String(input);
  requests.push(url);
  if (!online) throw new TypeError("offline");
  const body = files.get(url);
  return body === undefined ? new Response("", { status: 404 }) : new Response(body);
};

const pack = (n: number) => `export default (g) => { g.ran.push(${n}); };`;
async function publish(x: string, y: string): Promise<void> {
  files.set(X, x);
  files.set(Y, y);
  const hash = async (s: string) => packHash(new TextEncoder().encode(s));
  const list: PackList = { name: "test", packs: [{ url: "./x.js", hash: await hash(x) }, { url: Y, hash: await hash(y) }] };
  files.set(LIST, JSON.stringify(list));
}
async function load(): Promise<number[]> {
  const api = { ran: [] as number[] };
  requests = [];
  const { packs } = await loadPacks(api, LIST);
  expect(packs.every((p) => !p.error)).toBe(true);
  return api.ran;
}

beforeEach(() => {
  online = true;
});

test("a list is the manifest of its packs: unchanged packs are not fetched again", async () => {
  await publish(pack(1), pack(2));
  expect(await load()).toEqual([1, 2]);
  expect(requests.sort()).toEqual([LIST, X, Y].sort());

  expect(await load()).toEqual([1, 2]);
  expect(requests).toEqual([LIST]);

  await publish(pack(3), pack(2));
  expect(await load()).toEqual([3, 2]);
  expect(requests.sort()).toEqual([LIST, X].sort());
});

test("a pinned pack stays on its version without fetching", async () => {
  await publish(pack(1), pack(2));
  await load();
  setTrack(X, "pinned");
  await publish(pack(4), pack(2));
  expect(await load()).toEqual([1, 2]);
  expect(requests).toEqual([LIST]);
  setTrack(X, "latest");
});

test("offline, the last fetched list and stored packs still load", async () => {
  await publish(pack(1), pack(2));
  await load();
  online = false;
  expect(await load()).toEqual([1, 2]);
});

test("checking a listed pack for updates costs one request when nothing changed", async () => {
  await publish(pack(1), pack(2));
  await load();
  requests = [];
  expect(await checkForUpdate(X)).toBeNull();
  expect(requests).toEqual([LIST]);
  await publish(pack(5), pack(2));
  requests = [];
  expect(await checkForUpdate(X)).not.toBeNull();
  expect(requests).toEqual([LIST, X]);
});
