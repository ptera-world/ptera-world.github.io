import type { DataAttribute, DataValue } from "../../core/types";
import { MEDIA_KINDS, type PokemonItem, type TypeChart } from "./types";

/**
 * The pokemon-data pack's file: items by column (one array per field, items in the same order),
 * so field names aren't repeated 1351 times, and text attributes once per species, since a
 * species' forms share its dex text.
 */
export interface PokemonDataFile {
  version: string;
  credits: string;
  attributes: DataAttribute[];
  typeChart: TypeChart;
  cols: {
    id: string[];
    name: string[];
    /** 0: none. */
    aliases: (string[] | 0)[];
    pid: number[];
    species: number[];
    family: number[];
    /** 0: the item is its own base. */
    base: (string | 0)[];
    prevo: (string | null)[];
    form: PokemonItem["form"][];
    /** Bit i set: MEDIA_KINDS[i] exists. */
    media: number[];
  };
  /** Non-text attributes: one value per item. */
  values: Record<string, DataValue[]>;
  /** Text attributes: species number → text. */
  text: Record<string, Record<string, string>>;
}

export function encode(items: readonly PokemonItem[], attributes: readonly DataAttribute[], rest: Pick<PokemonDataFile, "version" | "credits" | "typeChart">): PokemonDataFile {
  const isText = new Set(attributes.filter((a) => a.kind === "text").map((a) => a.id));
  const values: Record<string, DataValue[]> = {};
  const text: Record<string, Record<string, string>> = {};
  for (const a of attributes) {
    if (isText.has(a.id)) {
      const per: Record<string, string> = {};
      for (const it of items) {
        const v = it.values[a.id];
        if (typeof v !== "string") continue;
        const was = per[it.species];
        if (was !== undefined && was !== v) throw new Error(`${it.id}: ${a.id} differs from its species'`);
        per[it.species] = v;
      }
      text[a.id] = per;
    } else values[a.id] = items.map((it) => it.values[a.id] ?? null);
  }
  return {
    ...rest,
    attributes: [...attributes],
    cols: {
      id: items.map((i) => i.id),
      name: items.map((i) => i.name),
      aliases: items.map((i) => (i.aliases?.length ? [...i.aliases] : 0)),
      pid: items.map((i) => i.pid),
      species: items.map((i) => i.species),
      family: items.map((i) => i.family),
      base: items.map((i) => (i.base === i.id ? 0 : i.base)),
      prevo: items.map((i) => i.prevo),
      form: items.map((i) => i.form),
      media: items.map((i) => MEDIA_KINDS.reduce((m, k, b) => (i.media.includes(k) ? m | (1 << b) : m), 0)),
    },
    values,
    text,
  };
}

export function decode(file: PokemonDataFile): PokemonItem[] {
  const c = file.cols;
  return c.id.map((id, i): PokemonItem => {
    const values: Record<string, DataValue> = {};
    for (const a of file.attributes) {
      values[a.id] = a.kind === "text" ? file.text[a.id]?.[String(c.species[i])] ?? null : file.values[a.id]?.[i] ?? null;
    }
    const aliases = c.aliases[i];
    return {
      id,
      name: c.name[i]!,
      ...(aliases ? { aliases } : {}),
      pid: c.pid[i]!,
      species: c.species[i]!,
      family: c.family[i]!,
      base: c.base[i] || id,
      prevo: c.prevo[i] ?? null,
      form: c.form[i]!,
      media: MEDIA_KINDS.filter((_, b) => (c.media[i]! & (1 << b)) !== 0),
      values,
    };
  });
}
