import type { DataItem, Dataset } from "../../core/types";
import { normalizeName } from "./names";

/**
 * An item spelled out the way its dataset says (see Dataset.spelling): by default the letters of
 * its name, lower case, accents and punctuation dropped (Farfetch’d: farfetchd, Nidoran♀:
 * nidoranf); a name with digits (Porygon2) has no spelling.
 */
export function spellingOf(d: Dataset, item: DataItem): readonly string[] | null {
  if (d.spelling?.of) return d.spelling.of(item);
  const w = normalizeName(item.name);
  return /^[a-z]+$/.test(w) ? w.split("") : null;
}

/** What a dataset's symbols are called ("letters" unless it says). */
export const spellingLabel = (d: Dataset): string => d.spelling?.label ?? "letters";
