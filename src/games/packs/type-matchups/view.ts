import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, style } from "../../core/dom";
import type { View } from "../../core/types";
import { mediaUrl } from "../../lib/pokemon/media";
import type { PokemonItem } from "../../lib/pokemon/types";
import { sprite, typeChip, typeColor } from "../../lib/pokemon/ui";
import {
  FACTORS, answerOf, current, started, factor, factorText, isRight, rightCount, single,
  type Question, type Reply, type TMAction, type TMPuzzle, type TMState, type Types,
} from "./logic";
import type { TMFocus } from "./techniques";

const CSS = `
.tm { container-type: size; width: 100%; height: 100%; box-sizing: border-box; padding: 6px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; font-family: var(--font); color: var(--text); user-select: none; -webkit-user-select: none; }
.tm button:disabled { opacity: 1; cursor: default; }
.tm-in { margin: auto 0; display: flex; flex-direction: column; gap: 10px; }
.tm-bar { display: flex; align-items: center; gap: 12px; font-size: 15px; padding-right: 40px; min-height: 1.6em; }
.tm-bar .tm-score { font-weight: 700; font-variant-numeric: tabular-nums; }
.tm-clock { flex: 1; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.tm-clock > div { height: 100%; background: var(--accent); transition: width .1s linear; }
.tm-clock.low > div { background: var(--danger, #c33); }
.tm-q { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
.tm-mon { display: flex; align-items: center; gap: 10px; padding: 6px 12px 6px 6px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
.tm-mon.hint { outline: 3px solid var(--hint); }
.tm-mon .tm-pic { width: min(30cqw, 140px); height: min(30cqw, 140px); display: flex; }
.tm-mon .tm-pic > * { width: 100% !important; height: 100% !important; }
.tm-mon .tm-pic img.art { image-rendering: auto; }
.tm-mon .tm-name { font-size: 20px; font-weight: 700; }
.tm-mon .tm-types { display: flex; gap: 4px; margin-top: 4px; min-height: 20px; }
.tm-mon .tm-types .unknown { color: var(--text-dim); font-size: 14px; }
.tm-arrow { font-size: 26px; color: var(--text-dim); }
@container (width < 480px) { .tm-q { flex-direction: column; gap: 6px; } .tm-arrow { transform: rotate(90deg); } }
.tm-big .pk-type { font-size: 18px; padding: 4px 14px; }
.tm-ask { text-align: center; font-weight: 600; }
.tm-attacks { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.tm-factors { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; max-width: 520px; width: 100%; margin: 0 auto; }
@container (width < 360px) { .tm-factors { grid-template-columns: repeat(3, 1fr); } }
.tm-factors button { font-size: 20px; font-weight: 700; padding: 10px 0; }
.tm-factors button.answer { outline: 3px solid var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); }
.tm-factors button.chosen.wrong { background: var(--danger, #c33); color: #fff; }
.tm-factors button.chosen.right { background: var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); color: #fff; }
.tm-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; max-width: 620px; width: 100%; margin: 0 auto; }
@container (width < 480px) { .tm-grid { grid-template-columns: repeat(3, 1fr); } }
.tm-grid button { position: relative; padding: 7px 2px; border-radius: 99px; font-size: 14px; border: 2px solid var(--tc); background: transparent; color: var(--text); }
.tm-grid button[aria-pressed="true"] { background: var(--tc); color: #fff; text-shadow: 0 1px 1px rgb(0 0 0 / .5); }
.tm-grid button.hint { box-shadow: 0 0 0 3px var(--hint); }
.tm-grid button.missed { outline: 3px dashed var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); outline-offset: 1px; }
.tm-grid button.extra { text-decoration: line-through; outline: 3px solid var(--danger, #c33); outline-offset: 1px; }
.tm-grid button.answer[aria-pressed="true"] { outline: 3px solid var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); outline-offset: 1px; }
.tm-go { display: flex; justify-content: center; }
.tm-go button { font-size: 17px; padding: 8px 28px; border-radius: 99px; }
.tm-why { max-width: 620px; width: 100%; margin: 0 auto; padding: 8px 12px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; font-size: 15px; }
.tm-why .tm-verdict { font-weight: 700; }
.tm-why .tm-verdict.right { color: var(--verdict-match, color-mix(in srgb, var(--accent) 70%, #2a8a3a)); }
.tm-why .tm-verdict.wrong { color: var(--danger, #c33); }
.tm-why .tm-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.tm-why .tm-dim { color: var(--text-dim); }
`;

const BINDINGS = {
  "type-matchups.x0": { label: "×0", category: "type matchups", keys: ["1"] },
  "type-matchups.x025": { label: "×¼", category: "type matchups", keys: ["2"] },
  "type-matchups.x05": { label: "×½", category: "type matchups", keys: ["3"] },
  "type-matchups.x1": { label: "×1", category: "type matchups", keys: ["4"] },
  "type-matchups.x2": { label: "×2", category: "type matchups", keys: ["5"] },
  "type-matchups.x4": { label: "×4", category: "type matchups", keys: ["6"] },
  "type-matchups.go": { label: "start / check / next", category: "type matchups", keys: ["Enter"], description: "start a timed round, check your picks, or go on to the next question" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const FACTOR_COMMANDS = ["type-matchups.x0", "type-matchups.x025", "type-matchups.x05", "type-matchups.x1", "type-matchups.x2", "type-matchups.x4"] as const;

const picture = (it: PokemonItem): HTMLElement => {
  const art = !!mediaUrl(it, "art");
  const el = sprite(it, { kind: art ? "art" : "sprite", size: 140 });
  if (art) el.classList.add("art");
  return el;
};

const chipRow = (types: readonly string[]) => types.map((t) => typeChip(t));

export function makeView(types: () => Types, puzzle: { id: string }): View<TMPuzzle, TMState, TMAction, null> {
  return {
    id: "type-matchups.quiz",
    name: "quiz",
    puzzle,
    controls: [
      { how: "click or tap a factor", what: "answer how effective" },
      { how: "click or tap types", what: "pick or unpick them, then check" },
    ],
    legend: [
      { sample: `<svg viewBox="0 0 40 16"><rect x="1" y="1" width="38" height="14" rx="7" fill="${typeColor("fire")}"/></svg>`, meaning: "a picked type" },
      { sample: `<svg viewBox="0 0 40 16"><rect x="1" y="1" width="38" height="14" rx="7" fill="none" stroke="var(--verdict-match, #2a8a3a)" stroke-width="2" stroke-dasharray="3 2"/></svg>`, meaning: "after checking: a type you missed" },
      { sample: `<svg viewBox="0 0 40 16"><rect x="1" y="1" width="38" height="14" rx="7" fill="none" stroke="var(--danger, #c33)" stroke-width="2"/><path d="M8 8H32" stroke="var(--danger, #c33)" stroke-width="2"/></svg>`, meaning: "after checking: a wrong pick" },
    ],
    mount(root, { session }) {
      style("type-matchups", CSS);
      const T = types();
      const p = session.puzzle;
      const el = h("div", { class: "tm" });
      root.append(el);
      let clockFill: HTMLElement | null = null;
      let clockBox: HTMLElement | null = null;

      const remaining = (): number => p.seconds * 1000 - (session.elapsedMs() - session.state.since);
      const go = () => {
        const st = session.state;
        if (st.open || !started(st)) session.dispatch({ type: "next", at: session.elapsedMs() });
        else if (current(p, st) && current(p, st)!.kind !== "factor") session.dispatch({ type: "submit" });
      };

      const defenderCard = (id: string, reveal: boolean, hint: boolean) => {
        const it = T.item(id);
        return h("div", { class: `tm-mon${hint ? " hint" : ""}` },
          h("div", { class: "tm-pic" }, picture(it)),
          h("div", null,
            h("div", { class: "tm-name" }, it.name),
            h("div", { class: "tm-types" }, p.showTypes || reveal ? chipRow(T.of(id)) : h("span", { class: "unknown" }, "types hidden"))));
      };

      /** What the last answer was and how it works out. */
      const explain = (q: Question, r: Reply): HTMLElement => {
        const right = isRight(T, q, r);
        const a = answerOf(T, q);
        const verdict = h("div", { class: `tm-verdict ${right ? "right" : "wrong"}` },
          r === null ? "time's up" : right ? "right" : "wrong");
        const lines: HTMLElement[] = [];
        const line = (...c: (Node | string)[]) => h("div", { class: "tm-line" }, ...c);
        if (q.kind === "factor") {
          const def = T.of(q.defender);
          lines.push(line(typeChip(q.attack), ...def.flatMap((d, i) => [i ? " × " : " vs ", typeChip(d), ` ${factorText(single(T, q.attack, d))}`]), def.length > 1 ? ` = ${factorText(factor(T, q.attack, def))}` : ""));
        } else if (q.kind === "weak") {
          const def = T.of(q.defender);
          const picked = Array.isArray(r) ? r : [];
          const shown = T.all.filter((t) => (a as string[]).includes(t) || picked.includes(t));
          for (const t of shown) {
            const f = factor(T, t, def);
            lines.push(line(typeChip(t), ...def.flatMap((d, i) => [i ? " × " : " vs ", typeChip(d), ` ${factorText(single(T, t, d))}`]), def.length > 1 ? ` = ${factorText(f)}` : "",
              (a as string[]).includes(t) ? (picked.includes(t) ? "" : h("span", { class: "tm-dim" }, " (missed)")) : h("span", { class: "tm-dim" }, " (not a weakness)")));
          }
        } else {
          const picked = Array.isArray(r) ? r : [];
          const shown = T.all.filter((t) => (a as string[]).includes(t) || picked.includes(t));
          for (const t of shown) {
            lines.push(line(typeChip(t), " takes ", ...q.attacks.flatMap((at, i) => [i ? ", " : "", `${factorText(single(T, at, t))} from `, typeChip(at)]),
              (a as string[]).includes(t) ? (picked.includes(t) ? "" : h("span", { class: "tm-dim" }, " (missed)")) : h("span", { class: "tm-dim" }, " (doesn't resist them all)")));
          }
        }
        return h("div", { class: "tm-why", role: "status" }, verdict, ...lines);
      };

      const render = () => {
        const st = session.state;
        const index = st.open ? st.replies.length - 1 : st.replies.length;
        const q = p.questions[Math.min(index, p.questions.length - 1)]!;
        const reply = st.open || index >= p.questions.length ? st.replies[Math.min(index, p.questions.length - 1)]! : undefined;
        const answered = reply !== undefined;
        const hint = session.activeHint?.focus as TMFocus | undefined;
        const answer = answerOf(T, q);
        clockFill = clockBox = null;

        const bar = h("div", { class: "tm-bar" },
          h("span", null, `${Math.min(index + 1, p.questions.length)} / ${p.questions.length}`),
          h("span", { class: "tm-score" }, `✓ ${rightCount(T, p, st)}`));
        if (p.seconds > 0) {
          clockFill = h("div", { style: `width: ${answered ? 0 : 100}%` });
          clockBox = h("div", { class: "tm-clock", role: "timer" }, clockFill);
          bar.append(clockBox);
        }

        const parts: (HTMLElement | null)[] = [bar];
        if (!started(st)) {
          clockFill?.style.setProperty("width", "100%");
          el.replaceChildren(bar, h("div", { class: "tm-in" },
            h("div", { class: "tm-ask" }, `${p.seconds} seconds per question`),
            h("div", { class: "tm-go" }, h("button", { class: "primary", "data-command": "type-matchups.go", onclick: go }, "start"))));
          return;
        }
        if (q.kind === "factor") {
          parts.push(h("div", { class: "tm-q" }, h("span", { class: "tm-big" }, typeChip(q.attack)), h("span", { class: "tm-arrow" }, "→"), defenderCard(q.defender, answered, !!hint?.defender)));
          parts.push(h("div", { class: "tm-ask" }, "how effective?"));
          parts.push(h("div", { class: "tm-factors" }, FACTORS.map((f, i) => {
            const chosen = answered && reply === f;
            const cls = [answered && f === answer ? "answer" : "", chosen ? `chosen ${f === answer ? "right" : "wrong"}` : ""].filter(Boolean).join(" ");
            return h("button", { "data-command": FACTOR_COMMANDS[i], class: cls || undefined, disabled: answered, onclick: () => session.dispatch({ type: "factor", factor: f }) }, factorText(f));
          })));
        } else {
          if (q.kind === "weak") {
            parts.push(h("div", { class: "tm-q" }, defenderCard(q.defender, answered, !!hint?.defender)));
            parts.push(h("div", { class: "tm-ask" }, "super effective against it:"));
          } else {
            parts.push(h("div", { class: "tm-ask" }, "takes ×½ or less from all of:"));
            parts.push(h("div", { class: "tm-attacks tm-big" }, chipRow(q.attacks)));
          }
          const picked = answered ? (Array.isArray(reply) ? reply : []) : st.picked;
          const ans = answer as string[];
          parts.push(h("div", { class: "tm-grid" }, T.all.map((t) => {
            const on = picked.includes(t);
            const cls = [
              hint?.types?.includes(t) ? "hint" : "",
              answered && ans.includes(t) ? (on ? "answer" : "missed") : "",
              answered && on && !ans.includes(t) ? "extra" : "",
            ].filter(Boolean).join(" ");
            return h("button", { style: `--tc: ${typeColor(t)}`, class: cls || undefined, "aria-pressed": String(on), disabled: answered, onclick: () => session.dispatch({ type: "pick", t }) }, t);
          })));
          if (!answered) parts.push(h("div", { class: "tm-go" }, h("button", { class: "primary", "data-command": "type-matchups.go", onclick: go }, "check")));
        }
        if (answered) {
          parts.push(explain(q, reply));
          if (st.open) parts.push(h("div", { class: "tm-go" }, h("button", { class: "primary", "data-command": "type-matchups.go", onclick: go }, st.replies.length >= p.questions.length ? "finish" : "next")));
        }
        const [head, ...body] = parts.filter((x): x is HTMLElement => !!x);
        el.replaceChildren(head!, h("div", { class: "tm-in" }, body));
        tick();
      };

      /** Time limit: the bar runs down from game time, and the view says when it's out (reduce stays pure). */
      const tick = () => {
        if (!p.seconds || !clockFill || session.finished) return;
        const st = session.state;
        if (st.open || !current(p, st)) return;
        const left = remaining();
        clockFill.style.width = `${Math.max(0, Math.min(100, (left / (p.seconds * 1000)) * 100))}%`;
        clockBox?.classList.toggle("low", left < 3000);
        if (left <= 0) session.dispatch({ type: "timeout" });
      };
      const interval = p.seconds ? setInterval(tick, 100) : null;

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const portrait = () => typeof window !== "undefined" && window.innerWidth < window.innerHeight;
      const answerFactor = (i: number) => () => {
        const q = current(p, session.state);
        if (q?.kind === "factor") session.dispatch({ type: "factor", factor: FACTORS[i]! });
      };
      return {
        get aspect() { return portrait() ? 0.62 : 1.25; },
        commands: bindCommands(BINDINGS, {
          "type-matchups.x0": answerFactor(0),
          "type-matchups.x025": answerFactor(1),
          "type-matchups.x05": answerFactor(2),
          "type-matchups.x1": answerFactor(3),
          "type-matchups.x2": answerFactor(4),
          "type-matchups.x4": answerFactor(5),
          "type-matchups.go": go,
        }, {
          ...Object.fromEntries(FACTOR_COMMANDS.map((id) => [id, { when: () => current(p, session.state)?.kind === "factor" }])),
          "type-matchups.go": { when: () => !session.finished && (session.state.open || !started(session.state) || (current(p, session.state)?.kind ?? "factor") !== "factor") },
        }),
        locate: (focus) => {
          const f = focus as TMFocus | undefined;
          const out: DOMRect[] = [];
          if (f?.defender) el.querySelectorAll(".tm-mon").forEach((x) => out.push(x.getBoundingClientRect()));
          for (const t of f?.types ?? []) {
            const b = [...el.querySelectorAll<HTMLElement>(".tm-grid button")].find((x) => x.textContent === t);
            if (b) out.push(b.getBoundingClientRect());
          }
          return out;
        },
        destroy() {
          if (interval) clearInterval(interval);
          offs.forEach((f) => f());
          el.remove();
        },
      };
    },
  };
}
