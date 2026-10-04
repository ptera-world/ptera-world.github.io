/** A stable color per tag (same tag, same hue everywhere), mixed with theme tokens so it reads on any theme. */
export function tagStyle(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c = `hsl(${hue} 65% 50%)`;
  return `--tag-bg: color-mix(in srgb, ${c} 16%, var(--surface)); --tag-line: color-mix(in srgb, ${c} 45%, var(--border)); --tag-ink: color-mix(in srgb, ${c} 55%, var(--text));`;
}
