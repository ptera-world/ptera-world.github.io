import { expect, test } from "bun:test";
import { applyEdit } from "../packs/shell/form";
import { defaults, defineSchema, effective, fromQuery, resolve, toQuery } from "./schema";

/** A dataset field, then fields whose choices and defaults come from the dataset picked. */
const DATA: Record<string, { attrs: string[]; featured: string[]; pool: string }> = {
  a: { attrs: ["x", "y", "z"], featured: ["x", "y"], pool: "all-a" },
  b: { attrs: ["p", "q"], featured: ["q"], pool: "all-b" },
};
const schema = defineSchema({
  data: { type: "enum", label: "data", default: "a", options: [{ value: "a", label: "a" }, { value: "b", label: "b" }] },
  pool: { type: "string", label: "pool", default: (v) => DATA[String(v.data)]!.pool },
  attrs: {
    type: "set", label: "attrs",
    default: (v) => DATA[String(v.data)]!.featured,
    options: (v) => DATA[String(v.data)]!.attrs.map((x) => ({ value: x, label: x })),
  },
});

test("dependent defaults and choices follow the fields before them", () => {
  expect(defaults(schema)).toEqual({ data: "a", pool: "all-a", attrs: ["x", "y"] });
  expect(resolve(schema, { data: "b" })).toEqual({ data: "b", pool: "all-b", attrs: ["q"] });
  // a choice the picked dataset doesn't have is dropped
  expect(resolve(schema, { data: "b", attrs: ["x", "p"] }).attrs).toEqual(["p"]);
});

test("urls carry only what differs from the default given the fields before it", () => {
  const q = new URLSearchParams();
  toQuery(schema, resolve(schema, { data: "b" }), q);
  expect(q.toString()).toBe("data=b");
  expect(fromQuery(schema, q)).toEqual({ data: "b", pool: "all-b", attrs: ["q"] });
});

test("editing a field brings dependent defaults along and keeps the player's own valid choices", () => {
  const start = defaults(schema) as Record<string, unknown>;
  expect(applyEdit(schema, start, "data", "b")).toEqual({ data: "b", pool: "all-b", attrs: ["q"] });
  const custom = { ...start, pool: "mine" };
  expect(applyEdit(schema, custom, "data", "b")).toEqual({ data: "b", pool: "mine", attrs: ["q"] });
});

test("a setting hidden by its when takes its default, so it changes nothing", () => {
  const s = defineSchema({
    kind: { type: "enum", label: "kind", default: "a", options: [{ value: "a", label: "a" }, { value: "b", label: "b" }] },
    extra: { type: "bool", label: "extra", default: false, when: (v) => v.kind === "b" },
  });
  expect(effective(s, resolve(s, { kind: "a", extra: true }))).toEqual({ kind: "a", extra: false });
  expect(effective(s, resolve(s, { kind: "b", extra: true }))).toEqual({ kind: "b", extra: true });
});
