/** Themed graphics under `<prefix>.<key>`, one id per key of `defaults`. */
export const themedAssets = <K extends string>(
  look: { asset(id: string, fallback: string): string },
  prefix: string,
  defaults: Readonly<Record<K, string>>,
) => (key: K): string => look.asset(`${prefix}.${key}`, defaults[key]);
