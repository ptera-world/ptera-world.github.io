import { expect, test } from "bun:test";
import { addDays, dailySeed, dateStarts, roundAt, today } from "./daily";

// round 33488212 and its signature were fetched from api.drand.sh and drand.cloudflare.com
// (whose randomness 55746de7… is the SHA-256 of this signature)
const SIG = "a0c01060a5568a1028d06c3840ef3247dc98fe4c22b70d25f05dc536efb9baff960695a306f5ba08966e75f345c644ac";

test("a date starts at its midnight in UTC+14, and uses the first round from then", () => {
  expect(new Date(dateStarts("2026-10-30")).toISOString()).toBe("2026-10-29T10:00:00.000Z");
  expect(roundAt(dateStarts("2026-10-30"))).toBe(33488212);
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
});

test("the seed is the beacon's randomness for that round; relays that fail are skipped", async () => {
  const asked: string[] = [];
  const fake = (async (url: string) => {
    asked.push(url);
    if (asked.length === 1) return new Response("down", { status: 503 });
    return Response.json({ round: 33488212, signature: SIG });
  }) as unknown as typeof fetch;
  const seed = await dailySeed("2026-10-30", { now: Date.parse("2026-10-30T00:00:00Z"), fetch: fake });
  expect(seed).toBe("2026-10-30.55746de7b76d8103");
  expect(asked.length).toBe(2);
  expect(asked[1]).toContain("/33488212");
});

test("a date that hasn't started anywhere has no seed", async () => {
  const never = (async () => { throw new Error("must not be asked"); }) as unknown as typeof fetch;
  await expect(dailySeed("2026-11-02", { now: Date.parse("2026-11-01T09:59:59Z"), fetch: never })).rejects.toThrow("doesn't exist yet");
});
