import { listMods, saveMods, setPackEnabled, type ModEntry } from "../core/mods";
import { COLOR_TOKENS, setTheme, setTokenOverride, themeChoice, tokenOverrides } from "./themes";
import { loadPluginConfig } from "../core/plugins";
import { randomSeed } from "../core/rng";
import { defineSchema, resolve } from "../core/schema";
import type { Source, TimelineEntry } from "../core/session";
import { namespace } from "../core/storage";
import { firstStep, hintFrom, loadPace, rateByTechniques } from "../core/techniques";
import type { Action, Plugin, SlotId, Technique, WidgetContext, WidgetDef } from "../core/types";
import type { ConfirmPolicy } from "./commands";
import { confirmDialog } from "./dialog";
import { add, clear, h, style } from "./dom";
import { schemaForm } from "./form";
import { SLOTS, loadLayout } from "./layout";
import type { Shell, ShareLevel } from "./shell";
import { trySerialize } from "./shell";

const prefs = namespace("prefs");

const CSS = `
.widget:empty { display: none; }
.slot:not(:has(> .widget:not(:empty))) { display: none; }
.w-status { min-height: 1.5em; text-align: center; color: var(--text-dim); max-width: 60ch; }
[data-solved] .w-status { color: var(--accent); }
.w-toolbar { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
button.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
button.danger:hover:not(:disabled) { border-color: var(--danger); background: var(--danger-soft); }
.w-section { display: flex; flex-direction: column; gap: 8px; }
.w-section > h3 { font-size: 12px; letter-spacing: 0.06em; color: var(--text-dim); margin-top: 10px; }
.w-row { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.w-row .head { display: flex; gap: 8px; align-items: center; }
.w-row .head .name { flex: 1; }
.w-row small, .w-dim { color: var(--text-dim); font-size: 12px; }
.w-row .form { padding-left: 22px; }
.w-inline { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.w-inline select, .w-inline input[type="number"] { width: auto; }
.w-tech .buttons button { padding: 3px 9px; font-size: 13px; }
.w-tech .applies { color: var(--accent); font-size: 12px; }
.w-tech details summary { cursor: pointer; color: var(--text-dim); font-size: 12px; }
.w-tech details p { font-size: 13px; margin-top: 4px; line-height: 1.45; }
.w-history ol { list-style: none; display: flex; flex-direction: column; gap: 2px; }
.w-history li button { width: 100%; text-align: left; border: none; background: none; padding: 4px 6px; font-size: 13px; display: flex; gap: 8px; }
.w-history li button:hover { background: var(--surface-2); }
.w-history li.current button { background: var(--accent-soft); }
.w-history li.future { opacity: 0.45; }
.w-history .n { color: var(--text-dim); font-family: var(--mono); min-width: 2.5em; }
.w-history .who-technique { color: var(--hint); }
.w-practice { display: flex; flex-direction: column; gap: 6px; align-items: center; text-align: center; max-width: 60ch; }
.w-practice p { color: var(--text-dim); font-size: 13px; }
.w-search { position: sticky; top: -12px; background: var(--bg); padding: 4px 0 8px; z-index: 1; }
.w-note { font-size: 13px; padding: 6px 8px; border-radius: 6px; background: var(--surface-2); }
`;

const sessionTaps = (ctx: WidgetContext, render: () => void): void => {
  const opts = { owner: ctx.owner };
  ctx.session.hooks.change.tap(render, opts);
  ctx.session.hooks.interaction.tap(render, opts);
  ctx.session.hooks.refresh.tap(render, opts);
};

/** Short description of who made a timeline step. */
function describe(sources: readonly Source[]): { who: string; kind: string } {
  const main = sources[0];
  const techs = sources.filter((s): s is Extract<Source, { kind: "technique" }> => s.kind === "technique");
  const auto = techs.filter((s) => s.auto);
  const counts = new Map<string, number>();
  for (const s of auto) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  const autoText = [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
  let who = "move";
  if (!main) who = "move";
  else if (main.kind === "player") who = "you";
  else if (main.kind === "technique") who = main.auto ? `auto: ${main.name}` : main.name;
  else if (main.kind === "hint") who = "hint";
  else if (main.kind === "assist") who = main.owner;
  else who = main.reason;
  const rest = main?.kind === "technique" && main.auto ? "" : autoText ? ` + auto: ${autoText}` : "";
  return { who: who + rest, kind: main?.kind ?? "player" };
}

export function builtinWidgets(shell: Shell): WidgetDef[] {
  style("widgets", CSS);

  const status: WidgetDef = {
    id: "status", name: "status", description: "hints, results and messages", puzzles: "*", defaultSlot: "bottom", order: 10,
    mount(el) {
      const box = h("div", { class: "w-status", "aria-live": "polite" }, shell.status);
      el.append(box);
      return shell.hooks.status.tap(({ text }) => { box.textContent = text; });
    },
  };

  const toolbar: WidgetDef = {
    id: "toolbar", name: "buttons", description: "a row of command buttons", puzzles: "*", defaultSlot: "bottom", order: 20,
    settings: defineSchema({
      commands: {
        type: "string", label: "buttons (command ids, comma separated)",
        default: "shell.undo,shell.redo,shell.hint,shell.apply-hint,shell.pause,shell.new,shell.restart,shell.reveal",
        description: "any command from the palette works here",
      },
    }),
    mount(el, ctx) {
      const bar = h("div", { class: "w-toolbar" });
      el.append(bar);
      const ids = String(ctx.settings.commands).split(",").map((s) => s.trim()).filter(Boolean);
      const render = () => {
        clear(bar);
        const c = shell.hub.context();
        for (const id of ids) {
          const cmd = shell.hub.get(id);
          if (!cmd) continue;
          const keys = shell.hub.keysFor(id);
          bar.append(h("button", {
            "data-command": id, class: cmd.danger ? "danger" : undefined,
            disabled: cmd.when ? !cmd.when(c) : false,
            "aria-pressed": cmd.checked ? String(cmd.checked()) : undefined,
            title: keys.length ? `${cmd.label} (${keys.join(", ")})` : cmd.label,
            onclick: () => ctx.run(id),
          }, cmd.label));
        }
      };
      sessionTaps(ctx, render);
      render();
    },
  };

  const game: WidgetDef = {
    id: "game", name: "new", description: "start a new puzzle", puzzles: "*", defaultSlot: "panel", order: 10,
    mount(el, ctx) {
      const def = ctx.session.def;
      let params = resolve(def.params, prefs.get(`params:${def.id}`, {}));
      const formBox = h("div");
      const renderForm = () => {
        clear(formBox);
        formBox.append(schemaForm(def.params, params, (v) => {
          params = resolve(def.params, v);
          prefs.set(`params:${def.id}`, params);
        }));
      };
      renderForm();
      const seedInput = h("input", { type: "text", placeholder: "random", spellcheck: "false", "aria-label": "seed" });
      const start = async () => {
        const s = ctx.session;
        if (s.canUndo && !s.solved && prefs.get<ConfirmPolicy>("confirm", "danger") !== "never"
          && !(await confirmDialog("start a new game? this one's progress will be lost.", "new game"))) return;
        void shell.newGame(def, params, seedInput.value.trim() || randomSeed());
      };
      const presets = def.presets?.length
        ? h("div", { class: "w-inline" }, h("span", { class: "w-dim" }, "presets:"), def.presets.map((p) =>
          h("button", {
            title: "fill in these settings",
            onclick: () => {
              params = resolve(def.params, { ...params, ...p.params });
              prefs.set(`params:${def.id}`, params);
              renderForm();
            },
          }, p.label)))
        : null;
      const seedNow = ctx.session.origin.kind === "generated" ? ctx.session.origin.seed : null;
      add(el,
        presets, formBox,
        h("div", { class: "row" }, h("label", null, "seed"), seedInput),
        h("button", { class: "primary", onclick: () => void start() }, "generate"),
        seedNow ? h("p", { class: "w-dim" }, "current seed: ", h("code", null, seedNow)) : null);
    },
  };

  const settings: WidgetDef = {
    id: "settings", name: "settings", description: "every option, searchable", puzzles: "*", defaultSlot: "panel", order: 30,
    mount(el, ctx) {
      const s = ctx.session;
      const host = shell.host!;
      const th = shell.techniques!;
      const search = h("input", { type: "search", placeholder: "search settings", "aria-label": "search settings" });
      const body = h("div", { class: "w-section" });
      el.append(h("div", { class: "w-search" }, search), body);
      const section = (title: string) => {
        const sec = h("div", { class: "w-section", "data-section": "" }, h("h3", null, title));
        body.append(sec);
        return sec;
      };
      const row = (text: string, ...children: (Node | null)[]) => h("div", { class: "w-row", "data-text": text.toLowerCase() }, ...children);
      const toggle = (checked: boolean, label: string, onChange: (v: boolean) => void) =>
        h("label", { class: "head" }, h("input", { type: "checkbox", checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }), h("span", { class: "name" }, label));

      const pluginRows = (sec: HTMLElement, plugins: Plugin[]) => {
        for (const p of plugins) {
          const cfg = loadPluginConfig(p);
          const form = p.settings ? schemaForm(p.settings, cfg.settings, (v) => {
            host.setConfig(p, { ...loadPluginConfig(p), settings: v });
            shell.hub.refresh();
          }) : null;
          if (form) form.hidden = !cfg.enabled;
          sec.append(row(`${p.name} ${p.description ?? ""} ${p.category ?? ""}`,
            toggle(cfg.enabled, p.name, (on) => {
              host.setConfig(p, { ...loadPluginConfig(p), enabled: on });
              if (form) form.hidden = !on;
              shell.hub.refresh();
            }),
            p.description ? h("small", null, p.description) : null,
            form));
        }
      };

      const plugins = host.plugins();
      if (th.list.length) {
        const sec = section("techniques");
        const pace = h("input", {
          type: "number", min: 0, max: 5000, step: 50, value: loadPace(),
          onchange: (e: Event) => th.setPace(Number((e.target as HTMLInputElement).value) || 0),
        });
        sec.append(row("auto-apply speed pace delay instant", h("div", { class: "w-inline" },
          h("span", null, "auto-apply: ms between steps"), pace, h("small", null, "0 = all at once"))));
        for (const t of th.list) {
          const cfg = th.config(t);
          sec.append(row(`${t.name} ${t.description} technique auto hint`,
            h("div", { class: "head" }, h("span", { class: "name" }, t.name),
              h("label", { class: "w-inline", title: "offer as a hint" }, h("input", { type: "checkbox", checked: cfg.hints, onchange: (e: Event) => th.setConfig(t, { ...th.config(t), hints: (e.target as HTMLInputElement).checked }) }), "hints"),
              h("label", { class: "w-inline", title: "apply automatically" }, h("input", { type: "checkbox", checked: cfg.auto, onchange: (e: Event) => { th.setConfig(t, { ...th.config(t), auto: (e.target as HTMLInputElement).checked }); shell.hub.refresh(); } }), "auto"))));
        }
      }
      const assists = plugins.filter((p) => p.category !== "effects");
      if (assists.length) pluginRows(section("assists"), assists);
      const fx = plugins.filter((p) => p.category === "effects");
      if (fx.length) pluginRows(section("effects"), fx);

      const theme = section("theme");
      theme.append(row("theme colours look light dark system", h("div", { class: "w-inline" }, h("span", null, "theme"),
        h("select", { onchange: (e: Event) => setTheme(shell.registry, (e.target as HTMLSelectElement).value) },
          h("option", { value: "system", selected: themeChoice() === "system" }, "follow system"),
          shell.registry.listThemes().map((th) => h("option", { value: th.id, selected: themeChoice() === th.id }, th.name))))));
      const overrides = tokenOverrides();
      for (const tok of COLOR_TOKENS) {
        const current = getComputedStyle(document.documentElement).getPropertyValue(`--${tok.id}`).trim();
        const toHex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? "#" + c.slice(1).replace(/(.)/g, "$1$1") : "#888888");
        theme.append(row(`colour ${tok.label} ${tok.id} theme`, h("div", { class: "w-inline" },
          h("input", { type: "color", value: toHex(overrides[tok.id] ?? current), "aria-label": tok.label, oninput: (e: Event) => setTokenOverride(shell.registry, tok.id, (e.target as HTMLInputElement).value) }),
          h("span", { style: "flex: 1" }, tok.label),
          overrides[tok.id] ? h("button", { onclick: () => { setTokenOverride(shell.registry, tok.id, null); shell.openTab("settings"); } }, "reset") : null)));
      }
      const done = Number(overrides["done-opacity"] ?? getComputedStyle(document.documentElement).getPropertyValue("--done-opacity")) || 0.35;
      theme.append(row("finished done completed dim fade opacity numbers clues", h("div", { class: "w-inline" },
        h("span", { style: "flex: 1" }, "how faded finished things look"),
        h("input", { type: "range", min: 0, max: 100, value: Math.round(done * 100), "aria-label": "finished opacity", oninput: (e: Event) => setTokenOverride(shell.registry, "done-opacity", String(Number((e.target as HTMLInputElement).value) / 100)) }))));

      const disp = section("display");
      const views = shell.registry.viewsFor(s.def.id);
      const v = shell.view?.def;
      if (views.length > 1) {
        disp.append(row("view board style", h("div", { class: "w-inline" }, h("span", null, "board style"),
          h("select", { onchange: (e: Event) => shell.setViewChoice((e.target as HTMLSelectElement).value) },
            views.map((x) => h("option", { value: x.id, selected: x.id === v?.id }, x.name))))));
      }
      if (v?.settings) {
        for (const [k, f] of Object.entries(v.settings)) {
          const one = { [k]: f };
          const vals = shell.viewSettings(v);
          disp.append(row(`${f.label} ${f.description ?? ""}`, schemaForm(one, vals, (nv) => shell.setViewSettings(v, { ...shell.viewSettings(v), ...nv }))));
        }
      }
      disp.append(row("hide timer clock", toggle(prefs.get("hideTimer", false), "hide timer", (on) => prefs.set("hideTimer", on))));

      const lay = section("layout");
      const cfg = loadLayout(s.def.id, shell.widgetDefs());
      for (const w of shell.widgetDefs()) {
        const p = cfg[w.id]!;
        const form = w.settings ? schemaForm(w.settings, shell.widgetSettings(w), (nv) => shell.setWidgetSettings(w, nv)) : null;
        lay.append(row(`${w.name} ${w.description ?? ""} layout widget panel place`,
          h("div", { class: "head" }, h("span", { class: "name", title: w.description }, w.name),
            h("select", { "aria-label": `${w.name} placement`, onchange: (e: Event) => shell.setPlacement(w.id, (e.target as HTMLSelectElement).value as SlotId) },
              SLOTS.map((sl) => h("option", { value: sl.id, selected: sl.id === p.slot }, sl.label))),
            h("input", { type: "number", value: p.order, min: 0, max: 999, "aria-label": `${w.name} order`, title: "order (lower first)", style: "width: 4.5em",
              onchange: (e: Event) => shell.setPlacement(w.id, p.slot, Number((e.target as HTMLInputElement).value)) })),
          w.description ? h("small", null, w.description) : null,
          form));
      }
      lay.append(row("reset layout default", h("button", { onclick: () => shell.resetLayout() }, "reset layout")));

      const beh = section("behaviour");
      beh.append(row("confirm restart reveal new game dangerous ask", h("div", { class: "w-inline" }, h("span", null, "ask before"),
        h("select", { onchange: (e: Event) => prefs.set("confirm", (e.target as HTMLSelectElement).value) },
          ([["danger", "restart, reveal, losing progress"], ["always", "anything that asks"], ["never", "never ask"]] as const)
            .map(([val, lab]) => h("option", { value: val, selected: prefs.get("confirm", "danger") === val }, lab))))));

      const keys = section("keys");
      keys.append(row("keys shortcuts keyboard rebind bindings commands palette", h("div", { class: "w-inline" },
        h("button", { onclick: () => ctx.run("shell.shortcuts") }, "shortcuts"),
        h("button", { onclick: () => ctx.run("shell.rebind") }, "rebind keys"),
        h("button", { onclick: () => ctx.run("shell.palette") }, "all commands"))));

      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        for (const r of body.querySelectorAll<HTMLElement>(".w-row")) r.hidden = !!q && !q.split(/\s+/).every((w) => (r.dataset.text ?? "").includes(w));
        for (const sec of body.querySelectorAll<HTMLElement>("[data-section]")) sec.hidden = ![...sec.querySelectorAll<HTMLElement>(".w-row")].some((r) => !r.hidden);
      });
    },
  };

  const techniques: WidgetDef = {
    id: "techniques", name: "techniques", description: "the rules, every solving technique, and practice", puzzles: "*", defaultSlot: "panel", order: 20,
    mount(el, ctx) {
      const th = shell.techniques;
      const s = ctx.session;
      const rules = s.def.rules?.(s.puzzle) ?? [];
      if (rules.length) el.append(h("div", { class: "w-section" }, h("h3", null, "rules"), h("ul", { style: "padding-left: 18px; font-size: 13px" }, rules.map((r) => h("li", null, r)))));
      if (!th || !th.list.length) {
        if (!rules.length) el.append(h("p", { class: "w-dim" }, "no techniques for this puzzle yet."));
        return;
      }
      const note = h("div", { class: "w-note", hidden: true });
      const list = h("div", { class: "w-section" });
      const applies = new Map<string, HTMLElement>();
      const check = () => {
        for (const [id, mark] of applies) mark.textContent = th.find(th.list.find((t) => t.id === id)!) ? "applies now" : "";
      };
      const assisted = () => {
        const auto = th.list.filter((t) => th.config(t).auto);
        if (!auto.length) { note.hidden = true; return; }
        const manual = th.list.filter((t) => !th.config(t).auto);
        const withAuto = rateByTechniques(s.def, auto, s.puzzle);
        const rest = rateByTechniques(s.def, [...auto, ...manual], s.puzzle);
        note.hidden = false;
        note.textContent = withAuto
          ? "your auto-applied techniques solve this whole board on their own."
          : rest ? `with your auto techniques on, the hardest thing left for you is: ${rest.hardest.name}.` : "this board needs more than the listed techniques.";
      };
      el.append(note, h("div", { class: "w-inline" },
        h("h3", { style: "flex: 1; font-size: 12px; color: var(--text-dim); letter-spacing: 0.06em" }, "techniques"),
        h("button", { onclick: check, title: "mark which techniques have an instance on the board right now" }, "what applies now?")), list);
      for (const t of th.list) {
        const mark = h("span", { class: "applies" });
        applies.set(t.id, mark);
        const cfg = th.config(t);
        list.append(h("div", { class: "w-row w-tech" },
          h("div", { class: "head" }, h("strong", { class: "name" }, t.name), mark),
          h("details", null, h("summary", null, "how it works"), h("p", null, t.description)),
          h("div", { class: "w-inline buttons" },
            h("button", { onclick: () => shell.findTechnique(t), title: "show one on the board" }, "find"),
            h("button", { onclick: () => ctx.run(`technique.apply.${t.id}`), title: "carry one out" }, "apply"),
            h("button", { onclick: () => ctx.run(`technique.practice.${t.id}`), title: "a board where this is the next step" }, "practise"),
            h("label", { class: "w-inline", title: "offer as a hint" }, h("input", { type: "checkbox", checked: cfg.hints, onchange: (e: Event) => th.setConfig(t, { ...th.config(t), hints: (e.target as HTMLInputElement).checked }) }), "hints"),
            h("label", { class: "w-inline", title: "apply automatically" }, h("input", { type: "checkbox", checked: cfg.auto, onchange: (e: Event) => { th.setConfig(t, { ...th.config(t), auto: (e.target as HTMLInputElement).checked }); assisted(); shell.hub.refresh(); } }), "auto"))));
      }
      assisted();
    },
  };

  const historyW: WidgetDef = {
    id: "history", name: "history", description: "every step, who made it, jump back to any point, replay, export", puzzles: "*", defaultSlot: "panel", order: 25,
    mount(el, ctx) {
      const s = ctx.session;
      const list = h("ol");
      const done = h("span", { class: "w-dim" });
      let replayTimer = 0;
      const stopReplay = () => { clearInterval(replayTimer); replayTimer = 0; };
      const render = () => {
        clear(list);
        const { past, future } = s.timeline();
        const row = (e: TimelineEntry<Action>, i: number, isFuture: boolean) => {
          const d = describe(e.sources);
          return h("li", { class: `${isFuture ? "future" : ""} ${!isFuture && i === past.length ? "current" : ""}` },
            h("button", { onclick: () => { stopReplay(); s.jumpTo(i); }, title: "go to just after this step" },
              h("span", { class: "n" }, String(i)), h("span", { class: `who-${d.kind}` }, d.who)));
        };
        list.append(h("li", { class: past.length === 0 ? "current" : "" }, h("button", { onclick: () => { stopReplay(); s.jumpTo(0); } }, h("span", { class: "n" }, "0"), h("span", null, "start"))));
        past.forEach((e, i) => list.append(row(e, i + 1, false)));
        future.forEach((e, i) => list.append(row(e, past.length + i + 1, true)));
      };
      sessionTaps(ctx, render);
      render();
      el.append(
        h("div", { class: "w-inline" },
          h("button", {
            onclick: () => {
              stopReplay();
              const end = s.depth + s.timeline().future.length;
              s.jumpTo(0);
              replayTimer = window.setInterval(() => { if (s.depth >= end || !s.redo()) stopReplay(); }, 350);
            },
          }, "replay"),
          h("button", { onclick: stopReplay }, "stop"),
          h("button", {
            title: "a link that opens this board with this whole history, undoable",
            onclick: async () => {
              await navigator.clipboard?.writeText(await shell.shareUrl("history"));
              done.textContent = "copied";
            },
          }, "copy link with every move"), done),
        h("div", { class: "w-history" }, list));
      return stopReplay;
    },
  };

  const practice: WidgetDef = {
    id: "practice", name: "practice", description: "what to look for while practising a technique", puzzles: "*", defaultSlot: "top", order: 0,
    mount(el, ctx) {
      const s = ctx.session;
      if (s.origin.kind !== "practice") return;
      const origin = s.origin;
      const t: Technique | undefined = shell.registry.techniquesFor(s.def.id).find((x) => x.id === origin.technique);
      if (!t) return;
      el.append(h("div", { class: "w-practice" },
        h("strong", null, `practise: ${t.name}`),
        h("p", null, t.description),
        h("div", { class: "w-inline" },
          h("button", {
            onclick: () => {
              const cur = s.activeHint;
              const next = cur?.technique === t.id && cur.more ? cur.more : hintFrom(t, origin.step, 1);
              s.showHint(next as never);
              s.hooks.fx.call({ kind: "hint", focus: next.focus });
              shell.setStatus(next.message);
            },
          }, "show me"),
          h("button", { onclick: () => void shell.startPractice(s.def, t, randomSeed()) }, "another one"),
          h("button", {
            onclick: () => {
              history.pushState(null, "", `?p=${encodeURIComponent(s.def.id)}`);
              dispatchEvent(new PopStateEvent("popstate"));
            },
          }, "back to the game"))));
    },
  };

  const share: WidgetDef = {
    id: "share", name: "share", description: "link, export and import", puzzles: "*", defaultSlot: "panel", order: 40,
    mount(el, ctx) {
      const s = ctx.session;
      const def = s.def;
      const out = h("textarea", { rows: 4, readonly: true, spellcheck: "false", "aria-label": "export" });
      const exportable = def.formats.filter((f) => f.serialize);
      const fmtSelect = h("select", { "aria-label": "export format" }, exportable.map((f) => h("option", { value: f.id }, f.label)));
      const refresh = () => {
        const f = exportable.find((x) => x.id === fmtSelect.value);
        out.value = f ? trySerialize(f, s.puzzle) ?? "this puzzle can't be written in that format" : "";
      };
      fmtSelect.addEventListener("change", refresh);
      refresh();
      const input = h("textarea", { rows: 4, spellcheck: "false", placeholder: "paste a puzzle", "aria-label": "import" });
      const importFmt = h("select", { "aria-label": "import format" }, h("option", { value: "" }, "auto-detect"), def.formats.map((f) => h("option", { value: f.id }, f.label)));
      const err = h("p", { class: "error" });
      const doImport = () => {
        const text = input.value.trim();
        if (!text) return;
        const candidates = importFmt.value
          ? def.formats.filter((f) => f.id === importFmt.value)
          : [...def.formats.filter((f) => f.detect?.(text)), ...def.formats.filter((f) => !f.detect)];
        const errors: string[] = [];
        for (const f of candidates) {
          try {
            const puzzle = f.parse(text);
            shell.loadPuzzle(def, puzzle, { kind: "imported", format: f.id, source: trySerialize(f, puzzle) ?? text });
            return;
          } catch (e) {
            errors.push(`${f.label}: ${e instanceof Error ? e.message : e}`);
          }
        }
        err.textContent = errors.length ? errors.join("\n") : "no format recognised this";
      };
      const linkBox = h("input", { type: "text", readonly: true, "aria-label": "share link", style: "flex: 1" });
      let level = prefs.get<ShareLevel>("shareLevel", "puzzle");
      const update = async () => { linkBox.value = await shell.shareUrl(level); };
      const levels: [ShareLevel, string][] = [["puzzle", "just the puzzle"], ["state", "+ where i am"], ["history", "+ every move"]];
      const picker = h("div", { class: "w-inline", role: "radiogroup", "aria-label": "what the link includes" }, levels.map(([v, lab]) =>
        h("label", { class: "w-inline" }, h("input", {
          type: "radio", name: "share-level", value: v, checked: v === level,
          onchange: () => { level = v; prefs.set("shareLevel", v); void update(); },
        }), lab)));
      void update();
      add(el,
        h("h3", { class: "w-dim" }, "link"), picker,
        h("div", { class: "w-inline" }, linkBox, h("button", { onclick: async () => { await update(); void navigator.clipboard?.writeText(linkBox.value); } }, "copy")),
        exportable.length ? [h("h3", { class: "w-dim" }, "export"), fmtSelect, out, h("button", { onclick: () => void navigator.clipboard?.writeText(out.value) }, "copy")] : null,
        h("h3", { class: "w-dim" }, "import"), importFmt, input,
        h("button", { class: "primary", onclick: doImport }, "load"), err);
    },
  };

  const packs: WidgetDef = {
    id: "packs", name: "packs", description: "turn content packs on and off, or add your own from a url (a pack or a list of packs)", puzzles: "*", defaultSlot: "panel", order: 50,
    mount(el) {
      const render = () => {
        clear(el);
        const groups = new Map<string, typeof shell.packs>();
        for (const p of shell.packs) {
          const g = p.list ?? "your packs";
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g)!.push(p);
        }
        for (const [g, list] of groups) {
          el.append(h("h3", { class: "w-dim" }, g));
          for (const p of list) {
            el.append(h("div", { class: "w-row" },
              h("label", { class: "head" }, h("input", {
                type: "checkbox", checked: p.enabled,
                onchange: (e: Event) => setPackEnabled(p.key, (e.target as HTMLInputElement).checked),
              }), h("span", { class: "name" }, p.name)),
              p.error ? h("p", { class: "error" }, p.error) : null));
          }
        }
        for (const r of shell.modResults) if (r.error) el.append(h("p", { class: "error" }, `${r.mod.name}: ${r.error}`));
        const mine = listMods();
        if (mine.length) {
          el.append(h("h3", { class: "w-dim" }, "your sources"));
          for (const m of mine) {
            el.append(h("div", { class: "w-row" }, h("div", { class: "head" },
              h("label", { class: "w-inline name" }, h("input", { type: "checkbox", checked: m.enabled, onchange: (e: Event) => { m.enabled = (e.target as HTMLInputElement).checked; saveMods(mine); } }), m.name),
              h("button", { onclick: () => { saveMods(mine.filter((x) => x.id !== m.id)); render(); } }, "remove"))));
          }
        }
        const name = h("input", { type: "text", placeholder: "name", "aria-label": "source name" });
        const src = h("textarea", { rows: 5, spellcheck: "false", "aria-label": "pack url, list url, or code", placeholder: "https://…/pack.js, https://…/list.json,\nor code: export default (games) => { … }" });
        el.append(h("h3", { class: "w-dim" }, "add a source"), name, src,
          h("button", {
            class: "primary",
            onclick: async () => {
              const text = src.value.trim();
              if (!text) return;
              const isUrl = /^(https?:|\/|\.\/)\S*$/.test(text);
              if (!(await confirmDialog("packs run with full access to this page. only add ones you trust. add it?", "add", true))) return;
              const entry: ModEntry = { id: crypto.randomUUID(), name: name.value.trim() || (isUrl ? text : "inline pack"), enabled: true, source: isUrl ? { url: text } : { code: text } };
              saveMods([...mine, entry]);
              render();
            },
          }, "add"),
          h("p", { class: "w-dim" }, "changes apply after a reload."),
          h("button", { onclick: () => location.reload() }, "reload"));
      };
      render();
    },
  };

  return [status, toolbar, game, settings, techniques, historyW, practice, share, packs];
}

/** Assisted rating used by packs/mods: hardest technique still left for the player given their auto techniques. */
export function nextManualTechnique(shell: Shell): Technique | null {
  const s = shell.session;
  const th = shell.techniques;
  if (!s || !th) return null;
  return firstStep(s.def, th.list.filter((t) => !th.config(t).auto), s.puzzle, s.state)?.technique ?? null;
}
