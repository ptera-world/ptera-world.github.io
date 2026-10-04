import type { GamesApi } from "../../api";
import type { FxEvent } from "../../core/session";
import type { Plugin, PluginUiApi, ViewHandle } from "../../core/types";

/**
 * Effects pack: every effect is a plugin reacting to session fx events. Game-agnostic: it only
 * needs a view to implement locate()/locateChange().
 */
export default function effectsPack(games: GamesApi): void {
  const { fx } = games;
  const { defineSchema } = games.schema;

  function rectsOf(view: ViewHandle, focus?: unknown, prev?: unknown, next?: unknown): DOMRect[] {
    try {
      const a = focus !== undefined ? view.locate?.(focus) ?? [] : [];
      if (a.length) return a;
      return prev !== undefined && next !== undefined ? view.locateChange?.(prev, next) ?? [] : [];
    } catch {
      return [];
    }
  }
let audio: AudioContext | null = null;
function tone(freq: number, ms: number, volume: number, type: OscillatorType = "sine"): void {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch {
    // audio unavailable
  }
}

type Fx = FxEvent<unknown>;
function effect(
  id: string,
  name: string,
  description: string,
  enabledByDefault: boolean,
  settings: ReturnType<typeof defineSchema> | undefined,
  on: (e: Fx, api: PluginUiApi<any, any, any, any>) => void,
): Plugin {
  return {
    id: `fx.${id}`,
    name,
    description,
    category: "effects",
    appliesTo: "*",
    enabledByDefault,
    settings,
    ui(api) {
      return api.session.hooks.fx.tap((e) => on(e, api), { owner: api.owner });
    },
  };
}

const boardEl = (api: PluginUiApi<any, any, any, any>): Element | null => api.root.closest(".boardbox") ?? api.root;

const effects: Plugin[] = [
  effect("steps", "show which rule did it", "flash the cells each technique changes, labelled with the technique's name (for auto-applied and button-applied steps)", true,
    defineSchema({
      label: { type: "bool", label: "show the technique name", default: true },
      manual: { type: "bool", label: "also for steps you applied yourself", default: true },
      ms: { type: "int", label: "how long (ms)", default: 1100, min: 200, max: 5000, step: 100 },
    }),
    (e, api) => {
      if (e.kind !== "step") return;
      const s = api.settings;
      if (!e.auto && !s.manual) return;
      const rects = rectsOf(api.view, undefined, e.prev, e.state);
      const list = games.registry.techniquesFor(api.session.def.id, api.session.puzzle);
      const tech = list.find((x) => x.id === e.technique);
      const color = tech ? games.techniques.colorOf(tech, list) : "var(--hint)";
      fx.flash(rects.length ? rects : rectsOf(api.view, e.focus), { ms: s.ms as number, label: s.label ? (e.name as string) : undefined, color });
    }),
  effect("pop", "placement pop", "a quick ring where your move landed", true, undefined, (e, api) => {
    if (e.kind === "change" && (e.source as { kind: string }).kind === "player") fx.pop(rectsOf(api.view, undefined, e.prev, e.state));
  }),
  effect("glow", "solve glow", "the board pulses when you finish", true, undefined, (e, api) => {
    if (e.kind !== "solved" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const accent = (pct: number) => `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;
    boardEl(api)?.animate([
      { boxShadow: `0 0 0 0 ${accent(70)}` },
      { boxShadow: `0 0 0 14px ${accent(25)}`, offset: 0.4 },
      { boxShadow: "0 0 0 28px transparent" },
    ], { duration: 1600, easing: "ease-out" });
  }),
  effect("celebrate", "solve celebration", "confetti when you finish", true,
    defineSchema({ amount: { type: "int", label: "amount", default: 50, min: 5, max: 300 } }),
    (e, api) => {
      if (e.kind !== "solved" && !(e.kind === "practice" && e.done)) return;
      const r = boardEl(api)?.getBoundingClientRect();
      if (r) fx.burst(r.left + r.width / 2, r.top + r.height / 2, e.kind === "solved" ? api.settings.amount as number : 18);
    }),
  effect("shake", "shake on mistakes", "the board shakes when a move is wrong", true, undefined, (e, api) => {
    if (e.kind === "mistake" || (e.kind === "practice" && !e.correct)) {
      fx.shake(boardEl(api));
      if (e.kind === "mistake" && e.focus !== undefined) fx.flash(rectsOf(api.view, e.focus), { color: "var(--danger)", ms: 700 });
    }
  }),
  effect("sound", "sounds", "soft tones for moves, deductions, mistakes and solving", false,
    defineSchema({ volume: { type: "int", label: "volume (%)", default: 30, min: 1, max: 100 } }),
    (e, api) => {
      const v = (api.settings.volume as number) / 100 * 0.2;
      if (e.kind === "change" && (e.source as { kind: string }).kind === "player") tone(520, 60, v, "triangle");
      else if (e.kind === "step") tone(e.auto ? 700 : 620, 90, v * 0.8);
      else if (e.kind === "mistake" || (e.kind === "practice" && !e.correct)) tone(160, 220, v, "sawtooth");
      else if (e.kind === "solved" || (e.kind === "practice" && e.done)) [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 180, v), i * 110));
      else if (e.kind === "undo") tone(380, 50, v * 0.6, "triangle");
    }),
  effect("haptics", "vibration", "short vibrations on phones that support it", false, undefined, (e) => {
    const vib = (p: number | number[]) => navigator.vibrate?.(p);
    if (e.kind === "change" && (e.source as { kind: string }).kind === "player") vib(8);
    else if (e.kind === "mistake" || (e.kind === "practice" && !e.correct)) vib([30, 40, 30]);
    else if (e.kind === "solved") vib([20, 60, 20, 60, 60]);
  }),
];

  for (const e of effects) games.registry.plugin(e);
}
