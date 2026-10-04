import { h, style } from "./dom";

/** Game-agnostic visual feedback primitives. Effects position themselves with client rects from a view's locate()/locateChange(). */

const CSS = `
#fx-layer { position: fixed; inset: 0; pointer-events: none; z-index: 50; overflow: hidden; }
.fx-flash { position: fixed; border-radius: 4px; box-shadow: inset 0 0 0 2px var(--fx-color, var(--accent)); background: color-mix(in srgb, var(--fx-color, var(--accent)) 22%, transparent); animation: fx-fade var(--fx-ms, 900ms) ease-out forwards; }
.fx-label { position: fixed; font: 600 11px var(--font); padding: 2px 6px; border-radius: 4px; background: var(--fx-color, var(--accent)); color: var(--bg); white-space: nowrap; transform: translate(-50%, -110%); animation: fx-fade var(--fx-ms, 900ms) ease-out forwards; }
.fx-pop { position: fixed; border-radius: 6px; box-shadow: 0 0 0 2px var(--accent); animation: fx-pop 380ms ease-out forwards; }
.fx-bit { position: fixed; width: 7px; height: 7px; border-radius: 2px; animation: fx-bit var(--fx-ms, 1100ms) cubic-bezier(.2,.7,.4,1) forwards; }
.fx-shake { animation: fx-shake 320ms ease-in-out; }
@keyframes fx-fade { 0% { opacity: 0; } 15% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
@keyframes fx-pop { 0% { opacity: 0.9; transform: scale(0.85); } 100% { opacity: 0; transform: scale(1.25); } }
@keyframes fx-bit { 0% { opacity: 1; transform: translate(0, 0) rotate(0); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); } }
@keyframes fx-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(2px); } }
`;

function layer(): HTMLElement {
  style("fx", CSS);
  let el = document.getElementById("fx-layer");
  if (!el) {
    el = h("div", { id: "fx-layer", "aria-hidden": "true" });
    document.body.append(el);
  }
  return el;
}

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

function spawn(el: HTMLElement, ms: number): void {
  layer().append(el);
  setTimeout(() => el.remove(), ms + 50);
}

function place(el: HTMLElement, r: DOMRect): HTMLElement {
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  return el;
}

export const fx = {
  flash(rects: DOMRect[], opts: { ms?: number; color?: string; label?: string } = {}): void {
    const ms = opts.ms ?? 900;
    for (const r of rects) {
      const el = place(h("div", { class: "fx-flash" }), r);
      el.style.setProperty("--fx-ms", `${ms}ms`);
      if (opts.color) el.style.setProperty("--fx-color", opts.color);
      spawn(el, ms);
    }
    const first = rects[0];
    if (opts.label && first) {
      const lab = h("div", { class: "fx-label" }, opts.label);
      Object.assign(lab.style, { left: `${first.left + first.width / 2}px`, top: `${first.top}px` });
      lab.style.setProperty("--fx-ms", `${ms + 300}ms`);
      if (opts.color) lab.style.setProperty("--fx-color", opts.color);
      spawn(lab, ms + 300);
    }
  },
  pop(rects: DOMRect[]): void {
    if (reducedMotion()) return;
    for (const r of rects) spawn(place(h("div", { class: "fx-pop" }), r), 380);
  },
  burst(x: number, y: number, count = 40, ms = 1100): void {
    if (reducedMotion()) return;
    const colors = ["var(--accent)", "var(--cell-lit)", "var(--hint)", "var(--focus)", "var(--warn)"];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 80 + Math.random() * 220;
      const el = h("div", { class: "fx-bit" });
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, background: colors[i % colors.length] });
      el.style.setProperty("--dx", `${Math.cos(a) * d}px`);
      el.style.setProperty("--dy", `${Math.sin(a) * d + 60}px`);
      el.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
      el.style.setProperty("--fx-ms", `${ms}ms`);
      spawn(el, ms);
    }
  },
  shake(el: Element | null): void {
    if (!el || reducedMotion()) return;
    el.classList.remove("fx-shake");
    void (el as HTMLElement).offsetWidth;
    el.classList.add("fx-shake");
    setTimeout(() => el.classList.remove("fx-shake"), 340);
  },
};

export type Fx = typeof fx;
