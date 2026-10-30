import { expect, test } from "bun:test";
import { addDays } from "../../core/daily";
import { dailyReminderIcs, summarize, type Result } from "./stats";

const before = (d: string) => addDays(d, -1);
const r = (id: string, outcome: Result["outcome"], extra: Partial<Result> = {}): Result => ({ id, at: 0, params: "", outcome, ms: 1000, ...extra });

test("streaks: consecutive solved dailies, alive through yesterday, broken by a loss or a gap", () => {
  const list = [
    r("a", "solved", { daily: "2026-10-01" }), r("b", "solved", { daily: "2026-10-02" }), r("c", "solved", { daily: "2026-10-03" }),
    r("d", "lost", { daily: "2026-10-04" }),
    r("e", "solved", { daily: "2026-10-06" }), r("f", "solved", { daily: "2026-10-07" }),
  ];
  expect(summarize(list, "2026-10-08", before)).toMatchObject({ streak: 2, bestStreak: 3, played: 6, solved: 5 });
  expect(summarize(list, "2026-10-07", before).streak).toBe(2);
  expect(summarize(list, "2026-10-09", before).streak).toBe(0);
});

test("scores: a histogram of every ending that has one but reveals; times from solved games", () => {
  const s = summarize([
    r("a", "solved", { score: { value: 3, label: "3 guesses", better: "lower" }, ms: 5000 }),
    r("b", "solved", { score: { value: 3, label: "3 guesses", better: "lower" }, ms: 2000 }),
    r("c", "solved", { score: { value: 5, label: "5 guesses", better: "lower" }, ms: 9000 }),
    r("d", "lost", { score: { value: 8, label: "8 guesses", better: "lower" }, ms: 1 }),
    r("e", "revealed", { score: { value: 9, label: "9 guesses", better: "lower" }, ms: 1 }),
    r("f", "lost", { ms: 1 }),
  ], "2026-10-08", before);
  expect(s.scores).toEqual([{ value: 3, label: "3 guesses", count: 2 }, { value: 5, label: "5 guesses", count: 1 }, { value: 8, label: "8 guesses", count: 1 }]);
  expect(s.bestMs).toBe(2000);
  expect(s.medianMs).toBe(5000);
});

test("reminder: a daily repeating event at a floating local time, with the link", () => {
  const ics = dailyReminderIcs("pokédle, today's puzzle", "https://ptera.world/games/?p=pokedle&daily", "09:30", "2026-10-30");
  expect(ics).toContain("DTSTART:20261030T093000\r\n");
  expect(ics).toContain("RRULE:FREQ=DAILY\r\n");
  expect(ics).toContain("SUMMARY:pokédle\\, today's puzzle\r\n");
  expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
});

test("moving devices: stats and saved games combine, this device's settings stay", async () => {
  const { mergeStorage } = await import("./play-widgets");
  const mem = new Map<string, string>();
  const local = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } } as unknown as Storage;
  mem.set("games:prefs:theme", JSON.stringify("dark"));
  mem.set("games:stats:x", JSON.stringify([{ id: "a", at: 1 }]));
  mem.set("games:games-index:list", JSON.stringify([{ id: "g1", updatedAt: 5 }, { id: "g2", updatedAt: 9 }]));
  mem.set("games:game:g1", "mine-old");
  mem.set("games:game:g2", "mine-new");
  const n = mergeStorage({
    "games:prefs:theme": JSON.stringify("light"),
    "games:prefs:locale": JSON.stringify("de"),
    "games:stats:x": JSON.stringify([{ id: "a", at: 1 }, { id: "b", at: 2 }]),
    "games:games-index:list": JSON.stringify([{ id: "g1", updatedAt: 7 }, { id: "g2", updatedAt: 3 }, { id: "g3", updatedAt: 1 }]),
    "games:game:g1": "theirs-newer", "games:game:g2": "theirs-older", "games:game:g3": "theirs-only",
    "games:packstore:https://x/pack.js": "{}",
  }, local);
  expect(n).toBeGreaterThan(0);
  expect(mem.get("games:prefs:theme")).toBe(JSON.stringify("dark"));
  expect(mem.get("games:prefs:locale")).toBe(JSON.stringify("de"));
  expect(JSON.parse(mem.get("games:stats:x")!).map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
  expect([mem.get("games:game:g1"), mem.get("games:game:g2"), mem.get("games:game:g3")]).toEqual(["theirs-newer", "mine-new", "theirs-only"]);
  expect(JSON.parse(mem.get("games:games-index:list")!).map((m: { id: string }) => m.id)).toEqual(["g2", "g1", "g3"]);
  expect(mem.has("games:packstore:https://x/pack.js")).toBe(false);
});

test("setups: dailies, each exact set of params, and imported puzzles are kept apart; metrics average per setup", () => {
  const { setupOf, setups, summarize: sum } = require("./stats") as typeof import("./stats");
  const m = (v: number) => [{ id: "first-right:type", label: "type right by guess", value: v, better: "lower" as const }];
  const list: Result[] = [
    r("a", "solved", { params: "boards=1", at: 1, metrics: m(2) }),
    r("b", "solved", { params: "boards=16", at: 2, metrics: m(9) }),
    r("c", "solved", { params: "boards=1", at: 3, metrics: m(4) }),
    r("d", "solved", { params: "boards=1", daily: "2026-10-30", at: 4 }),
    r("e", "lost", { params: "", at: 5 }),
  ];
  expect(setups(list)).toEqual(["imported", "daily", "p:boards=1", "p:boards=16"]);
  const one = list.filter((x) => setupOf(x) === "p:boards=1");
  expect(one.map((x) => x.id)).toEqual(["a", "c"]);
  expect(sum(one, "2026-10-31", before).metrics).toEqual([{ id: "first-right:type", label: "type right by guess", better: "lower", mean: 3, n: 2 }]);
});

test("setup labels: the day, a preset's name, default settings, or what differs from the defaults", async () => {
  const { setupLabel } = await import("./play-widgets");
  const { canonical, defineSchema, resolve } = await import("../../core/schema");
  const params = defineSchema({
    boards: { type: "int", label: "boards", default: 1, min: 1, max: 32 },
    mode: { type: "enum", label: "mode", default: "together", options: [{ value: "together", label: "together" }, { value: "sequence", label: "one after another" }] },
  });
  const def = { id: "x", name: "x", generatorVersion: 1, params, formats: [], presets: [{ label: "4 boards", params: { boards: 4 } }] } as never;
  const key = (v: Record<string, unknown>) => `p:${canonical(params, resolve(params, v))}`;
  expect(setupLabel(def, "daily")).toBe("puzzle of the day");
  expect(setupLabel(def, key({}))).toBe("default settings");
  expect(setupLabel(def, key({ boards: 4 }))).toBe("4 boards");
  expect(setupLabel(def, key({ boards: 8, mode: "sequence" }))).toBe("boards: 8 · mode: one after another");
});
