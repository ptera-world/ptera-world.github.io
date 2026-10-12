import { prefs } from "../../core/storage";
import type { CommandHub } from "./commands";
import { h, style } from "../../core/dom";


const CSS = `
.tip { position: fixed; z-index: 2000; pointer-events: none; max-width: min(320px, calc(100vw - 16px)); padding: 7px 10px; border-radius: 7px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); box-shadow: 0 8px 24px rgba(0,0,0,.35); font: 13px/1.4 var(--font); opacity: 0; transition: opacity 120ms; }
.tip.on { opacity: 1; }
.tip .k { display: inline-block; font: 11px var(--mono); padding: 0 5px; margin-left: 3px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-dim); }
.tip .d { color: var(--text-dim); display: block; margin-top: 2px; }
`;

/** -1 = off. */
export function tipDelay(): number {
  return prefs.get("tipDelay", 450);
}

export function setTipDelay(ms: number): void {
  prefs.set("tipDelay", ms);
}

/**
 * Tooltips for anything with data-command (label, what it does, its current keys) or data-tip
 * (free text), except inside [data-no-tip]. Native title tooltips on those elements are suppressed so there is one system.
 * Everything it adds goes away when `signal` aborts.
 */
export function installTooltips(hub: CommandHub, signal: AbortSignal): void {
  style("tooltips", CSS);
  const tip = h("div", { class: "tip", role: "tooltip" });
  document.body.append(tip);
  signal.addEventListener("abort", () => { clearTimeout(timer); tip.remove(); });
  let timer = 0;
  let target: HTMLElement | null = null;

  const hide = () => {
    clearTimeout(timer);
    tip.classList.remove("on");
    target = null;
  };

  const show = (el: HTMLElement) => {
    const id = el.dataset.command;
    tip.replaceChildren();
    if (id) {
      const cmd = hub.get(id);
      if (!cmd) return;
      tip.append(h("strong", null, cmd.label));
      for (const k of hub.keysFor(id)) tip.append(h("span", { class: "k" }, k));
      if (cmd.description) tip.append(h("span", { class: "d" }, cmd.description));
    } else {
      tip.append(el.dataset.tip ?? "");
    }
    const r = el.getBoundingClientRect();
    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.classList.add("on");
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    const top = r.top - th - 8 >= 8 ? r.top - th - 8 : r.bottom + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  document.addEventListener("pointerover", (e) => {
    const found = (e.target as Element | null)?.closest?.<HTMLElement>("[data-command],[data-tip]");
    const el = found?.closest("[data-no-tip]") ? null : found;
    if (el === target) return;
    hide();
    if (!el || e.pointerType === "touch") return;
    if (el.hasAttribute("title")) {
      el.dataset.tip ??= el.title;
      el.removeAttribute("title");
    }
    const delay = tipDelay();
    if (delay < 0) return;
    target = el;
    timer = window.setTimeout(() => { if (target === el && el.isConnected) show(el); }, delay);
  }, { signal });
  document.addEventListener("pointerdown", hide, { capture: true, signal });
  document.addEventListener("keydown", hide, { capture: true, signal });
  document.addEventListener("scroll", hide, { capture: true, passive: true, signal });
}
