import type { LoadedPack, ModEntry, Track } from "../../core/mods";
import { COLOR_TOKENS, checkForUpdate, firstStep, hintFrom, labelSides, listMods, loadPace, loadPluginConfig, packRecord, rateByTechniques, saveMods, selectPackVersion, setLabelSides, setPackEnabled, setTheme, setTokenOverride, setTrack, themeChoice, tokenOverrides } from "./engine";
import { randomSeed } from "../../core/rng";
import { defineSchema, resolve } from "../../core/schema";
import type { Source, TimelineEntry } from "../../core/session";
import { namespace } from "../../core/storage";
import type { Action, Plugin, SlotId, Technique, WidgetContext, WidgetDef } from "../../core/types";
import { isDanger, type ConfirmPolicy } from "./commands";
import { confirmDialog } from "./dialog";
import { add, clear, formatTime, h, style } from "../../core/dom";
import { schemaForm } from "./form";
import { SLOTS, loadLayout } from "./layout";
import { setTipDelay, tipDelay } from "./tooltips";
import { tiles, type SurfaceStyle } from "./surfaces";
import { sessionList } from "./session-list";
import type { Shell, ShareLevel } from "./shell";
import { trySerialize } from "./shell";

const prefs = namespace("prefs");

const CSS = `
.widget:empty { display: none; }
.slot:not(:has(> .widget:not(:empty))) { display: none; }
/* reserves two lines, so a message appearing or wrapping never moves what sits above or beside it */
.w-status { min-height: 2.9em; line-height: 1.45; text-align: center; color: var(--text-dim); width: min(60ch, 100%); }
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
.w-history .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w-history .who { color: var(--text-dim); font-size: 12px; white-space: nowrap; }
.w-history .who-technique { color: var(--hint); }
.w-practice { display: flex; flex-direction: column; gap: 6px; align-items: center; text-align: center; max-width: 60ch; }
.w-practice p { color: var(--text-dim); font-size: 13px; }
.w-search { position: sticky; top: -12px; background: var(--bg); padding: 4px 0 8px; z-index: 1; }
.w-results { background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(6px); border: 1px solid var(--accent); border-radius: 12px; padding: 10px 14px; box-shadow: 0 10px 30px rgba(0,0,0,.35); display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; justify-content: center; max-width: 100%; }
.w-results.anim { animation: results-in 420ms cubic-bezier(.2,.9,.3,1.3); }
.w-results .big { font-size: 18px; color: var(--accent); }
.w-results.lost { border-color: var(--danger); }
.w-results.lost .big { color: var(--danger); }
.w-results .time { font: 600 18px var(--mono); }
.w-results ul { list-style: none; font-size: 12px; color: var(--text-dim); display: flex; flex-wrap: wrap; gap: 2px 10px; flex-basis: 100%; justify-content: center; }
[data-slot="side"] .w-results, [data-slot="panel"] .w-results { flex-direction: column; }
@keyframes results-in { from { opacity: 0; transform: scale(.85) translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .w-results { animation: none; } }
.w-game.current { background: var(--accent-soft); border-radius: 6px; padding-left: 6px; }
.w-game .link { background: none; border: none; padding: 0; text-align: left; flex: 1; }
.w-game .link:hover strong { color: var(--accent); }
.w-howto { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; box-shadow: 0 18px 50px rgba(0,0,0,.45); max-width: min(460px, 100%); max-height: calc(100% - 20px); overflow-y: auto; display: flex; flex-direction: column; gap: 8px; align-self: center; margin-bottom: auto; margin-top: auto; }
.w-howto .head strong { font-size: 18px; }
.w-howto .goal { font-size: 15px; }
.w-howto h4 { font-size: 12px; letter-spacing: .06em; color: var(--text-dim); font-weight: normal; margin-top: 4px; }
.w-howto ul { padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.w-howto .how { list-style: none; padding-left: 0; }
.w-howto .legend { list-style: none; padding-left: 0; }
.w-howto .legend li { display: flex; align-items: center; gap: 10px; }
.w-howto .legend .sw { width: 38px; height: 38px; flex: none; display: inline-flex; align-items: center; justify-content: center; }
.w-howto .legend .sw svg { width: 100%; height: 100%; }
.w-skills { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.w-skills button { font-size: 13px; padding: 5px 10px; }
.w-note { font-size: 13px; padding: 6px 8px; border-radius: 6px; background: var(--surface-2); }
`;

const sessionTaps = (ctx: WidgetContext, render: () => void): void => {
  const opts = { owner: ctx.owner };
  ctx.session.hooks.change.tap(render, opts);
  ctx.session.hooks.interaction.tap(render, opts);
  ctx.session.hooks.refresh.tap(render, opts);
  ctx.session.hooks.solved.tap(render, opts);
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

/** Solves whose result strip has already animated in (session id : solve time). */
const announced = new Set<string>();

export function builtinWidgets(shell: Shell): WidgetDef[] {
  style("widgets", CSS);

  const status: WidgetDef = {
    id: "status", name: "status", description: "hints, results and messages", puzzles: "*", defaultSlot: "bottom", order: 30,
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
            "data-command": id,
            class: [isDanger(cmd) ? "danger" : "", c.solved && id === "shell.new" ? "primary" : ""].join(" ").trim() || undefined,
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

      const brd = section("board");
      const sides = labelSides();
      brd.append(row("board labels coordinates edges letters numbers rows columns sides", h("div", { class: "w-inline" },
        h("span", { style: "flex: 1" }, "edge labels (A, B, … and 1, 2, …)"),
        (["top", "left", "right", "bottom"] as const).map((sd) => h("label", { class: "w-inline" }, h("input", {
          type: "checkbox", checked: sides.has(sd),
          onchange: (e: Event) => { const cur = labelSides(); if ((e.target as HTMLInputElement).checked) cur.add(sd); else cur.delete(sd); setLabelSides(cur); },
        }), sd)))));

      brd.append(row("minimum cell size zoom small big boards scroll", h("div", { class: "w-inline" },
        h("span", { style: "flex: 1" }, "smallest a cell may get (px); bigger boards scroll instead"),
        h("input", { type: "number", min: 0, max: 80, step: 2, value: prefs.get("minCell", 18), "aria-label": "minimum cell size", style: "width: 5em",
          onchange: (e: Event) => { prefs.set("minCell", Math.max(0, Number((e.target as HTMLInputElement).value) || 0)); shell.relayout(); } }))));

      const surf = section("menus");
      for (const input of ["mouse", "touch"] as const) {
        const cur = prefs.get<SurfaceStyle>(`menuStyle:${input}`, input === "touch" ? "radial" : "list");
        surf.append(row(`board menu style ${input} right-click hold radial tiles list`, h("div", { class: "w-inline" },
          h("span", { style: "flex: 1" }, input === "mouse" ? "board menu on right-click" : "board menu on touch hold"),
          h("select", { onchange: (e: Event) => prefs.set(`menuStyle:${input}`, (e.target as HTMLSelectElement).value) },
            ([["list", "list"], ["radial", "radial"], ["tiles", "tiles"]] as const).map(([v, lab]) => h("option", { value: v, selected: v === cur }, lab))))));
      }
      surf.append(row("board actions buttons always visible", h("small", null, "for buttons without any menu, place the \"board actions\" widget under layout")));

      brd.append(row("zoom browser ctrl plus minus scroll take over page zoom", toggle(prefs.get("zoomTakeover", false), "board zoom takes over ctrl +/−, ctrl+0 and ctrl+scroll", (on) => { prefs.set("zoomTakeover", on); shell.hub.refresh(); }),
        h("small", null, "off: those keep zooming the whole page, and = / − zoom the board")));

      const beh = section("behaviour");
      const holdNow = prefs.get<number>("holdShortcuts", 450);
      beh.append(row("hold ctrl cmd shortcuts cheatsheet keys", h("div", { class: "w-inline" },
        h("span", { style: "flex: 1" }, "hold ctrl (cmd on mac) to see shortcuts"),
        h("select", { onchange: (e: Event) => { prefs.set("holdShortcuts", Number((e.target as HTMLSelectElement).value)); shell.rearmHold(); } },
          ([[250, "quick"], [450, "normal"], [800, "slow"], [-1, "off"]] as const).map(([v, lab]) => h("option", { value: v, selected: v === holdNow }, lab))))));
      const delay = tipDelay();
      beh.append(row("tooltips tips hover delay explain buttons", h("div", { class: "w-inline" },
        h("span", { style: "flex: 1" }, "tooltips"),
        h("select", { onchange: (e: Event) => setTipDelay(Number((e.target as HTMLSelectElement).value)) },
          ([[0, "instant"], [250, "quick"], [450, "normal"], [900, "slow"], [-1, "off"]] as const).map(([v, lab]) => h("option", { value: v, selected: v === delay }, lab))))));
      beh.append(row("lock solved board finished frozen unlock", toggle(prefs.get("lockSolved", true), "lock boards once solved", (on) => { prefs.set("lockSolved", on); shell.hub.refresh(); }),
        h("small", null, "a finished board ignores moves until you unlock it")));
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
      const lessons = th.list.filter((t) => t.practice !== false);
      if (lessons.length) el.append(h("button", { class: "primary", title: "practise every technique in order, easiest first", onclick: () => void shell.startPractice(s.def, lessons[0]!, randomSeed()) }, "start the tutorial"));
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
            t.practice === false ? null : h("button", { onclick: () => ctx.run(`technique.practice.${t.id}`), title: "a board where this is the next step" }, "practise"),
            h("label", { class: "w-inline", title: "offer as a hint" }, h("input", { type: "checkbox", checked: cfg.hints, onchange: (e: Event) => th.setConfig(t, { ...th.config(t), hints: (e.target as HTMLInputElement).checked }) }), "hints"),
            h("label", { class: "w-inline", title: "apply automatically" }, h("input", { type: "checkbox", checked: cfg.auto, onchange: (e: Event) => { th.setConfig(t, { ...th.config(t), auto: (e.target as HTMLInputElement).checked }); assisted(); shell.hub.refresh(); } }), "auto"))));
      }
      assisted();
    },
  };

  const historyW: WidgetDef = {
    id: "history", name: "history", description: "every step: what it was and who made it. jump to any point, scrub, replay at your speed, point at a step to see the board as it was", puzzles: "*", defaultSlot: "panel", order: 25,
    mount(el, ctx) {
      const s = ctx.session;
      const list = h("ol");
      const done = h("span", { class: "w-dim", "aria-live": "polite" });
      const scrub = h("input", { type: "range", min: 0, value: 0, step: 1, "aria-label": "scrub through history", style: "flex: 1" });
      const speeds: [number, string][] = [[900, "slow"], [450, "normal"], [180, "fast"], [60, "very fast"]];
      const speed = h("select", { "aria-label": "replay speed", onchange: (e: Event) => prefs.set("replaySpeed", Number((e.target as HTMLSelectElement).value)) },
        speeds.map(([ms, lab]) => h("option", { value: ms, selected: ms === prefs.get("replaySpeed", 450) }, lab)));
      let replayTimer = 0;
      const stopReplay = () => { clearTimeout(replayTimer); replayTimer = 0; playBtn.textContent = "replay"; };
      const what = (e: TimelineEntry<Action>): string => {
        if (!e.actions.length) return "";
        const desc = s.def.describeAction;
        if (desc) {
          try {
            const parts = e.actions.map((act) => desc(s.puzzle, act, e.before, e.after)).filter(Boolean);
            if (parts.length) return [...new Set(parts)].join(", ");
          } catch { /* fall through to a generic description */ }
        }
        const n = shell.view?.handle.locateChange?.(e.before, e.after).length ?? 0;
        return n ? `${n} change${n === 1 ? "" : "s"}` : "";
      };
      // pointing at a step shows the board as it was then, faded over the current one
      const peek = (state: unknown | null) => { shell.view?.handle.preview?.(state); };
      const render = () => {
        clear(list);
        const { past, future } = s.timeline();
        const total = past.length + future.length;
        scrub.max = String(total);
        scrub.value = String(past.length);
        const row = (e: TimelineEntry<Action>, i: number, isFuture: boolean) => {
          const d = describe(e.sources);
          return h("li", { class: `${isFuture ? "future" : ""} ${!isFuture && i === past.length ? "current" : ""}` },
            h("button", {
              onclick: () => { stopReplay(); s.jumpTo(i); },
              onpointerenter: () => peek(e.after), onpointerleave: () => peek(null), onfocus: () => peek(e.after), onblur: () => peek(null),
              "data-tip": "go to just after this step",
            },
              h("span", { class: "n" }, String(i)),
              h("span", { class: "what" }, what(e) || "—"),
              h("span", { class: `who who-${d.kind}` }, d.who)));
        };
        list.append(h("li", { class: past.length === 0 ? "current" : "" }, h("button", { onclick: () => { stopReplay(); s.jumpTo(0); } }, h("span", { class: "n" }, "0"), h("span", { class: "what" }, "start"))));
        past.forEach((e, i) => list.append(row(e, i + 1, false)));
        future.forEach((e, i) => list.append(row(e, past.length + i + 1, true)));
      };
      scrub.addEventListener("input", () => { stopReplay(); s.jumpTo(Number(scrub.value)); });
      const playBtn = h("button", {
        onclick: () => {
          if (replayTimer) { stopReplay(); return; }
          const end = s.depth + s.timeline().future.length;
          if (s.depth >= end) s.jumpTo(0);
          playBtn.textContent = "stop";
          const tick = () => { if (s.depth >= end || !s.redo()) { stopReplay(); return; } replayTimer = window.setTimeout(tick, prefs.get("replaySpeed", 450)); };
          replayTimer = window.setTimeout(tick, prefs.get("replaySpeed", 450));
        },
      }, "replay");
      sessionTaps(ctx, render);
      render();
      el.append(
        h("div", { class: "w-inline" }, h("span", { class: "w-dim" }, "start"), scrub, h("span", { class: "w-dim" }, "now")),
        h("div", { class: "w-inline" },
          playBtn, speed,
          h("button", {
            "data-tip": "a link that opens this board with this whole history, undoable",
            onclick: async () => { await navigator.clipboard?.writeText(await shell.shareUrl("history")); done.textContent = "copied"; },
          }, "copy link with every move"), done),
        h("div", { class: "w-history" }, list));
      return () => { stopReplay(); peek(null); };
    },
  };

  const practice: WidgetDef = {
    id: "practice", name: "practice", description: "what to look for while practising a technique", puzzles: "*", defaultSlot: "top", order: 0,
    mount(el, ctx) {
      const s = ctx.session;
      if (s.origin.kind !== "practice") return;
      const origin = s.origin;
      const all = shell.registry.techniquesFor(s.def.id).filter((t) => t.practice !== false);
      const idx = all.findIndex((x) => x.id === origin.technique);
      const t: Technique | undefined = all[idx];
      if (!t) return;
      const next = all[idx + 1];
      const nextBtn = next ? h("button", { class: "primary", style: "visibility: hidden", onclick: () => void shell.startPractice(s.def, next, randomSeed()) }, `next: ${next.name}`) : null;
      s.hooks.fx.tap((e) => {
        if (e.kind === "practice" && e.done && nextBtn) nextBtn.style.visibility = "visible";
      }, { owner: ctx.owner });
      el.append(h("div", { class: "w-practice" },
        h("span", { class: "w-dim" }, `lesson ${idx + 1} of ${all.length}`),
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
          nextBtn,
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
      const linkBox = h("input", { type: "text", readonly: true, "aria-label": "link to this puzzle", style: "flex: 1" });
      void shell.shareUrl("puzzle").then((u) => { linkBox.value = u; });
      const copied = h("span", { class: "w-dim", "aria-live": "polite", style: "min-width: 5ch" });
      const levels: [ShareLevel, string, string][] = [
        ["puzzle", "copy: just the puzzle", "a fresh start on this puzzle, no spoilers"],
        ["state", "copy: where i am", "this puzzle with the board as it is now"],
        ["history", "copy: every move", "this puzzle with every move so far, undoable and replayable (good for showing a bug)"],
      ];
      add(el,
        h("h3", { class: "w-dim" }, "link"),
        h("div", { class: "w-inline" }, linkBox),
        h("div", { class: "w-inline" }, levels.map(([v, lab, tip]) => h("button", {
          "data-tip": tip,
          onclick: async () => { await navigator.clipboard?.writeText(await shell.shareUrl(v)); copied.textContent = "copied"; setTimeout(() => { copied.textContent = ""; }, 1500); },
        }, lab)), copied),
        exportable.length ? [h("h3", { class: "w-dim" }, "export"), fmtSelect, out, h("button", { onclick: () => void navigator.clipboard?.writeText(out.value) }, "copy")] : null,
        h("h3", { class: "w-dim" }, "import"), importFmt, input,
        h("button", { class: "primary", onclick: doImport }, "load"), err);
    },
  };

  /** Update check, adopt, and rollback for a pack that runs from stored versions. */
  const versionControls = (p: LoadedPack): HTMLElement => {
    const box = h("div", { class: "w-inline" });
    const render = (note = "") => {
      clear(box);
      const rec = packRecord(p.key);
      const current = rec.versions.find((v) => v.hash === rec.selected) ?? rec.versions[0];
      const when = (ms: number) => new Date(ms).toLocaleDateString();
      const track = rec.track ?? p.defaultTrack ?? "pinned";
      add(box,
        current ? h("small", null, `version ${current.hash} · ${when(current.fetchedAt)}`) : null,
        h("select", {
          "aria-label": `${p.name} updates`,
          onchange: (e: Event) => { setTrack(p.key, (e.target as HTMLSelectElement).value as Track); render("applies on reload"); },
        },
        h("option", { value: "latest", selected: track === "latest" }, "follow updates"),
        h("option", { value: "pinned", selected: track === "pinned" }, "stay on this version")),
        track === "latest" ? null : rec.available
          ? h("button", { class: "primary", onclick: () => { selectPackVersion(p.key); render("updated, reload to apply"); } }, `update to ${rec.available.hash}`)
          : h("button", {
            onclick: async () => {
              render("checking…");
              try { render((await checkForUpdate(p.key)) ? "" : "up to date"); } catch (e) { render(`couldn't check: ${e instanceof Error ? e.message : e}`); }
            },
          }, "check for updates"),
        rec.versions.length > 1
          ? h("select", {
            "aria-label": `${p.name} version`,
            onchange: (e: Event) => { selectPackVersion(p.key, (e.target as HTMLSelectElement).value); render("switched, reload to apply"); },
          }, rec.versions.map((v) => h("option", { value: v.hash, selected: v === current }, `${v.hash} · ${when(v.fetchedAt)}`)))
          : null,
        note ? h("small", null, note) : null);
    };
    render();
    return box;
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
              p.versioned ? versionControls(p) : null,
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

  const results: WidgetDef = {
    id: "results", name: "results", description: "what happened when you finish: time, difficulty, what you used", puzzles: "*", defaultSlot: "overlay", order: 0,
    mount(el, ctx) {
      const s = ctx.session;
      let dismissed = false;
      const render = () => {
        clear(el);
        if ((!s.solved && !s.lost) || dismissed) return;
        if (s.lost) {
          add(el, h("div", { class: "w-results lost", role: "status" },
            h("strong", { class: "big" }, "game over"),
            h("div", { class: "w-inline" },
              h("button", { class: "primary", onclick: () => s.undo() }, "undo"),
              h("button", { onclick: () => ctx.run("shell.new") }, "new game"),
              h("button", { onclick: () => { dismissed = true; render(); } }, "look at the board"))));
          return;
        }
        const { past } = s.timeline();
        let yours = 0, hints = 0, revealed = false;
        const used = new Map<string, { auto: number; manual: number; hint: number }>();
        for (const e of past) {
          for (const src of e.sources) {
            if (src.kind === "player") yours++;
            else if (src.kind === "hint") hints++;
            else if (src.kind === "system" && src.reason === "reveal") revealed = true;
            else if (src.kind === "technique") {
              const u = used.get(src.name) ?? { auto: 0, manual: 0, hint: 0 };
              if (src.auto) u.auto++; else if (src.viaHint) u.hint++; else u.manual++;
              used.set(src.name, u);
            }
          }
        }
        const rating = (() => { try { return s.def.rate?.(s.puzzle)?.label; } catch { return undefined; } })();
        const time = s.origin.kind === "practice" ? null : formatTime(s.solvedAtMs ?? 0);
        // the strip animates in once per solve, not every time it is re-mounted (tab switches, layout changes)
        const key = `${shell.sessionId}:${s.solvedAtMs}`;
        const fresh = !announced.has(key);
        announced.add(key);
        add(el, h("div", { class: `w-results${fresh ? " anim" : ""}`, role: "status" },
          h("strong", { class: "big" }, revealed ? "revealed" : s.origin.kind === "practice" ? "nice!" : "solved!"),
          time ? h("div", { class: "time" }, time) : null,
          rating ? h("div", { class: "w-dim" }, rating) : null,
          h("ul", null,
            h("li", null, `${yours} moves by you`),
            hints ? h("li", null, `${hints} hint${hints > 1 ? "s" : ""}`) : null,
            [...used].map(([name, u]) => h("li", null, `${name}: ${[u.manual ? `${u.manual} by button` : "", u.hint ? `${u.hint} from hints` : "", u.auto ? `${u.auto} auto` : ""].filter(Boolean).join(", ")}`))),
          h("div", { class: "w-inline" },
            h("button", { class: "primary", onclick: () => ctx.run("shell.new") }, "new game"),
            h("button", { onclick: () => shell.openTab("share") }, "share"),
            !shell.unlocked && prefs.get("lockSolved", true) ? h("button", { "data-command": "shell.unlock", onclick: () => { ctx.run("shell.unlock"); dismissed = true; render(); } }, "unlock board") : null,
            h("button", { onclick: () => { dismissed = true; render(); } }, "close"))));
      };
      sessionTaps(ctx, () => { if (!s.solved && !s.lost) dismissed = false; render(); });
      s.hooks.solved.tap(() => { dismissed = false; render(); }, { owner: ctx.owner });
      render();
    },
  };

  const opened: WidgetDef = {
    id: "games", name: "games", description: "every game you have going, across puzzles; switch to one, or delete them one by one, in a batch or all at once", puzzles: "*", defaultSlot: "panel", order: 5,
    mount(el) {
      const list = sessionList(shell);
      el.append(list);
      return shell.hooks.sessions.tap(() => list.refresh());
    },
  };

  const howto: WidgetDef = {
    id: "howto", name: "how to play", description: "what this puzzle is and how to play it; shows the first time you open each puzzle", puzzles: "*", defaultSlot: "overlay", order: 10,
    mount(el, ctx) {
      const s = ctx.session;
      const seenKey = `howtoSeen:${s.def.id}`;
      let open = !prefs.get(seenKey, false) && s.origin.kind !== "practice";
      const close = () => { open = false; prefs.set(seenKey, true); render(); };
      el.addEventListener("howto-toggle", () => { if (open) close(); else { open = true; render(); } });
      const render = () => {
        clear(el);
        if (!open) return;
        const rules = s.def.rules?.(s.puzzle) ?? [];
        const gestures = (shell.view?.def.controls ?? []).map((g) => h("li", null, h("strong", null, g.how), h("span", { class: "w-dim" }, ` · ${g.what}`)));
        // what you can do with a pointer; keyboard-only commands live in the shortcuts list
        const own = ctx.commands().filter((c) => !/^(shell|toggle|technique|widget|fx)\./.test(c.id) && !c.hidden && (c.mouse?.length || [c.menu].flat().includes("board")));
        own.sort((a, b) => Number(!(a.mouse?.length)) - Number(!(b.mouse?.length)));
        const keyCount = ctx.commands().filter((c) => !/^(toggle|technique|widget|fx)\./.test(c.id) && !c.hidden && shell.hub.keysFor(c.id).length).length;
        const how = [...gestures, ...own.slice(0, Math.max(0, 9 - gestures.length)).map((c) => {
          const ways = [...shell.hub.mouseFor(c.id), ...shell.hub.keysFor(c.id)].join(", ");
          return h("li", null, h("strong", null, c.label), ways ? h("span", { class: "w-dim" }, ` · ${ways}`) : null, c.description ? h("div", { class: "w-dim" }, c.description) : null);
        })];
        const lessons = (shell.techniques?.list ?? []).filter((t) => t.practice !== false);
        const hasTutorial = lessons.length > 0;
        const g = shell.view?.handle.gestures ?? {};
        const hasMenu = ctx.commands().some((c) => [c.menu].flat().includes("board"));
        const menuWays = [g.secondaryClick ? "" : "right-click the board", g.hold ? "" : "hold on it (touch)"].filter(Boolean);
        const shortcut = shell.hub.keysFor("shell.shortcuts")[0];
        const menuLine = (hasMenu && menuWays.length ? `${menuWays.join(" or ")} for more. ` : "") + "every action is in the commands list, top right."
          + (keyCount ? ` ${keyCount} keyboard shortcuts${shortcut ? ` (${shortcut} lists them)` : ""}.` : "");
        const lg = shell.view?.def.legend;
        const legend = (typeof lg === "function" ? lg(s.puzzle) : lg ?? []).map((l) => {
          const sw = h("span", { class: "sw", "aria-hidden": "true" });
          sw.innerHTML = l.sample;
          return h("li", null, sw, h("span", null, l.meaning));
        });
        add(el, h("div", { class: "w-howto", role: "dialog", "aria-label": `how to play ${s.def.name}` },
          h("div", { class: "head" }, h("strong", null, s.def.name), s.def.aliases?.length ? h("span", { class: "w-dim" }, ` · also ${s.def.aliases.slice(0, 3).join(", ")}`) : null),
          s.def.description ? h("p", { class: "goal" }, s.def.description) : null,
          rules.length ? [h("h4", null, "rules"), h("ul", null, rules.map((r) => h("li", null, r)))] : null,
          legend.length ? [h("h4", null, "what you see"), h("ul", { class: "legend" }, legend)] : null,
          how.length ? [h("h4", null, "playing"), h("ul", { class: "how" }, how), h("p", { class: "w-dim" }, menuLine)] : null,
          h("div", { class: "w-inline" },
            hasTutorial ? h("button", { class: "primary", onclick: () => { close(); void shell.startPractice(s.def, lessons[0]!, randomSeed()); } }, "learn by doing") : null,
            h("button", { class: hasTutorial ? undefined : "primary", onclick: close }, "play"))));
      };
      render();
    },
  };

  const zoomW: WidgetDef = {
    id: "zoom", name: "zoom", description: "zoom buttons for the board (also ctrl+scroll, pinch, ctrl+plus/minus)", puzzles: "*", defaultSlot: "off", order: 40,
    mount(el, ctx) {
      const pct = h("span", { class: "w-dim", style: "min-width: 4ch; text-align: center" });
      const show = () => { pct.textContent = `${Math.round(shell.zoom * 100)}%`; };
      el.append(h("div", { class: "w-inline" },
        h("button", { "data-command": "shell.zoom-out", "aria-label": "zoom out", onclick: () => ctx.run("shell.zoom-out") }, "−"),
        pct,
        h("button", { "data-command": "shell.zoom-in", "aria-label": "zoom in", onclick: () => ctx.run("shell.zoom-in") }, "+"),
        h("button", { "data-command": "shell.zoom-fit", onclick: () => ctx.run("shell.zoom-fit") }, "fit")));
      show();
      return shell.hooks.zoom.tap(show);
    },
  };

  const actions: WidgetDef = {
    id: "board-actions", name: "board actions", description: "the board menu as buttons, always visible (no right-click or hold needed)", puzzles: "*", defaultSlot: "off", order: 35,
    mount(el, ctx) {
      const render = () => { clear(el); el.append(tiles(shell.boardItems(), (id) => ctx.run(id))); };
      sessionTaps(ctx, render);
      render();
    },
  };

  const skills: WidgetDef = {
    id: "skills", name: "skills", description: "techniques as buttons: point at one (or hold it) to preview what it would do, tap to do it. aimed at the cell or line you point at when the technique can be", puzzles: "*", defaultSlot: "off", order: 36,
    mount(el) {
      const th = shell.techniques;
      if (!th?.list.length) return;
      const bar = h("div", { class: "w-skills" });
      for (const t of th.list) {
        let held = 0;
        const b = h("button", {
          "data-tip": `${t.name}: ${t.description}`,
          onpointerenter: (e: PointerEvent) => { if (e.pointerType === "mouse") shell.previewSkill(t); },
          onpointerleave: () => { clearTimeout(held); shell.previewSkill(null); },
          onfocus: () => shell.previewSkill(t),
          onblur: () => shell.previewSkill(null),
          onpointerdown: (e: PointerEvent) => { if (e.pointerType !== "mouse") held = window.setTimeout(() => { held = -1; shell.previewSkill(t); }, 350); },
          onclick: () => { if (held === -1) { held = 0; shell.previewSkill(null); return; } clearTimeout(held); shell.applySkill(t); },
        }, t.name);
        bar.append(b);
      }
      el.append(bar);
      return () => shell.previewSkill(null);
    },
  };

  return [status, toolbar, game, settings, techniques, historyW, practice, share, packs, results, opened, howto, zoomW, actions, skills];
}

/** Assisted rating used by packs/mods: hardest technique still left for the player given their auto techniques. */
export function nextManualTechnique(shell: Shell): Technique | null {
  const s = shell.session;
  const th = shell.techniques;
  if (!s || !th) return null;
  return firstStep(s.def, th.list.filter((t) => !th.config(t).auto), s.puzzle, s.state)?.technique ?? null;
}
