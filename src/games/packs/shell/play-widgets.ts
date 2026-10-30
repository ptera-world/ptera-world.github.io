import { add, clear, formatTime, h, style } from "../../core/dom";
import { packJson, unpackJson } from "../../core/patch";
import type { Session } from "../../core/session";
import type { AnyPuzzleDef, AnyWidget, WidgetDef } from "../../core/types";
import { canonical, defaultOf, fromQuery, optionsOf, resolve, type Field } from "../../core/schema";
import { confirmDialog } from "./dialog";
import { addDays, today } from "./engine";
import type { Shell } from "./shell";
import { dailyReminderIcs, results, setupOf, setups, summarize } from "./stats";

/** A field's value in words, for setup labels. */
function describe(field: Field, v: unknown, values: Record<string, unknown>): string {
  switch (field.type) {
    case "bool": return v ? "on" : "off";
    case "enum": return optionsOf(field, values).find((o) => o.value === v)?.label ?? String(v);
    case "set": return (v as readonly string[]).map((x) => optionsOf(field, values).find((o) => o.value === x)?.label ?? x).join(", ") || "none";
    default: return String(v);
  }
}

/**
 * A setup in words: the puzzle of the day, a preset's name when the params are exactly a preset,
 * "default settings", or the settings that differ from the defaults.
 */
export function setupLabel(def: AnyPuzzleDef, setup: string): string {
  if (setup === "daily") return "puzzle of the day";
  if (setup === "imported") return "imported puzzles";
  const values = fromQuery(def.params, new URLSearchParams(setup.slice(2)));
  const key = canonical(def.params, values);
  const preset = def.presets?.find((p) => canonical(def.params, resolve(def.params, p.params)) === key);
  if (preset) return preset.label;
  // each field against its default given the fields before it (a dataset's own default pool isn't a difference)
  const vals = values as Record<string, unknown>;
  const differs = Object.entries(def.params as Record<string, Field>).filter(([k, f]) =>
    canonical({ [k]: f }, { [k]: vals[k] } as never) !== canonical({ [k]: f }, { [k]: defaultOf(f, vals) } as never));
  return differs.length ? differs.map(([k, f]) => `${f.label}: ${describe(f, vals[k], vals)}`).join(" · ") : "default settings";
}

/** The setup of the open game. */
export function sessionSetup(s: Session<any, any, any, any>): string {
  const o = s.origin;
  return setupOf({ daily: o.kind === "generated" ? o.daily : undefined, params: o.kind === "generated" ? canonical(s.def.params, resolve(s.def.params, o.params)) : "" });
}

const CSS = `
.w-stats { display: flex; flex-direction: column; gap: 10px; }
.w-stats .st-nums { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
.w-stats .st-num { display: flex; flex-direction: column; align-items: center; padding: 6px; border: 1px solid var(--border); border-radius: 8px; }
.w-stats .st-num b { font-size: 20px; font-variant-numeric: tabular-nums; }
.w-stats .st-num span { font-size: 12px; color: var(--text-dim); text-align: center; }
.w-stats .st-bars { display: flex; flex-direction: column; gap: 3px; }
.w-stats .st-bar { display: grid; grid-template-columns: 7ch 1fr; gap: 6px; align-items: center; font-size: 12px; }
.w-stats .st-metrics .st-bar { grid-template-columns: minmax(7ch, 12ch) 1fr; }
.w-stats .st-setup { max-width: 100%; }
.w-stats .st-bar i { display: block; height: 14px; min-width: 2px; background: var(--accent); border-radius: 3px; font-style: normal; color: #fff; font-size: 11px; padding: 0 4px; box-sizing: border-box; text-align: right; line-height: 14px; }
.w-share { display: flex; flex-direction: column; gap: 6px; }
.w-share pre { margin: 0; padding: 8px; background: var(--surface-2); border-radius: 8px; white-space: pre-wrap; font-family: var(--font); font-size: 14px; line-height: 1.3; max-height: 220px; overflow-y: auto; }
`;

const copyButton = (text: () => string | Promise<string>, label = "copy"): HTMLButtonElement => {
  const b = h("button", {
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(await text());
        b.textContent = "copied";
      } catch {
        b.textContent = "couldn't copy";
      }
      setTimeout(() => { b.textContent = label; }, 1500);
    },
  }, label);
  return b;
};

/** The game's spoiler-free share text with a copy button, once it has ended; null if it has none. */
export function shareBlock(shell: Shell, s: Session<any, any, any, any>): HTMLElement | null {
  style("play-widgets", CSS);
  let text: string | null = null;
  try {
    text = s.def.shareText?.(s.puzzle, s.state) ?? null;
  } catch (e) {
    console.error(e);
  }
  if (!text) return null;
  // which setup it was, in words, and the link that opens the same one (same seed, or the same day)
  const o = s.origin;
  const setup = o.kind === "generated" && o.daily ? `puzzle of the day, ${o.daily}` : o.kind === "generated" ? setupLabel(s.def, sessionSetup(s)) : null;
  const full = [text, setup].filter(Boolean).join("\n");
  const withLink = async () => `${full}\n${new URL(await shell.shareUrl("puzzle"), location.href).href}`;
  return h("div", { class: "w-share" }, h("pre", null, full), h("div", { class: "w-inline" }, copyButton(withLink)));
}

/** "streak 4" for a puzzle of the day, else null. */
export function streakLine(s: Session<any, any, any, any>): string | null {
  if (s.origin.kind !== "generated" || !s.origin.daily) return null;
  const sum = summarize(results(s.def.id), today(), (d) => addDays(d, -1));
  return `streak ${sum.streak}${sum.bestStreak > sum.streak ? ` · best ${sum.bestStreak}` : ""}`;
}

/** Keys that move between devices: everything the games keep, except which pack code this browser has stored. */
const movable = (k: string): boolean => k.startsWith("games:") && !k.startsWith("games:packstore:") && !k.startsWith("games:packlists:");
const TRANSFER_TAG = "ptg1.";

function snapshotStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && movable(k)) out[k] = localStorage.getItem(k) ?? "";
  }
  return out;
}

/**
 * Bring another device's data in without losing this one's: results for stats are combined, saved
 * games are combined (the copy changed last wins), and anything else this device already has
 * (settings, layouts, keys) stays as it is. Returns how many keys changed.
 */
export function mergeStorage(incoming: Record<string, string>, local: Storage = localStorage): number {
  let changed = 0;
  const set = (k: string, v: string) => { if (local.getItem(k) !== v) { local.setItem(k, v); changed++; } };
  const parse = <T>(v: string | null, d: T): T => { try { return v === null ? d : (JSON.parse(v) as T); } catch { return d; } };
  const INDEX = "games:games-index:list";
  type Meta = { id: string; updatedAt: number };
  const mine = parse<Meta[]>(local.getItem(INDEX), []);
  const theirs = parse<Meta[]>(incoming[INDEX] ?? null, []);
  const byId = new Map(mine.map((m) => [m.id, m]));
  for (const t of theirs) {
    const m = byId.get(t.id);
    if (m && m.updatedAt >= t.updatedAt) continue;
    byId.set(t.id, t);
    const save = incoming[`games:game:${t.id}`];
    if (save !== undefined) set(`games:game:${t.id}`, save);
  }
  if (theirs.length) set(INDEX, JSON.stringify([...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)));
  for (const [k, v] of Object.entries(incoming)) {
    if (!movable(k) || k === INDEX || k.startsWith("games:game:")) continue;
    if (k.startsWith("games:stats:")) {
      const a = parse<{ id: string; at: number }[]>(local.getItem(k), []);
      const ids = new Set(a.map((r) => r.id));
      const merged = [...a, ...parse<{ id: string; at: number }[]>(v, []).filter((r) => !ids.has(r.id))].sort((x, y) => x.at - y.at);
      set(k, JSON.stringify(merged));
    } else if (local.getItem(k) === null) set(k, v);
  }
  return changed;
}

export function playWidgets(shell: Shell): AnyWidget[] {
  style("play-widgets", CSS);

  const stats: WidgetDef = {
    id: "stats", name: "stats", description: "how your games of this puzzle went: wins, times, scores, and your streak for the puzzle of the day", puzzles: "*", defaultSlot: "panel", order: 35,
    mount(el, ctx) {
      const def = ctx.session.def;
      // stats are per setup (stats.ts setupOf); the one being played unless the player picks another
      let picked = sessionSetup(ctx.session);
      const render = () => {
        clear(el);
        const all = results(def.id);
        const known = setups(all);
        if (!known.includes(picked) && known.length && picked !== sessionSetup(ctx.session)) picked = known[0]!;
        const list = all.filter((r) => setupOf(r) === picked);
        const box = h("div", { class: "w-stats" });
        el.append(box);
        const choices = [...new Set([sessionSetup(ctx.session), ...known])];
        if (choices.length > 1) {
          box.append(h("select", {
            "aria-label": "which setup", class: "st-setup",
            onchange: (e: Event) => { picked = (e.target as HTMLSelectElement).value; render(); },
          }, choices.map((k) => h("option", { value: k, selected: k === picked },
            `${setupLabel(def, k)}${k === sessionSetup(ctx.session) ? " (this game)" : ""} · ${all.filter((r) => setupOf(r) === k).length} played`))));
        } else box.append(h("p", { class: "w-dim" }, setupLabel(def, picked)));
        const sum = summarize(list, today(), (d) => addDays(d, -1));
        const num = (v: string | number, label: string) => h("div", { class: "st-num" }, h("b", null, String(v)), h("span", null, label));
        if (!list.length) box.append(h("p", { class: "w-dim" }, "no finished games with these settings yet."));
        else {
          box.append(h("div", { class: "st-nums" },
            num(sum.played, "played"),
            num(`${Math.round((sum.solved / sum.played) * 100)}%`, "solved"),
            picked === "daily" ? num(sum.streak, "streak") : null,
            picked === "daily" ? num(sum.bestStreak, "best streak") : null,
            sum.bestMs !== null ? num(formatTime(sum.bestMs), "fastest") : null,
            sum.medianMs !== null ? num(formatTime(sum.medianMs), "typical time") : null));
          if (sum.scores.length) {
            const most = Math.max(...sum.scores.map((x) => x.count));
            box.append(h("h3", { class: "w-dim" }, sum.better === "higher" ? "scores (higher is better)" : "scores (lower is better)"),
              h("div", { class: "st-bars" }, sum.scores.map((x) => h("div", { class: "st-bar" },
                h("span", null, String(x.value)),
                h("i", { style: `width: ${(x.count / most) * 100}%`, title: `${x.label}: ${x.count}` }, String(x.count))))));
          }
          if (sum.metrics.length) {
            const most = Math.max(...sum.metrics.map((m) => m.mean), 1e-9);
            box.append(h("h3", { class: "w-dim" }, "on average"),
              h("div", { class: "st-bars st-metrics" }, sum.metrics.map((m) => h("div", { class: "st-bar", title: `${m.n} ${m.n === 1 ? "game" : "games"} · ${m.better} is better` },
                h("span", null, m.label),
                h("i", { style: `width: ${(m.mean / most) * 100}%` }, m.mean.toFixed(1))))));
          }
        }
        if (def.daily) {
          const time = h("input", { type: "time", value: "09:00", "aria-label": "reminder time" });
          const remind = h("button", {
            onclick: () => {
              const url = new URL(`${location.pathname}?p=${encodeURIComponent(def.id)}&daily`, location.href).href;
              const ics = dailyReminderIcs(`${def.name}: puzzle of the day`, url, time.value || "09:00", today());
              const a = h("a", { href: URL.createObjectURL(new Blob([ics], { type: "text/calendar" })), download: `${def.id}-daily.ics` });
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            },
          }, "add a daily reminder to your calendar");
          box.append(h("h3", { class: "w-dim" }, "puzzle of the day"),
            h("div", { class: "w-inline" }, h("button", { class: "primary", onclick: () => void shell.startDaily(def) }, "play today's"), remind, time));
        }
      };
      render();
      return shell.hooks.stats.tap(render);
    },
  };

  const devices: WidgetDef = {
    id: "devices", name: "devices", description: "move your games, stats and settings to another device, with no account: copy a code or save a file here, paste or open it there", puzzles: "*", defaultSlot: "panel", order: 60,
    mount(el) {
      const note = h("p", { class: "w-dim", "aria-live": "polite" });
      const code = async () => TRANSFER_TAG + (await packJson(snapshotStorage()));
      const save = h("button", {
        onclick: async () => {
          const a = h("a", { href: URL.createObjectURL(new Blob([await code()], { type: "text/plain" })), download: `ptera-games-${today()}.txt` });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },
      }, "save as a file");
      const input = h("textarea", { rows: 3, spellcheck: "false", placeholder: "paste a code from your other device", "aria-label": "code from another device" });
      const file = h("input", { type: "file", accept: ".txt,text/plain", "aria-label": "file from another device" });
      const bring = async (text: string) => {
        const t = text.trim();
        if (!t.startsWith(TRANSFER_TAG)) { note.textContent = "that isn't a code from these games"; return; }
        let data: Record<string, string>;
        try {
          data = (await unpackJson(t.slice(TRANSFER_TAG.length))) as Record<string, string>;
        } catch {
          note.textContent = "the code is damaged or incomplete";
          return;
        }
        if (!(await confirmDialog("add that device's games and stats to this one? this device's own settings stay as they are.", "add"))) return;
        const n = mergeStorage(data);
        note.textContent = n ? `brought in ${n} item${n === 1 ? "" : "s"}; reloading` : "nothing new to bring in";
        if (n) setTimeout(() => location.reload(), 800);
      };
      file.addEventListener("change", async () => { const f = file.files?.[0]; if (f) await bring(await f.text()); });
      add(el,
        h("h3", { class: "w-dim" }, "from this device"),
        h("div", { class: "w-inline" }, copyButton(code, "copy code"), save),
        h("h3", { class: "w-dim" }, "into this device"),
        input, h("div", { class: "w-inline" }, h("button", { class: "primary", onclick: () => void bring(input.value) }, "bring in"), file),
        note);
    },
  };

  return [stats, devices];
}
