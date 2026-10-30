import type { DataAttribute } from "../../core/types";
import type { PokemonDataset, PokemonItem } from "./types";

/**
 * Things a pokémon can be said to be ("fire type", "gen 3", "can mega evolve", "weighs 100 kg or
 * more"), built from the dataset's own attributes, so games can ask about them, group by them and
 * name them without listing pokémon by hand. A facet is named by a short id ("type:fire") that
 * puzzles store; the facet itself is looked up again from the dataset when needed.
 */
export type FacetKind =
  | "type" | "typing" | "gen" | "class" | "evo" | "forms" | "color" | "shape" | "egg"
  | "ability" | "gender" | "family" | "size" | "stats";

export interface Facet {
  /** Stable name: `<kind>:<value>` or `<attribute><op><number>`. */
  id: string;
  kind: FacetKind;
  /** A few words for a header or a group's reveal ("fire type", "gen 3"). */
  label: string;
  /** What it means in a sentence, when the label alone could be read two ways. */
  detail?: string;
  /** The type this facet is about, for drawing it as a type chip. */
  typeChip?: string;
  test(item: PokemonItem): boolean;
}

export const FACET_KINDS: readonly { value: FacetKind; label: string; description: string }[] = [
  { value: "type", label: "types", description: "has a type, e.g. fire type" },
  { value: "typing", label: "one or two types", description: "mono-type or dual-type" },
  { value: "gen", label: "generations", description: "introduced in a generation" },
  { value: "class", label: "legendary, mythical and other classes", description: "legendary, mythical, ultra beast, paradox, baby" },
  { value: "evo", label: "evolution stage", description: "first stage, middle stage, fully evolved, doesn't evolve" },
  { value: "forms", label: "forms", description: "can mega evolve, has a regional form or gigantamax; is a mega, regional form…" },
  { value: "color", label: "pokédex colors", description: "the pokédex's color for the species" },
  { value: "shape", label: "body shapes", description: "the pokédex's body shape" },
  { value: "egg", label: "egg groups", description: "in an egg group" },
  { value: "ability", label: "abilities", description: "can have an ability, hidden abilities included" },
  { value: "gender", label: "gender", description: "genderless, male only, female only" },
  { value: "family", label: "evolution families", description: "a pokémon and everything it evolves from or into" },
  { value: "size", label: "weight and height", description: "e.g. weighs 100 kg or more" },
  { value: "stats", label: "base stats", description: "e.g. speed 100 or more, base stat total 600 or more" },
];

const LEGENDARY = new Set(["sub-legendary", "restricted"]);

/** Thresholds people quote; round numbers near the dataset's ends. */
const THRESHOLDS: readonly { attr: string; op: ">=" | "<="; at: number; kind: "size" | "stats"; label: string }[] = [
  { attr: "weight", op: ">=", at: 100, kind: "size", label: "weighs 100 kg or more" },
  { attr: "weight", op: ">=", at: 200, kind: "size", label: "weighs 200 kg or more" },
  { attr: "weight", op: "<=", at: 5, kind: "size", label: "weighs 5 kg or less" },
  { attr: "height", op: ">=", at: 2, kind: "size", label: "2 m tall or more" },
  { attr: "height", op: "<=", at: 0.5, kind: "size", label: "0.5 m tall or less" },
  { attr: "bst", op: ">=", at: 600, kind: "stats", label: "base stat total 600 or more" },
  { attr: "bst", op: ">=", at: 500, kind: "stats", label: "base stat total 500 or more" },
  { attr: "bst", op: "<=", at: 300, kind: "stats", label: "base stat total 300 or less" },
  { attr: "hp", op: ">=", at: 100, kind: "stats", label: "hp 100 or more" },
  { attr: "atk", op: ">=", at: 120, kind: "stats", label: "attack 120 or more" },
  { attr: "def", op: ">=", at: 120, kind: "stats", label: "defense 120 or more" },
  { attr: "spa", op: ">=", at: 120, kind: "stats", label: "sp. attack 120 or more" },
  { attr: "spd", op: ">=", at: 120, kind: "stats", label: "sp. defense 120 or more" },
  { attr: "spe", op: ">=", at: 100, kind: "stats", label: "speed 100 or more" },
  { attr: "spe", op: "<=", at: 30, kind: "stats", label: "speed 30 or less" },
];

const FORM_WORDS: Record<string, { is: string; has: string }> = {
  mega: { is: "a mega evolution", has: "can mega evolve" },
  gmax: { is: "a gigantamax form", has: "has a gigantamax form" },
  regional: { is: "a regional form", has: "has a regional form" },
};

const cache = new WeakMap<PokemonDataset, { all: Facet[]; byId: Map<string, Facet> }>();

function build(ds: PokemonDataset): { all: Facet[]; byId: Map<string, Facet> } {
  const attr = (id: string): DataAttribute | undefined => ds.attributes.find((a) => a.id === id);
  const values = (id: string) => attr(id)?.values ?? [];
  const list = (it: PokemonItem, id: string): readonly string[] => {
    const v = it.values[id];
    return Array.isArray(v) ? (v as string[]) : [];
  };
  const out: Facet[] = [];
  const add = (f: Facet) => out.push(f);

  for (const t of values("type")) add({ id: `type:${t.value}`, kind: "type", label: `${t.label} type`, typeChip: t.value, test: (it) => list(it, "type").includes(t.value) });
  add({ id: "typing:mono", kind: "typing", label: "mono-type", detail: "has one type", test: (it) => list(it, "type").length === 1 });
  add({ id: "typing:dual", kind: "typing", label: "dual-type", detail: "has two types", test: (it) => list(it, "type").length === 2 });
  for (const g of values("gen")) add({ id: `gen:${g.value}`, kind: "gen", label: `gen ${g.value}`, detail: `first appeared in generation ${g.value} (forms: the form's own generation)`, test: (it) => it.values.gen === g.value });

  add({ id: "class:legendary", kind: "class", label: "legendary", detail: "a legendary pokémon (mythicals not included)", test: (it) => LEGENDARY.has(String(it.values.class)) });
  for (const c of values("class")) {
    if (c.value === "regular" || LEGENDARY.has(c.value)) continue;
    add({ id: `class:${c.value}`, kind: "class", label: c.label, test: (it) => it.values.class === c.value });
  }

  const stage = (it: PokemonItem) => Number(it.values.stage);
  add({ id: "evo:first", kind: "evo", label: "first stage", detail: "evolves, and evolves from nothing", test: (it) => stage(it) === 1 && it.values.final === false });
  add({ id: "evo:middle", kind: "evo", label: "middle stage", detail: "evolves from something and into something", test: (it) => stage(it) >= 2 && it.values.final === false });
  add({ id: "evo:final", kind: "evo", label: "fully evolved", detail: "evolves no further (pokémon that never evolve count)", test: (it) => it.values.final === true });
  add({ id: "evo:evolved", kind: "evo", label: "evolved", detail: "evolves from something", test: (it) => stage(it) >= 2 });
  add({ id: "evo:single", kind: "evo", label: "doesn't evolve", detail: "neither evolves nor evolves from anything", test: (it) => stage(it) === 1 && it.values.final === true });

  const items = ds.items();
  for (const [form, words] of Object.entries(FORM_WORDS)) {
    const bases = new Set(items.filter((i) => i.form === form).map((i) => i.base));
    if (!bases.size) continue;
    add({ id: `forms:has-${form}`, kind: "forms", label: words.has, detail: `its species ${words.has}${form === "mega" ? " (the mega itself counts)" : ""}`, test: (it) => bases.has(it.base) && (it.form === "default" || it.form === form) });
    add({ id: `forms:${form}`, kind: "forms", label: words.is, test: (it) => it.form === form });
  }

  for (const c of values("color")) add({ id: `color:${c.value}`, kind: "color", label: `${c.label} in the pokédex`, detail: `the pokédex lists its color as ${c.label}`, test: (it) => it.values.color === c.value });
  for (const c of values("shape")) add({ id: `shape:${c.value}`, kind: "shape", label: `shape: ${c.label}`, detail: `the pokédex lists its body shape as ${c.label}`, test: (it) => it.values.shape === c.value });
  for (const c of values("egg")) add({ id: `egg:${c.value}`, kind: "egg", label: `egg group: ${c.label}`, test: (it) => list(it, "egg").includes(c.value) });
  for (const c of values("ability")) add({ id: `ability:${c.value}`, kind: "ability", label: `ability: ${c.label}`, detail: `can have the ability ${c.label} (hidden abilities count)`, test: (it) => list(it, "ability").includes(c.value) });
  add({ id: "gender:genderless", kind: "gender", label: "genderless", test: (it) => it.values.gender === "genderless" });
  add({ id: "gender:male", kind: "gender", label: "male only", test: (it) => it.values.gender === "0" });
  add({ id: "gender:female", kind: "gender", label: "female only", test: (it) => it.values.gender === "8" });

  // a family is named after its earliest member in dex order
  const families = new Map<number, PokemonItem>();
  for (const it of items) {
    if (it.form !== "default") continue;
    const was = families.get(it.family);
    if (!was || it.species < was.species) families.set(it.family, it);
  }
  for (const [fam, first] of families) {
    add({ id: `family:${fam}`, kind: "family", label: `${first.name}'s family`, detail: `${first.name} and everything it evolves into`, test: (it) => it.family === fam });
  }

  for (const t of THRESHOLDS) {
    const id = `${t.attr}${t.op}${t.at}`;
    add({ id, kind: t.kind, label: t.label, test: (it) => {
      const v = it.values[t.attr];
      return typeof v === "number" && (t.op === ">=" ? v >= t.at : v <= t.at);
    } });
  }
  return { all: out, byId: new Map(out.map((f) => [f.id, f])) };
}

function catalog(ds: PokemonDataset): { all: Facet[]; byId: Map<string, Facet> } {
  let c = cache.get(ds);
  if (!c) cache.set(ds, c = build(ds));
  return c;
}

/** Every facet of the given kinds (all kinds when none are given), in a fixed order. */
export function facets(ds: PokemonDataset, kinds?: readonly string[]): Facet[] {
  const all = catalog(ds).all;
  return kinds ? all.filter((f) => kinds.includes(f.kind)) : all;
}

/** The facet a stored id names, or a facet that matches nothing when the dataset no longer has it. */
export function facet(ds: PokemonDataset, id: string): Facet {
  return catalog(ds).byId.get(id) ?? { id, kind: "type", label: id, test: () => false };
}

/** Indices into `items` of the ones a facet holds for. */
export function matching(f: Facet, items: readonly PokemonItem[]): number[] {
  const out: number[] = [];
  items.forEach((it, i) => { if (f.test(it)) out.push(i); });
  return out;
}
