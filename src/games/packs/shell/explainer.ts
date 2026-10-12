import { randomSeed } from "../../core/rng";
import { clear, h, style } from "../../core/dom";
import { namespace, prefs } from "../../core/storage";
import type { Session } from "../../core/session";
import type { AnyPuzzleDef, Step, Technique, View, ViewHandle } from "../../core/types";
import { SessionCtor, applyStep, colorOf, findPracticePosition, findStep, hintFrom } from "./engine";

const CSS = `
.ex { display: flex; flex-direction: column; gap: 8px; }
.ex-stage { position: relative; width: 100%; height: var(--ex-h, 300px); display: flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--surface-2); overflow: hidden; }
.ex-stage > .view { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.ex-caption { min-height: 3.2em; line-height: 1.45; font-size: 14px; padding: 8px 10px; border-left: 3px solid var(--ex-color, var(--hint)); background: var(--surface); border-radius: 0 8px 8px 0; }
.ex-caption .step { color: var(--text-dim); font-size: 12px; display: block; }
.ex-controls { display: flex; gap: 6px; align-items: center; }
.ex-controls button { flex: none; }
.ex-controls .ex-play { width: 6.5em; }
.ex-controls .dots { display: flex; gap: 4px; flex: 1; justify-content: center; }
.ex-controls .dots span { width: 7px; height: 7px; border-radius: 50%; background: var(--border); }
.ex-controls .dots span.on { background: var(--ex-color, var(--hint)); }
.ex-loading { color: var(--text-dim); font-size: 13px; }
`;

interface Scene {
  caption: string;
  label: string;
  /** What the board shows in this scene. */
  enter(s: Session<any, any, any, any>, view: ViewHandle): void;
}

const positions = new Map<string, { puzzle: unknown; state: unknown; step: Step }>();

/**
 * A short, replayable scene that shows one technique on a small live board (its own session,
 * never the player's game): the position, where to look, why, and the move, with play / step /
 * replay. Every puzzle gets one from its techniques, views and hints, with nothing per technique.
 */
export function explainer(def: AnyPuzzleDef, t: Technique, all: readonly Technique[], viewDef: View, viewSettings: Record<string, unknown>): HTMLElement & { dispose(): void } {
  style("explainer", CSS);
  const root = h("div", { class: "ex" });
  const color = colorOf(t, all);
  root.style.setProperty("--ex-color", color);
  const stage = h("div", { class: "ex-stage" });
  const caption = h("div", { class: "ex-caption", "aria-live": "polite" });
  const dots = h("div", { class: "dots", "aria-hidden": "true" });
  const back = h("button", { "aria-label": "previous step" }, "‹");
  const play = h("button", { class: "primary ex-play" }, "play");
  const next = h("button", { "aria-label": "next step" }, "›");
  root.append(stage, h("div", { class: "ex-controls" }, back, dots, play, next), caption);
  stage.append(h("span", { class: "ex-loading" }, `finding a ${t.name}…`));

  let handle: ViewHandle | null = null;
  let session: Session<any, any, any, any> | null = null;
  let scenes: Scene[] = [];
  let at = 0;
  let timer = 0;
  const ac = new AbortController();

  const show = (i: number) => {
    if (!session || !handle) return;
    at = Math.max(0, Math.min(scenes.length - 1, i));
    const sc = scenes[at]!;
    sc.enter(session, handle);
    clear(caption);
    caption.append(h("span", { class: "step" }, `${at + 1} / ${scenes.length} · ${sc.label}`), sc.caption);
    clear(dots);
    scenes.forEach((_, k) => dots.append(h("span", { class: k <= at ? "on" : "" })));
    back.toggleAttribute("disabled", at === 0);
    next.toggleAttribute("disabled", at === scenes.length - 1);
  };
  const stop = () => { clearTimeout(timer); timer = 0; play.textContent = "play"; };
  const run = () => {
    if (timer) { stop(); return; }
    if (at >= scenes.length - 1) show(0);
    play.textContent = "pause";
    const tick = () => {
      if (at >= scenes.length - 1) { stop(); play.textContent = "replay"; return; }
      show(at + 1);
      timer = window.setTimeout(tick, prefs.get("explainerPace", 2600));
    };
    timer = window.setTimeout(tick, prefs.get("explainerPace", 2600));
  };
  back.addEventListener("click", () => { stop(); show(at - 1); });
  next.addEventListener("click", () => { stop(); show(at + 1); });
  play.addEventListener("click", run);

  void (async () => {
    let pos = positions.get(t.id);
    if (!pos) {
      const found = await findPracticePosition(def, all, t, `explain-${randomSeed()}`, ac.signal, 24).catch(() => null);
      if (!found || ac.signal.aborted) {
        if (!ac.signal.aborted) { clear(stage); stage.append(h("span", { class: "ex-loading" }, `couldn't find a ${t.name} to show right now`)); }
        return;
      }
      const step = findStep(def, t, found.puzzle, found.state);
      if (!step) return;
      pos = { puzzle: found.puzzle, state: found.state, step };
      positions.set(t.id, pos);
    }
    const p = pos;
    session = new SessionCtor(def, p.puzzle, { kind: "practice", technique: t.id, seed: "explainer", start: p.state }, { state: p.state });
    clear(stage);
    const mount = h("div", { class: "view" });
    stage.append(mount);
    try {
      handle = viewDef.mount(mount, { session, settings: viewSettings, storage: namespace(`explainer:${viewDef.id}`) });
    } catch (e) {
      clear(stage);
      stage.append(h("span", { class: "ex-loading" }, `this board can't be shown here (${e instanceof Error ? e.message : e})`));
      return;
    }
    const nudge = hintFrom(t, p.step, 1);
    const full = hintFrom(t, p.step, 2);
    const after = applyStep(def, p.puzzle, p.state, p.step);
    const reset = (s: Session<any, any, any, any>) => {
      if (s.state !== p.state) s.replaceState(p.state);
    };
    scenes = [
      { label: "the position", caption: `${t.name}: ${t.description}`, enter: (s, v) => { reset(s); s.showHint(null); v.preview?.(null); } },
      { label: "where to look", caption: nudge.message, enter: (s, v) => { reset(s); s.showHint(nudge as never); v.preview?.(null); } },
      { label: "why", caption: full.message, enter: (s, v) => { reset(s); s.showHint(full as never); v.preview?.(after); } },
      { label: "the move", caption: `so: ${full.message.replace(/^[^:]*:\s*/, "")}`, enter: (s, v) => { v.preview?.(null); if (s.state !== after) s.replaceState(after); s.showHint(full as never); } },
    ];
    show(0);
  })();

  return Object.assign(root, {
    dispose() {
      ac.abort();
      stop();
      try { handle?.destroy(); } catch { /* view already gone */ }
    },
  });
}
