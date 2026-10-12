/**
 * Declarative option schemas. Used for puzzle generation params, plugin settings, and view
 * settings, so every option gets a form, persistence, URL encoding, and validation for free.
 */

interface FieldBase<T> {
  label: string;
  default: T;
  description?: string;
  /** Field is only relevant (shown) when this returns true for the current values. */
  when?: (values: Record<string, unknown>) => boolean;
}

export interface IntField extends FieldBase<number> { type: "int"; min?: number; max?: number; step?: number }
export interface BoolField extends FieldBase<boolean> { type: "bool" }
export interface EnumField extends FieldBase<string> {
  type: "enum";
  options: readonly { value: string; label: string; description?: string }[];
}
export interface StringField extends FieldBase<string> { type: "string"; placeholder?: string }
/** Unordered subset of options; serialized as comma-joined values. */
export interface SetField extends FieldBase<readonly string[]> {
  type: "set";
  options: readonly { value: string; label: string; description?: string }[];
}

/**
 * A set of (dx, dy) offsets drawn around a centre, within `radius` (square: Chebyshev distance;
 * hex: axial distance, offsets are (dq, dr)). The value is the canonical string of `formatCells`.
 */
export interface CellsField extends FieldBase<string> { type: "cells"; radius: number; layout: "square" | "hex" }

export type Field = IntField | BoolField | EnumField | StringField | SetField | CellsField;

export type CellOffset = [number, number];

/** Distance of an offset from the centre under a layout. */
export function cellsDistance(layout: "square" | "hex", dx: number, dy: number): number {
  return layout === "hex" ? Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx + dy)) : Math.max(Math.abs(dx), Math.abs(dy));
}

/**
 * Parse "dx,dy;dx,dy" (the empty string is the empty set) into sorted, duplicate-free offsets, or
 * null when it isn't that shape or an offset is further than `within.radius`.
 */
export function parseCells(raw: string, within?: { radius: number; layout: "square" | "hex" }): CellOffset[] | null {
  const seen = new Map<string, CellOffset>();
  if (raw !== "") {
    for (const part of raw.split(";")) {
      const m = /^(-?\d+),(-?\d+)$/.exec(part);
      if (!m) return null;
      const dx = Number(m[1]) || 0, dy = Number(m[2]) || 0;
      if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)) return null;
      if (within && cellsDistance(within.layout, dx, dy) > within.radius) return null;
      seen.set(`${dx},${dy}`, [dx, dy]);
    }
  }
  return [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Canonical string of offsets: duplicates removed, sorted by dx then dy, `dx,dy` joined by `;`. */
export function formatCells(offsets: Iterable<CellOffset>): string {
  const seen = new Map<string, CellOffset>();
  for (const [dx, dy] of offsets) seen.set(`${dx},${dy}`, [dx, dy]);
  return [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([x, y]) => `${x},${y}`).join(";");
}
export type Schema = Record<string, Field>;

type FieldValue<F extends Field> =
  F extends IntField ? number
  : F extends BoolField ? boolean
  : F extends SetField ? readonly string[]
  : string;

export type Values<S extends Schema> = { [K in keyof S]: FieldValue<S[K]> };

export function defineSchema<S extends Schema>(schema: S): S {
  return schema;
}

export function defaults<S extends Schema>(schema: S): Values<S> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(schema)) out[k] = f.default;
  return out as Values<S>;
}

/** Coerce one raw value (from JSON, a form, or a URL) into a valid value, falling back to the default. */
export function coerce(field: Field, raw: unknown): unknown {
  switch (field.type) {
    case "int": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return field.default;
      let v = Math.round(n);
      if (field.min !== undefined) v = Math.max(field.min, v);
      if (field.max !== undefined) v = Math.min(field.max, v);
      return v;
    }
    case "bool":
      if (typeof raw === "boolean") return raw;
      if (raw === "1" || raw === "true") return true;
      if (raw === "0" || raw === "false") return false;
      return field.default;
    case "enum":
      return typeof raw === "string" && field.options.some((o) => o.value === raw) ? raw : field.default;
    case "string":
      return typeof raw === "string" ? raw : field.default;
    case "set": {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? (raw === "" ? [] : raw.split(",")) : null;
      if (!list) return field.default;
      const allowed = new Set(field.options.map((o) => o.value));
      // canonical order = option order, so equal sets serialize identically
      const picked = new Set(list.filter((v): v is string => typeof v === "string" && allowed.has(v)));
      return field.options.map((o) => o.value).filter((v) => picked.has(v));
    }
    case "cells": {
      const parsed = typeof raw === "string" ? parseCells(raw, field) : null;
      return parsed ? formatCells(parsed) : field.default;
    }
  }
}

/** Fill missing keys with defaults, coerce present ones, drop unknown keys. */
export function resolve<S extends Schema>(schema: S, partial: Record<string, unknown> | undefined): Values<S> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(schema)) {
    out[k] = partial && k in partial ? coerce(f, partial[k]) : f.default;
  }
  return out as Values<S>;
}

function encodeValue(field: Field, v: unknown): string {
  if (field.type === "bool") return v ? "1" : "0";
  if (field.type === "set") return (v as readonly string[]).join(",");
  return String(v);
}

/**
 * Stable string form of resolved values: sorted keys, every key present.
 * Equal values always produce equal strings; used to key seeded generation.
 */
export function canonical<S extends Schema>(schema: S, values: Values<S>): string {
  return Object.keys(schema).sort()
    .map((k) => `${k}=${encodeURIComponent(encodeValue(schema[k]!, (values as Record<string, unknown>)[k]))}`)
    .join("&");
}

/** Write only non-default values, so URLs stay short. */
export function toQuery<S extends Schema>(schema: S, values: Values<S>, into: URLSearchParams, prefix = ""): void {
  for (const [k, f] of Object.entries(schema)) {
    const v = (values as Record<string, unknown>)[k];
    const enc = encodeValue(f, v);
    if (enc !== encodeValue(f, f.default)) into.set(prefix + k, enc);
  }
}

export function fromQuery<S extends Schema>(schema: S, from: URLSearchParams, prefix = ""): Values<S> {
  const raw: Record<string, unknown> = {};
  for (const k of Object.keys(schema)) {
    const v = from.get(prefix + k);
    if (v !== null) raw[k] = v;
  }
  return resolve(schema, raw);
}
