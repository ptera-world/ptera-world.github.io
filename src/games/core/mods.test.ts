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

const MINE = "https://c.test/mine/packs.json";
const Z = "https://c.test/mine/z.js";
async function publishMine(z: string): Promise<void> {
  files.set(Z, z);
  files.set(MINE, JSON.stringify({ name: "mine", packs: [{ url: "./z.js", hash: await packHash(new TextEncoder().encode(z)) }] } satisfies PackList));
}

test("a player's list runs as stored and is checked after loading; changes apply from the next load", async () => {
  await publish(pack(1), pack(2));
  await publishMine(pack(7));
  ls.set("games:mods:list", JSON.stringify([{ id: "m", name: "mine", enabled: true, source: { url: MINE } }]));
  setTrack(Z, "latest");
  const run = async () => {
    const api = { ran: [] as number[] };
    requests = [];
    const r = await loadPacks(api, LIST);
    const before = [...requests];
    await r.checked;
    return { ran: api.ran, before, after: requests.slice(before.length), sources: r.sources };
  };

  const first = await run();
  expect(first.ran).toEqual([1, 2, 7]);

  let gate!: () => void;
  const realFetch = g.fetch as (u: string) => Promise<Response>;
  g.fetch = async (u: string) => {
    if (u === MINE) await new Promise<void>((r) => (gate = r));
    return realFetch(u);
  };
  await publishMine(pack(8));
  const api = { ran: [] as number[] };
  const r = await loadPacks(api, LIST);
  expect(api.ran).toEqual([1, 2, 7]);
  gate();
  expect(await r.checked).toBe(true);
  g.fetch = realFetch;

  const third = await run();
  expect(third.ran).toEqual([1, 2, 8]);
  expect([...third.before, ...third.after]).toEqual([LIST, MINE]);

  online = false;
  const offline = await run();
  expect(offline.ran).toEqual([1, 2, 8]);
  expect(offline.sources[0]!.error).toMatch(/couldn't check for updates/);
  online = true;
});

test("a pinned pack in a player's list is offered the update instead of switching", async () => {
  setTrack(Z, "pinned");
  await publishMine(pack(9));
  const r = await loadPacks({ ran: [] }, LIST);
  await r.checked;
  const api = { ran: [] as number[] };
  await loadPacks(api, LIST);
  expect(api.ran).toEqual([1, 2, 8]);
  const { packRecord } = await import("./mods");
  expect(packRecord(Z).available?.hash).toBe(await packHash(new TextEncoder().encode(pack(9))));
  ls.delete("games:mods:list");
});
