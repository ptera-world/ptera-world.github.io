import { h, style } from "../../core/dom";
import type { DataAttribute, Dataset } from "../../core/types";
import { formatPicks, parsePicks, pickable, type Pick, type Picks } from "../../lib/dataset/facets";
import { filter } from "../../lib/dataset/query";

const CSS = `
.fp { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.fp-quick, .fp-vals { display: flex; flex-wrap: wrap; gap: 5px; }
.fp button.chip { border-radius: 99px; padding: 3px 11px; font-size: .92em; border: 1.5px solid var(--border); background: var(--surface); }
.fp button.chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.fp button.chip.colored[aria-pressed="true"] { background: var(--c); border-color: color-mix(in srgb, var(--c) 70%, #000); text-shadow: 0 1px 1px rgb(0 0 0 / .5); }
.fp button.chip.colored { border-color: var(--c); }
.fp-attr { display: grid; grid-template-columns: minmax(6em, 9em) 1fr; gap: 6px; align-items: start; }
.fp-attr > span { color: var(--text-dim); padding-top: 4px; }
.fp-range { display: flex; gap: 6px; align-items: center; }
.fp-range input { width: 6em; }
.fp-count { font-weight: 600; }
.fp-count.none { color: var(--danger); }
.fp details summary { cursor: pointer; color: var(--text-dim); }
.fp details[open] summary { margin-bottom: 6px; }
.fp details > div { display: flex; flex-direction: column; gap: 8px; }
@media (max-width: 520px) { .fp-attr { grid-template-columns: 1fr; } .fp-attr > span { padding: 0; } }
`;

/** "more" open or not, per dataset, kept while the form is redrawn. */
const moreOpen = new Map<string, boolean>();

/**
 * Pick what a filter keeps by tapping values: the dataset's own pools in one tap, then values per
 * attribute (the featured ones shown, the rest under "more"), number ranges and yes/no. It writes
 * the filter query (lib/dataset/query), so nothing is typed. A query picks can't say (from an old
 * link) is shown as it is, with a way back to picking.
 */
export function filterPicker(d: Dataset, value: string, onChange: (query: string) => void): HTMLElement {
  style("filter-picker", CSS);
  const attrs = pickable(d.attributes);
  const noun = d.noun?.many ?? "items";
  const root = h("div", { class: "fp" });
  const picks = parsePicks(value, d.attributes);
  const n = (() => { const r = filter(d.items(), value, d.attributes); return "error" in r ? null : r.items.length; })();
  const count = h("div", { class: `fp-count${n === 0 ? " none" : ""}`, "aria-live": "polite" }, n === null ? "" : `${n} ${n === 1 ? d.noun?.one ?? "item" : noun}`);

  const pools = d.pools ?? [];
  if (pools.length) {
    root.append(h("div", { class: "fp-quick", role: "group", "aria-label": "quick picks" }, pools.map((p) =>
      h("button", { type: "button", class: "chip", "aria-pressed": String(p.query.trim() === value.trim()), onclick: () => onChange(p.query) }, p.label))));
  }
  if (!picks) {
    root.append(h("div", null, h("span", { class: "w-dim" }, "from a link: "), h("code", null, value), " ",
      h("button", { type: "button", onclick: () => onChange(pools[0]?.query ?? "") }, "pick instead")));
    root.append(count);
    return root;
  }

  const set = (id: string, p: Pick | null) => {
    const next: Picks = { ...picks };
    if (p) next[id] = p; else delete next[id];
    onChange(formatPicks(next, d.attributes));
  };

  const row = (a: DataAttribute): HTMLElement => {
    const p = picks[a.id];
    let control: HTMLElement;
    if (a.kind === "bool") {
      const cur = p?.kind === "bool" ? p.value : null;
      control = h("div", { class: "fp-vals" }, ([[null, "either"], [true, "yes"], [false, "no"]] as const).map(([v, label]) =>
        h("button", { type: "button", class: "chip", "aria-pressed": String(cur === v), onclick: () => set(a.id, v === null ? null : { kind: "bool", value: v }) }, label)));
    } else if (a.kind === "number") {
      const r = p?.kind === "range" ? p : { kind: "range" as const };
      const nums = d.items().map((it) => it.values[a.id]).filter((x): x is number => typeof x === "number");
      const lo = nums.length ? Math.min(...nums) : undefined, hi = nums.length ? Math.max(...nums) : undefined;
      const box = (which: "min" | "max") => h("input", {
        type: "number", value: r[which] ?? "", placeholder: String((which === "min" ? lo : hi) ?? ""), "aria-label": `${a.label} ${which === "min" ? "at least" : "at most"}`,
        onchange: (e: Event) => {
          const t = (e.target as HTMLInputElement).value.trim();
          const next = { ...r, [which]: t === "" ? undefined : Number(t) };
          set(a.id, next.min === undefined && next.max === undefined ? null : next);
        },
      });
      control = h("div", { class: "fp-range" }, box("min"), "to", box("max"), a.unit ? h("span", { class: "w-dim" }, a.unit) : null);
    } else {
      const chosen = new Set(p?.kind === "values" ? p.values : []);
      control = h("div", { class: "fp-vals" }, (a.values ?? []).map((v) => {
        const b = h("button", {
          type: "button", class: `chip${v.color ? " colored" : ""}`, "aria-pressed": String(chosen.has(v.value)),
          onclick: () => {
            const next = new Set(chosen);
            if (next.has(v.value)) next.delete(v.value); else next.add(v.value);
            set(a.id, next.size ? { kind: "values", values: [...next] } : null);
          },
        }, v.label);
        if (v.color) b.style.setProperty("--c", v.color);
        return b;
      }));
    }
    return h("div", { class: "fp-attr" }, h("span", { title: a.description ?? "" }, a.label), control);
  };

  // the dataset's featured attributes, and any picked, up front; the rest under "more"
  const featured = new Set(d.featured ?? []);
  const front = attrs.filter((a) => featured.has(a.id) || picks[a.id]);
  const rest = attrs.filter((a) => !front.includes(a));
  root.append(...front.map(row));
  if (rest.length) {
    const det = h("details", { open: moreOpen.get(d.id) ?? false }, h("summary", null, `more: ${rest.map((a) => a.label).join(", ")}`), h("div", null, rest.map(row)));
    det.addEventListener("toggle", () => moreOpen.set(d.id, det.open));
    root.append(det);
  }
  root.append(count);
  return root;
}
