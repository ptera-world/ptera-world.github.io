/**
 * Builds data.json for the pokemon-data pack from PokeAPI's CSV dump (BSD-3-Clause) and Pokémon
 * Showdown's pokedex (MIT), so the site never asks PokeAPI anything at runtime. Run with
 * `bun run src/cli.ts data pokemon [--cache <dir>] [--refresh]`; the downloads are kept in the
 * cache directory and reused unless --refresh.
 *
 * Showdown's file is TypeScript; it is read as text by pattern, never run.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { DataAttribute } from "../../core/types";
import { encode, type PokemonDataFile } from "../../lib/pokemon/codec";
import { MEDIA_KINDS, type MediaKind, type PokemonForm, type PokemonItem } from "../../lib/pokemon/types";

const POKEAPI = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const SHOWDOWN = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/pokedex.ts";
const EN = "9";

const TABLES = [
  "pokemon", "pokemon_species", "pokemon_forms", "pokemon_form_names", "pokemon_species_names",
  "pokemon_types", "pokemon_stats", "pokemon_abilities", "ability_names", "abilities", "types", "type_names",
  "type_efficacy", "pokemon_color_names", "pokemon_shape_prose", "pokemon_habitat_names", "pokemon_egg_groups",
  "egg_group_prose", "growth_rates", "version_groups", "regions", "pokemon_species_flavor_text", "versions",
] as const;

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((k, i) => [k, r[i] ?? ""])));
}

async function download(url: string, to: string, refresh: boolean): Promise<string> {
  if (!refresh && existsSync(to)) return readFileSync(to, "utf8");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  writeFileSync(to, text);
  return text;
}

interface ShowdownSpecies {
  num: number;
  tags: string[];
}

/** Base species of Showdown's pokedex (forms and its own negative-numbered entries left out), by dex number. */
export function parseShowdown(text: string): Map<number, ShowdownSpecies> {
  const out = new Map<number, ShowdownSpecies>();
  // every entry is `\t<id>: {` … `\t},` at one tab of indentation
  for (const m of text.matchAll(/^\t([a-z0-9]+): \{\n([\s\S]*?)^\t\},?$/gm)) {
    const body = m[2]!;
    const num = Number(/^\t\tnum: (-?\d+),/m.exec(body)?.[1]);
    if (!Number.isInteger(num) || num <= 0) continue;
    if (/^\t\tbaseSpecies: /m.test(body)) continue;
    const tags = [...(/^\t\ttags: \[([^\]]*)\]/m.exec(body)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((t) => t[1]!);
    if (!out.has(num)) out.set(num, { num, tags });
  }
  return out;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Which pokémon ids have each kind of media, from GitHub's listing of the sprites and cries
 * repositories (a few requests, cached like the CSVs), so games never ask for a file that isn't there.
 */
async function mediaListing(cache: string, refresh: boolean): Promise<Record<MediaKind, Set<number>>> {
  const api = "https://api.github.com/repos/PokeAPI";
  const tree = async (repo: string, path: string[], file: string): Promise<Set<number>> => {
    const root = JSON.parse(await download(`${api}/${repo}/contents/`, join(cache, `tree-${repo}.json`), refresh)) as { name: string; type: string; sha: string }[];
    const top = root.find((x) => x.name === path[0] && x.type === "dir");
    if (!top) throw new Error(`${repo}: no ${path[0]}`);
    let sha = top.sha;
    for (const [i, part] of path.slice(1).entries()) {
      const name = `tree-${repo}-${path.slice(0, i + 2).join("-")}.json`;
      const listing = JSON.parse(await download(`${api}/${repo}/git/trees/${sha}`, join(cache, name), refresh)) as { tree: { path: string; type: string; sha: string }[]; truncated: boolean };
      if (listing.truncated) throw new Error(`${repo}/${path.join("/")}: listing truncated`);
      const next = listing.tree.find((x) => x.path === part && x.type === "tree");
      if (!next) throw new Error(`${repo}: no ${path.slice(0, i + 2).join("/")}`);
      sha = next.sha;
    }
    const leaf = JSON.parse(await download(`${api}/${repo}/git/trees/${sha}`, join(cache, `tree-${repo}-${path.join("-")}-files.json`), refresh)) as { tree: { path: string; type: string }[]; truncated: boolean };
    if (leaf.truncated) throw new Error(`${repo}/${path.join("/")}: listing truncated`);
    const re = new RegExp(`^(\\d+)\\.${file}$`);
    return new Set(leaf.tree.flatMap((x) => { const m = re.exec(x.path); return x.type === "blob" && m ? [Number(m[1])] : []; }));
  };
  return {
    sprite: await tree("sprites", ["sprites", "pokemon"], "png"),
    shiny: await tree("sprites", ["sprites", "pokemon", "shiny"], "png"),
    art: await tree("sprites", ["sprites", "pokemon", "other", "official-artwork"], "png"),
    cry: await tree("cries", ["cries", "pokemon", "latest"], "ogg"),
  };
}

export async function buildPokemonData(opts: { cache: string; out: string; refresh?: boolean }): Promise<PokemonDataFile> {
  mkdirSync(opts.cache, { recursive: true });
  const t: Record<string, Record<string, string>[]> = {};
  for (const name of TABLES) t[name] = parseCsv(await download(`${POKEAPI}/${name}.csv`, join(opts.cache, `${name}.csv`), !!opts.refresh));
  const showdown = parseShowdown(await download(SHOWDOWN, join(opts.cache, "showdown-pokedex.ts"), !!opts.refresh));
  const media = await mediaListing(opts.cache, !!opts.refresh);

  const by = <K extends string>(rows: Record<string, string>[], key: K) => {
    const m = new Map<string, Record<string, string>[]>();
    for (const r of rows) {
      const k = r[key]!;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const english = (rows: Record<string, string>[], idKey: string, langKey = "local_language_id") =>
    new Map(rows.filter((r) => r[langKey] === EN).map((r) => [r[idKey]!, r]));

  const species = new Map(t.pokemon_species!.map((r) => [r.id!, r]));
  const speciesNames = english(t.pokemon_species_names!, "pokemon_species_id");
  const formNames = english(t.pokemon_form_names!, "pokemon_form_id");
  const formsByPokemon = by(t.pokemon_forms!, "pokemon_id");
  const vgGen = new Map(t.version_groups!.map((r) => [r.id!, Number(r.generation_id)]));
  const typeIds = new Map(t.types!.filter((r) => Number(r.id) < 1000 && r.identifier !== "stellar").map((r) => [r.id!, r.identifier!]));
  const typeLabel = english(t.type_names!, "type_id");
  const abilityName = english(t.ability_names!, "ability_id");
  const abilityIdent = new Map(t.abilities!.map((r) => [r.id!, r.identifier!]));
  const colorName = english(t.pokemon_color_names!, "pokemon_color_id");
  const shapeName = english(t.pokemon_shape_prose!, "pokemon_shape_id");
  const habitatName = english(t.pokemon_habitat_names!, "pokemon_habitat_id");
  const eggName = english(t.egg_group_prose!, "egg_group_id");
  const growth = new Map(t.growth_rates!.map((r) => [r.id!, r.identifier!]));
  const regionIds = new Set(t.regions!.map((r) => r.identifier!));
  const typesOf = by(t.pokemon_types!, "pokemon_id");
  const statsOf = by(t.pokemon_stats!, "pokemon_id");
  const abilitiesOf = by(t.pokemon_abilities!, "pokemon_id");
  const eggOf = by(t.pokemon_egg_groups!, "species_id");
  const versionOrder = new Map(t.versions!.map((r) => [r.id!, Number(r.id)]));

  // latest English dex entry per species
  const entry = new Map<string, string>();
  const entryVersion = new Map<string, number>();
  for (const r of t.pokemon_species_flavor_text!) {
    if (r.language_id !== EN) continue;
    const v = versionOrder.get(r.version_id!) ?? 0;
    if ((entryVersion.get(r.species_id!) ?? -1) >= v) continue;
    entryVersion.set(r.species_id!, v);
    entry.set(r.species_id!, r.flavor_text!.replace(/[\f\n\r­]+/g, " ").replace(/\s+/g, " ").trim());
  }

  // evolution: stage counts from the family's first species; final means nothing evolves from it
  const evolvesInto = new Set(t.pokemon_species!.map((r) => r.evolves_from_species_id).filter(Boolean));
  const stageOf = (id: string): number => {
    let n = 1;
    for (let s = species.get(id); s?.evolves_from_species_id; s = species.get(s.evolves_from_species_id)) n++;
    return n;
  };

  const defaultPokemon = new Map<string, string>(); // species id → pokemon identifier of its default
  const defaultPokemonId = new Map<string, string>(); // species id → pokemon id of its default
  for (const p of t.pokemon!) if (p.is_default === "1") { defaultPokemon.set(p.species_id!, p.identifier!); defaultPokemonId.set(p.species_id!, p.id!); }

  const PARADOX_ABILITIES = new Set(["protosynthesis", "quark-drive"]);
  const items: PokemonItem[] = [];
  const notes: string[] = [];
  for (const p of t.pokemon!) {
    const sp = species.get(p.species_id!);
    if (!sp) { notes.push(`${p.identifier}: no species ${p.species_id}`); continue; }
    const forms = formsByPokemon.get(p.id!) ?? [];
    const form = forms.find((f) => f.is_default === "1") ?? forms[0];
    const formIdent = form?.form_identifier ?? "";
    const isDefault = p.is_default === "1";
    const kind: PokemonForm = isDefault ? "default"
      : form?.is_mega === "1" || /(^|-)mega(-|$)/.test(formIdent) ? "mega"
      : /(^|-)gmax(-|$)/.test(formIdent) ? "gmax"
      : regionIds.has(formIdent.split("-")[0]!) && typesOf.get(p.id!)?.map((r) => r.type_id).join() !== typesOf.get(defaultPokemonId.get(sp.id!) ?? "")?.map((r) => r.type_id).join() ? "regional"
      : "other";
    const spName = speciesNames.get(sp.id!)?.name ?? sp.identifier!;
    const fName = form ? formNames.get(form.id!) : undefined;
    const name = isDefault ? spName : (fName?.pokemon_name || (fName?.form_name ? `${spName} (${fName.form_name})` : p.identifier!));
    const types = (typesOf.get(p.id!) ?? []).sort((a, b) => Number(a.slot) - Number(b.slot)).map((r) => typeIds.get(r.type_id!)!).filter(Boolean);
    const stats = Object.fromEntries((statsOf.get(p.id!) ?? []).map((r) => [r.stat_id!, Number(r.base_stat)]));
    const abil = (abilitiesOf.get(p.id!) ?? []).sort((a, b) => Number(a.slot) - Number(b.slot));
    const abilities = [...new Set(abil.map((r) => r.ability_id!))];
    const gen = isDefault ? Number(sp.generation_id) : (vgGen.get(form?.introduced_in_version_group_id ?? "") ?? Number(sp.generation_id));
    const sd = showdown.get(Number(sp.id));
    const tags = sd?.tags ?? [];
    const paradox = abilities.some((a) => PARADOX_ABILITIES.has(abilityIdent.get(a) ?? ""));
    const cls = sp.is_mythical === "1" ? "mythical"
      : tags.includes("Restricted Legendary") ? "restricted"
      : tags.includes("Ultra Beast") ? "ultra-beast"
      : paradox ? "paradox"
      : tags.includes("Sub-Legendary") || sp.is_legendary === "1" ? "sub-legendary"
      : sp.is_baby === "1" ? "baby"
      : "regular";
    const gr = Number(sp.gender_rate);
    const hp = stats["1"], atk = stats["2"], def = stats["3"], spa = stats["4"], spd = stats["5"], spe = stats["6"];
    const base = defaultPokemon.get(sp.id!) ?? p.identifier!;
    const prevoSpecies = sp.evolves_from_species_id;
    items.push({
      id: p.identifier!,
      name,
      pid: Number(p.id),
      media: MEDIA_KINDS.filter((k) => media[k].has(Number(p.id))),
      species: Number(sp.id),
      family: Number(sp.evolution_chain_id),
      base,
      prevo: prevoSpecies ? defaultPokemon.get(prevoSpecies) ?? null : null,
      form: kind,
      values: {
        dex: Number(sp.id),
        gen: String(gen),
        type: types,
        hp: hp ?? null, atk: atk ?? null, def: def ?? null, spa: spa ?? null, spd: spd ?? null, spe: spe ?? null,
        bst: [hp, atk, def, spa, spd, spe].every((v) => v !== undefined) ? hp! + atk! + def! + spa! + spd! + spe! : null,
        height: p.height ? round(Number(p.height) / 10, 1) : null,
        weight: p.weight ? round(Number(p.weight) / 10, 1) : null,
        ability: abilities.map((a) => abilityIdent.get(a)!).filter(Boolean),
        hidden: abil.filter((r) => r.is_hidden === "1").map((r) => abilityIdent.get(r.ability_id!)!).filter(Boolean),
        color: colorName.has(sp.color_id!) ? sp.color_id! : null,
        shape: shapeName.has(sp.shape_id!) ? sp.shape_id! : null,
        habitat: habitatName.has(sp.habitat_id!) ? sp.habitat_id! : null,
        egg: (eggOf.get(sp.id!) ?? []).map((r) => r.egg_group_id!).filter((g) => eggName.has(g)),
        stage: String(stageOf(sp.id!)),
        final: !evolvesInto.has(sp.id!),
        class: cls,
        form: kind,
        capture: sp.capture_rate ? Number(sp.capture_rate) : null,
        happiness: sp.base_happiness ? Number(sp.base_happiness) : null,
        growth: growth.get(sp.growth_rate_id!) ?? null,
        gender: gr < 0 ? "genderless" : String(gr),
        eggcycles: sp.hatch_counter ? Number(sp.hatch_counter) : null,
        genus: speciesNames.get(sp.id!)?.genus || null,
        entry: entry.get(sp.id!) ?? null,
      },
    });
  }

  // aliases: what people type for names with symbols, accents or punctuation
  for (const it of items) {
    const plain = it.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/♀/g, " female").replace(/♂/g, " male");
    const a = new Set([plain, it.id.replace(/-/g, " ")].filter((x) => x.toLowerCase() !== it.name.toLowerCase()));
    if (a.size) it.aliases = [...a];
  }

  const used = (attr: string) => new Set(items.flatMap((i) => { const v = i.values[attr]; return v === null ? [] : Array.isArray(v) ? v : [String(v)]; }));
  const choices = (attr: string, label: (v: string) => string, order?: (a: string, b: string) => number) =>
    [...used(attr)].sort(order ?? ((a, b) => label(a).localeCompare(label(b)))).map((v) => ({ value: v, label: label(v) }));
  const numeric = (a: string, b: string) => Number(a) - Number(b);
  const attributes: DataAttribute[] = [
    { id: "dex", label: "dex number", kind: "number", near: { abs: 20 }, description: "national pokédex number of its species" },
    { id: "gen", label: "generation", kind: "ordinal", near: { abs: 1 }, values: choices("gen", (v) => `gen ${v}`, numeric), description: "the generation it first appeared in (for forms: the form's own)" },
    { id: "type", label: "type", kind: "set", ordered: true, values: [...typeIds.values()].map((v) => ({ value: v, label: typeLabel.get([...typeIds].find(([, i]) => i === v)?.[0] ?? "")?.name?.toLowerCase() ?? v })) },
    { id: "hp", label: "hp", kind: "number", near: { abs: 10 } },
    { id: "atk", label: "attack", kind: "number", near: { abs: 10 } },
    { id: "def", label: "defense", kind: "number", near: { abs: 10 } },
    { id: "spa", label: "sp. attack", kind: "number", near: { abs: 10 } },
    { id: "spd", label: "sp. defense", kind: "number", near: { abs: 10 } },
    { id: "spe", label: "speed", kind: "number", near: { abs: 10 } },
    { id: "bst", label: "base stat total", kind: "number", near: { abs: 50 } },
    { id: "height", label: "height", kind: "number", unit: "m", decimals: 1, near: { rel: 0.2 } },
    { id: "weight", label: "weight", kind: "number", unit: "kg", decimals: 1, near: { rel: 0.2 } },
    { id: "ability", label: "abilities", kind: "set", values: choices("ability", (v) => abilityName.get([...abilityIdent].find(([, i]) => i === v)?.[0] ?? "")?.name?.toLowerCase() ?? v.replace(/-/g, " ")) },
    { id: "hidden", label: "hidden ability", kind: "set", values: choices("hidden", (v) => abilityName.get([...abilityIdent].find(([, i]) => i === v)?.[0] ?? "")?.name?.toLowerCase() ?? v.replace(/-/g, " ")) },
    { id: "color", label: "color", kind: "category", values: choices("color", (v) => (colorName.get(v)?.name ?? v).toLowerCase()), description: "the pokédex's color for the species" },
    { id: "shape", label: "body shape", kind: "category", values: choices("shape", (v) => (shapeName.get(v)?.name ?? v).toLowerCase()) },
    { id: "habitat", label: "habitat", kind: "category", values: choices("habitat", (v) => (habitatName.get(v)?.name ?? v).toLowerCase()), description: "only recorded for generations 1 to 3" },
    { id: "egg", label: "egg groups", kind: "set", values: choices("egg", (v) => (eggName.get(v)?.name ?? v).toLowerCase()) },
    { id: "stage", label: "evolution stage", kind: "ordinal", near: { abs: 1 }, values: choices("stage", (v) => ["first", "second", "third", "fourth"][Number(v) - 1] ?? v, numeric) },
    { id: "final", label: "fully evolved", kind: "bool" },
    { id: "class", label: "class", kind: "category", values: [
      { value: "regular", label: "regular" }, { value: "baby", label: "baby" }, { value: "sub-legendary", label: "sub-legendary" },
      { value: "restricted", label: "restricted legendary" }, { value: "mythical", label: "mythical" },
      { value: "ultra-beast", label: "ultra beast" }, { value: "paradox", label: "paradox" },
    ] },
    { id: "form", label: "form", kind: "category", values: [
      { value: "default", label: "standard" }, { value: "mega", label: "mega" }, { value: "gmax", label: "gigantamax" },
      { value: "regional", label: "regional" }, { value: "other", label: "other form" },
    ] },
    { id: "capture", label: "catch rate", kind: "number", near: { abs: 15 } },
    { id: "happiness", label: "base friendship", kind: "number", near: { abs: 20 } },
    { id: "growth", label: "growth rate", kind: "category", values: choices("growth", (v) => v.replace(/-/g, " ")) },
    { id: "gender", label: "gender ratio", kind: "category", values: choices("gender", (v) => v === "genderless" ? "genderless" : v === "0" ? "male only" : v === "8" ? "female only" : `${(Number(v) / 8) * 100}% female`, (a, b) => (a === "genderless" ? 9 : Number(a)) - (b === "genderless" ? 9 : Number(b))) },
    { id: "eggcycles", label: "egg cycles", kind: "number", near: { abs: 5 } },
    { id: "genus", label: "category", kind: "text", description: "what the pokédex calls it, e.g. \"seed pokémon\"" },
    { id: "entry", label: "dex entry", kind: "text", description: "its most recent english pokédex entry" },
  ];

  const typeChart: Record<string, Record<string, number>> = {};
  for (const r of t.type_efficacy!) {
    const a = typeIds.get(r.damage_type_id!), d = typeIds.get(r.target_type_id!);
    if (!a || !d) continue;
    (typeChart[a] ??= {})[d] = Number(r.damage_factor) / 100;
  }

  // checks against Showdown, reported rather than silently trusted
  const sdParadox = [...showdown.values()].filter((s) => s.tags.includes("Paradox")).map((s) => s.num);
  const ourParadox = new Set(items.filter((i) => i.form === "default" && i.values.class === "paradox").map((i) => i.species));
  for (const n of sdParadox) if (!ourParadox.has(n)) notes.push(`showdown says ${n} is paradox; its abilities don't`);
  const sdUB = [...showdown.values()].filter((s) => s.tags.includes("Ultra Beast")).length;
  notes.push(`classes: ${JSON.stringify(Object.fromEntries([...used("class")].map((c) => [c, items.filter((i) => i.form === "default" && i.values.class === c).length])))}; showdown ultra beasts ${sdUB}, paradox ${sdParadox.length} (ours ${ourParadox.size})`);
  for (const k of MEDIA_KINDS) notes.push(`${k}: ${items.filter((i) => i.media.includes(k)).length} of ${items.length}${k === "sprite" ? `, missing ${items.filter((i) => !i.media.includes(k)).map((i) => i.id).join(" ")}` : ""}`);
  notes.push(`forms: ${JSON.stringify(Object.fromEntries(["default", "mega", "gmax", "regional", "other"].map((k) => [k, items.filter((i) => i.form === k).length])))}`);

  const body = { credits: CREDITS, attributes, items, typeChart };
  const version = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  const file = encode(items, attributes, { version, credits: CREDITS, typeChart });
  writeFileSync(opts.out, JSON.stringify(file));
  for (const n of notes) console.log(n);
  return file;
}

const CREDITS = "pokémon data from PokeAPI (pokeapi.co, BSD 3-Clause) and Pokémon Showdown (MIT): legendary, ultra beast and paradox classes. sprites and cries are loaded from PokeAPI's sprites and cries repositories when shown, never copied here; they are © The Pokémon Company, Nintendo, Game Freak and Creatures. pokémon and its names are trademarks of Nintendo.";
