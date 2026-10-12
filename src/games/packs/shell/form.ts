import { coerce, formatCells, parseCells, type CellOffset, type CellsField, type Field, type Schema } from "../../core/schema";
import { h, style } from "../../core/dom";

/**
 * Form for a schema. Calls onChange with the full updated values on every edit and re-evaluates
 * `when` visibility in place.
 */
export function schemaForm(
  schema: Schema,
  values: Record<string, unknown>,
  onChange: (values: Record<string, unknown>) => void,
): HTMLElement {
  let current = { ...values };
  const rows: { key: string; field: Field; row: HTMLElement }[] = [];
  const form = h("div", { class: "form" });

  const refreshVisibility = () => {
    for (const r of rows) r.row.hidden = r.field.when ? !r.field.when(current) : false;
  };
  const set = (key: string, raw: unknown) => {
    current = { ...current, [key]: coerce(schema[key]!, raw) };
    refreshVisibility();
    onChange(current);
  };

  for (const [key, field] of Object.entries(schema)) {
    const id = `f-${Math.random().toString(36).slice(2)}`;
    const v = current[key];
    let control: HTMLElement;
    switch (field.type) {
      case "bool":
        control = h("input", {
          id, type: "checkbox", checked: Boolean(v),
          onchange: (e: Event) => set(key, (e.target as HTMLInputElement).checked),
        });
        break;
      case "int":
        control = h("input", {
          id, type: "number", value: v, min: field.min, max: field.max, step: field.step ?? 1,
          onchange: (e: Event) => {
            const input = e.target as HTMLInputElement;
            set(key, input.value);
            input.value = String(current[key]);
          },
        });
        break;
      case "enum":
        control = h("select", {
          id, onchange: (e: Event) => set(key, (e.target as HTMLSelectElement).value),
        }, field.options.map((o) => h("option", { value: o.value, selected: o.value === v, title: o.description }, o.label)));
        break;
      case "string":
        control = h("input", {
          id, type: "text", value: v, placeholder: field.placeholder,
          onchange: (e: Event) => set(key, (e.target as HTMLInputElement).value),
        });
        break;
      case "cells":
        control = cellsControl(id, field, v, (value) => set(key, value));
        break;
      case "set": {
        const chosen = new Set(v as readonly string[]);
        control = h("div", { class: "set", id }, field.options.map((o) =>
          h("label", { title: o.description },
            h("input", {
              type: "checkbox", checked: chosen.has(o.value),
              onchange: (e: Event) => {
                if ((e.target as HTMLInputElement).checked) chosen.add(o.value);
                else chosen.delete(o.value);
                set(key, [...chosen]);
              },
            }),
            o.label)));
        break;
      }
    }
    const row = h("div", { class: `row row-${field.type}` },
      h("label", { for: id, title: field.description }, field.label),
      control,
      field.description ? h("small", null, field.description) : null);
    rows.push({ key, field, row });
    form.append(row);
  }
  refreshVisibility();
  return form;
}

const CELLS_CSS = `
.cells-field { --cs: 1.7em; display: inline-flex; flex-direction: column; }
.cells-field .cells-row { display: flex; }
.cells-field.hex .cells-row + .cells-row { margin-top: calc(var(--cs) * -0.2887); }
.cells-field button { width: var(--cs); height: var(--cs); padding: 0; border: 1px solid var(--border); background: var(--cell); cursor: pointer; position: relative; }
.cells-field.hex button { height: calc(var(--cs) * 1.1547); border: 0; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); transform: scale(0.92); }
.cells-field button[aria-pressed="true"] { background: var(--cell-lit); }
.cells-field button.centre::after { content: ""; position: absolute; inset: 40%; border-radius: 50%; background: var(--text-dim); }
`;

/** Rows of (dx, dy) offsets within the field's radius, centre at (0, 0): a square block or an axial hexagon. */
function cellRows(field: CellsField): CellOffset[][] {
  const r = field.radius;
  const rows: CellOffset[][] = [];
  for (let dy = -r; dy <= r; dy++) {
    const row: CellOffset[] = [];
    const lo = field.layout === "hex" ? Math.max(-r, -r - dy) : -r;
    const hi = field.layout === "hex" ? Math.min(r, r - dy) : r;
    for (let dx = lo; dx <= hi; dx++) row.push([dx, dy]);
    rows.push(row);
  }
  return rows;
}

function cellsControl(id: string, field: CellsField, value: unknown, onChange: (value: string) => void): HTMLElement {
  style("form-cells", CELLS_CSS);
  const chosen = new Map<string, CellOffset>();
  for (const o of parseCells(String(value), field) ?? []) chosen.set(`${o[0]},${o[1]}`, o);
  const root = h("div", { class: `cells-field ${field.layout}`, id, role: "group" });
  for (const row of cellRows(field)) {
    const line = h("div", {
      class: "cells-row",
      style: field.layout === "hex" ? `margin-left: calc(var(--cs) * ${Math.abs(row[0]![1]) / 2})` : undefined,
    });
    for (const o of row) {
      const key = `${o[0]},${o[1]}`;
      const button = h("button", {
        type: "button", class: o[0] === 0 && o[1] === 0 ? "centre" : undefined,
        "aria-pressed": chosen.has(key), title: key,
        onclick: () => {
          if (chosen.has(key)) chosen.delete(key);
          else chosen.set(key, o);
          button.setAttribute("aria-pressed", String(chosen.has(key)));
          onChange(formatCells(chosen.values()));
        },
      });
      line.append(button);
    }
    root.append(line);
  }
  return root;
}
