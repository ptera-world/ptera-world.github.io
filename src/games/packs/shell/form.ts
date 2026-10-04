import { coerce, type Field, type Schema } from "../../core/schema";
import { h } from "../../core/dom";

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
