type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/**
 * Tiny element builder. `on*` keys attach listeners, `class`/`style` strings set attributes,
 * boolean true sets an empty attribute, false/null/undefined omit it.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el: Element, attrs: Attrs | null | undefined): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "value" && "value" in el) {
      (el as HTMLInputElement).value = String(v);
    } else if (k === "checked" && "checked" in el) {
      (el as HTMLInputElement).checked = Boolean(v);
    } else {
      el.setAttribute(k, v === true ? "" : String(v));
    }
  }
}

function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hrs = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Add a stylesheet once per id; later calls with the same id replace its text. Views own their CSS this way. */
export function style(id: string, css: string): void {
  let el = document.getElementById(`style-${id}`) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = `style-${id}`;
    document.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
}
