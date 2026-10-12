import type { Registry } from "./registry";
import { prefs } from "./storage";
import type { Theme } from "./types";
import { style } from "./dom";


declare module "./storage" {
  interface Prefs {
    theme: string;
    themeTokens: Record<string, string>;
  }
}

/** Color tokens a player can override directly. */
export const COLOR_TOKENS: readonly { id: string; label: string }[] = [
  { id: "bg", label: "background" },
  { id: "surface", label: "panels" },
  { id: "surface-2", label: "buttons" },
  { id: "border", label: "lines" },
  { id: "text", label: "text" },
  { id: "text-dim", label: "quiet text" },
  { id: "accent", label: "accent" },
  { id: "danger", label: "danger / mistakes" },
  { id: "warn", label: "warnings" },
  { id: "hint", label: "hints" },
  { id: "focus", label: "selection / focus" },
  { id: "cell", label: "cells" },
  { id: "cell-lit", label: "lit / filled cells" },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ id: `palette-${k}`, label: `piece color ${k}` })),
];

/** The theme choice that follows the OS light/dark preference. */
export const SYSTEM_THEME = "system";

export function themeChoice(): string {
  return prefs.get("theme", SYSTEM_THEME);
}

export function tokenOverrides(): Record<string, string> {
  return prefs.get("themeTokens", {});
}

/** Resolve SYSTEM_THEME to the first registered theme matching the OS light/dark preference. */
function pick(registry: Registry): Theme | undefined {
  const themes = registry.listThemes();
  const choice = themeChoice();
  if (choice !== SYSTEM_THEME) return themes.find((t) => t.id === choice) ?? themes[0];
  const light = matchMedia("(prefers-color-scheme: light)").matches;
  return themes.find((t) => t.scheme === (light ? "light" : "dark")) ?? themes[0];
}

/** Apply the chosen theme plus the player's overrides. Safe to call repeatedly. */
export function applyTheme(registry: Registry): void {
  const th = pick(registry);
  const tokens = { ...th?.tokens, ...tokenOverrides() };
  const body = Object.entries(tokens).map(([k, v]) => `--${k}: ${v};`).join(" ");
  style("theme", `:root { ${body} color-scheme: ${th?.scheme ?? "dark"}; }\n${th?.css ?? ""}`);
  current = th;
  for (const cb of listeners) cb();
}

let current: Theme | undefined;
const listeners = new Set<() => void>();

/** Called after any theme (re)application; views that draw assets re-render. */
export function onThemeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** A themed graphic by id, or the view's own default. */
export function asset(id: string, fallback: string): string {
  return current?.assets?.[id] ?? fallback;
}

export function setTheme(registry: Registry, id: string): void {
  prefs.set("theme", id);
  applyTheme(registry);
}

export function setTokenOverride(registry: Registry, token: string, value: string | null): void {
  const cur = { ...tokenOverrides() };
  if (value === null) delete cur[token];
  else cur[token] = value;
  prefs.set("themeTokens", cur);
  applyTheme(registry);
}

/** Re-apply when the OS scheme flips or a theme is registered (e.g. by a pack), until `signal` aborts. */
export function watchTheme(registry: Registry, signal: AbortSignal): void {
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => applyTheme(registry), { signal });
  registry.hooks.changed.tap(({ kind }) => { if (kind === "theme") applyTheme(registry); });
  applyTheme(registry);
}
