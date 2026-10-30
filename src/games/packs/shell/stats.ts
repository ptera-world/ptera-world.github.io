import { namespace } from "../../core/storage";
import type { Metric } from "../../core/types";

/**
 * How games ended, per puzzle, for stats. A game is recorded the first time it ends (solved,
 * revealed or lost) and never rewritten, so undoing a loss and then winning doesn't change it:
 * the record is how the game went, not where it was left.
 */
export interface Result {
  /** Saved-game id. */
  id: string;
  at: number;
  /** The date, for a puzzle of the day. */
  daily?: string;
  /** Canonical params, so stats can be split by settings. */
  params: string;
  outcome: "solved" | "revealed" | "lost";
  ms: number;
  score?: { value: number; label: string; better: "lower" | "higher" };
  /** The game's own measurements (PuzzleDef.metrics). */
  metrics?: Metric[];
}

/**
 * Which games are comparable: the puzzle of the day is its own setup (fixed params, everyone the
 * same), every other game is grouped by its exact params, imported puzzles together. Stats are
 * only ever summed within one setup, so a 16-board game never shares a histogram with a 1-board one.
 */
export function setupOf(r: Pick<Result, "daily" | "params">): string {
  return r.daily ? "daily" : r.params ? `p:${r.params}` : "imported";
}

/** Setups with results, most recently played first. */
export function setups(list: readonly Result[]): string[] {
  const last = new Map<string, number>();
  for (const r of list) last.set(setupOf(r), Math.max(last.get(setupOf(r)) ?? 0, r.at));
  return [...last.keys()].sort((a, b) => last.get(b)! - last.get(a)!);
}

const store = namespace("stats");
const KEEP = 2000;

export function results(puzzleId: string): Result[] {
  return store.get<Result[]>(puzzleId, []);
}

/** Record a game's end unless it was recorded before. True when it was new. */
export function record(puzzleId: string, r: Result): boolean {
  const list = results(puzzleId);
  if (list.some((x) => x.id === r.id)) return false;
  list.push(r);
  store.set(puzzleId, list.slice(-KEEP));
  return true;
}

export interface Summary {
  played: number;
  solved: number;
  bestMs: number | null;
  medianMs: number | null;
  /** Score value → how many games ended with it (revealed ones never count), with the label of one of them. */
  scores: { value: number; label: string; count: number }[];
  better: "lower" | "higher" | null;
  streak: number;
  bestStreak: number;
  /** Each measurement averaged over the games that had it. */
  metrics: { id: string; label: string; better: "lower" | "higher"; mean: number; n: number }[];
}

/** Totals over `list`; streaks count consecutive dates with a solved puzzle of the day, up to `today` or the day before. */
export function summarize(list: readonly Result[], today: string, dayBefore: (d: string) => string): Summary {
  const solved = list.filter((r) => r.outcome === "solved");
  const times = solved.map((r) => r.ms).sort((a, b) => a - b);
  const byScore = new Map<number, { value: number; label: string; count: number }>();
  for (const r of list) {
    if (!r.score || r.outcome === "revealed") continue;
    const e = byScore.get(r.score.value) ?? { value: r.score.value, label: r.score.label, count: 0 };
    e.count++;
    byScore.set(r.score.value, e);
  }
  const better = list.find((r) => r.score)?.score?.better ?? null;
  const won = new Set(list.filter((r) => r.daily && r.outcome === "solved").map((r) => r.daily!));
  const dates = [...new Set(list.filter((r) => r.daily).map((r) => r.daily!))].sort();
  let bestStreak = 0, run = 0, prev: string | null = null;
  for (const d of dates) {
    if (!won.has(d)) { run = 0; prev = d; continue; }
    run = prev !== null && dayBefore(d) === prev && won.has(prev) ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = d;
  }
  let streak = 0;
  let d = won.has(today) ? today : dayBefore(today);
  while (won.has(d)) { streak++; d = dayBefore(d); }
  const metrics = new Map<string, { id: string; label: string; better: "lower" | "higher"; sum: number; n: number }>();
  for (const r of list) {
    if (r.outcome === "revealed") continue;
    for (const m of r.metrics ?? []) {
      const e = metrics.get(m.id) ?? { id: m.id, label: m.label, better: m.better, sum: 0, n: 0 };
      e.sum += m.value;
      e.n++;
      metrics.set(m.id, e);
    }
  }
  return {
    metrics: [...metrics.values()].map(({ sum, ...m }) => ({ ...m, mean: sum / m.n })),
    played: list.length,
    solved: solved.length,
    bestMs: times[0] ?? null,
    medianMs: times.length ? times[Math.floor((times.length - 1) / 2)]! : null,
    scores: [...byScore.values()].sort((a, b) => a.value - b.value),
    better,
    streak,
    bestStreak,
  };
}

/**
 * A calendar file with a daily reminder at `time` (HH:MM, the player's local time wherever they
 * are, as a floating time), linking to `url`. Calendars on every platform import it, and it needs
 * no server.
 */
export function dailyReminderIcs(title: string, url: string, time: string, startDate: string): string {
  const [hh, mm] = time.split(":");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ptera.world//games//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:daily-${esc(title).replace(/\W+/g, "-")}@ptera.world`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${startDate.replace(/-/g, "")}T${hh}${mm}00`,
    "DURATION:PT15M",
    "RRULE:FREQ=DAILY",
    `SUMMARY:${esc(title)}`,
    `URL:${url}`,
    `DESCRIPTION:${esc(url)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
