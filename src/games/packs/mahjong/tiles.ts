/**
 * Tile kinds 0–41: 0–8 dots 1–9, 9–17 bamboo 1–9, 18–26 characters 1–9, 27–30 winds (east,
 * south, west, north), 31–33 dragons (red, green, white), 34–37 flowers, 38–41 seasons. Any
 * flower matches any flower and any season any season; every other tile matches its own kind.
 */

export const KINDS = 42;

export const matchKey = (k: number): number => (k >= 38 ? 38 : k >= 34 ? 34 : k);

const SUITS = ["dots", "bamboo", "characters"] as const;
const WINDS = ["east", "south", "west", "north"] as const;
const DRAGONS = ["red", "green", "white"] as const;
const FLOWERS = ["plum", "orchid", "chrysanthemum", "bamboo"] as const;
const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

/** "3 dots", "east wind", "red dragon", "plum flower", "spring season". */
export function tileName(k: number): string {
  if (k < 27) return `${(k % 9) + 1} ${SUITS[Math.floor(k / 9)]}`;
  if (k < 31) return `${WINDS[k - 27]} wind`;
  if (k < 34) return `${DRAGONS[k - 31]} dragon`;
  if (k < 38) return `${FLOWERS[k - 34]} flower`;
  return `${SEASONS[k - 38]} season`;
}

/** What a match group is called: "3 dots", "flowers", "seasons". */
export const groupName = (k: number): string => (matchKey(k) === 34 ? "flowers" : matchKey(k) === 38 ? "seasons" : tileName(k));

/** Short codes for text: 1D–9D, 1B–9B, 1C–9C, EW SW WW NW, RD GD WD, F1–F4, S1–S4. */
export function tileCode(k: number): string {
  if (k < 27) return `${(k % 9) + 1}${"DBC"[Math.floor(k / 9)]}`;
  if (k < 31) return `${"ESWN"[k - 27]}W`;
  if (k < 34) return `${"RGW"[k - 31]}D`;
  if (k < 38) return `F${k - 33}`;
  return `S${k - 37}`;
}

const CODES = new Map(Array.from({ length: KINDS }, (_, k) => [tileCode(k), k]));

export function parseTile(text: string): number {
  const k = CODES.get(text.trim().toUpperCase());
  if (k === undefined) throw new Error(`"${text}" is not a tile (expected like 3D, 7B, 9C, EW, RD, F1, S4)`);
  return k;
}

/** The full 144-tile set: four of each suit tile, wind and dragon, one of each flower and season. */
export function fullSet(): number[] {
  const out: number[] = [];
  for (let k = 0; k < 34; k++) out.push(k, k, k, k);
  for (let k = 34; k < KINDS; k++) out.push(k);
  return out;
}

/**
 * Tiles for a layout of `n` spots (even): the full set when n is 144, else four of each kind
 * from `order` while four still fit, then a pair.
 */
export function tileSet(n: number, order: readonly number[]): number[] {
  if (n === 144) return fullSet();
  const out: number[] = [];
  for (const k of order) {
    if (out.length + 4 <= n) out.push(k, k, k, k);
    else if (out.length + 2 <= n) out.push(k, k);
    if (out.length === n) break;
  }
  return out;
}

// --- faces: SVG markup in a 0 0 10 13 box ---

const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const WIND_CHARS = ["東", "南", "西", "北"];
const FLOWER_CHARS = ["梅", "蘭", "菊", "竹"];
const SEASON_CHARS = ["春", "夏", "秋", "冬"];

const DOT_SPOTS: [number, number][][] = [
  [[0.5, 0.5]],
  [[0.5, 0.27], [0.5, 0.73]],
  [[0.25, 0.2], [0.5, 0.5], [0.75, 0.8]],
  [[0.3, 0.27], [0.7, 0.27], [0.3, 0.73], [0.7, 0.73]],
  [[0.27, 0.22], [0.73, 0.22], [0.5, 0.5], [0.27, 0.78], [0.73, 0.78]],
  [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  [[0.22, 0.14], [0.5, 0.26], [0.78, 0.38], [0.3, 0.6], [0.7, 0.6], [0.3, 0.84], [0.7, 0.84]],
  [[0.3, 0.14], [0.7, 0.14], [0.3, 0.38], [0.7, 0.38], [0.3, 0.62], [0.7, 0.62], [0.3, 0.86], [0.7, 0.86]],
  [[0.22, 0.2], [0.5, 0.2], [0.78, 0.2], [0.22, 0.5], [0.5, 0.5], [0.78, 0.5], [0.22, 0.8], [0.5, 0.8], [0.78, 0.8]],
];

const INK = "var(--mahjong-ink, #1d2a3a)";
const RED = "var(--mahjong-red, #c62828)";
const GREEN = "var(--mahjong-green, #1b7a36)";
const BLUE = "var(--mahjong-blue, #1e5bbf)";

const glyph = (ch: string, color: string, y = 7.6, size = 6.4) =>
  `<text x="5" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="${color}" font-family="var(--font-cjk, 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Hiragino Sans', 'Microsoft YaHei', 'PingFang SC', serif)" font-weight="700">${ch}</text>`;

function dots(n: number): string {
  const r = n === 1 ? 2.6 : n <= 4 ? 1.5 : n <= 6 ? 1.25 : 1.05;
  const colors = [BLUE, GREEN, RED];
  return DOT_SPOTS[n - 1]!.map(([x, y], i) => {
    const c = n === 1 ? RED : colors[(i + n) % 3]!;
    return `<circle cx="${1 + x * 8}" cy="${1.3 + y * 10.4}" r="${r}" fill="none" stroke="${c}" stroke-width="0.55"/><circle cx="${1 + x * 8}" cy="${1.3 + y * 10.4}" r="${r * 0.38}" fill="${c}"/>`;
  }).join("");
}

function bamboo(n: number): string {
  if (n === 1) return `<rect x="4" y="2" width="2" height="9" rx="1" fill="${GREEN}"/><rect x="3.4" y="6.1" width="3.2" height="0.8" fill="${RED}"/>`;
  return DOT_SPOTS[n - 1]!.map(([x, y], i) => {
    const c = n === 9 ? (i % 3 === 1 ? RED : GREEN) : i === 0 && n % 2 === 1 ? RED : GREEN;
    const h = n <= 4 ? 3.6 : n <= 6 ? 2.8 : 2.2;
    const cx = 1 + x * 8, cy = 1.3 + y * 10.4;
    return `<rect x="${cx - 0.55}" y="${cy - h / 2}" width="1.1" height="${h}" rx="0.5" fill="${c}"/><rect x="${cx - 0.75}" y="${cy - 0.18}" width="1.5" height="0.36" fill="${c}"/>`;
  }).join("");
}

/** Face markup for kind k. `labels` adds a corner code (like 3D) for telling tiles apart without the pictures. */
export function faceSvg(k: number, labels: boolean): string {
  let body: string;
  if (k < 9) body = dots(k + 1);
  else if (k < 18) body = bamboo(k - 8);
  else if (k < 27) body = glyph(NUMERALS[k - 18]!, INK, 3.9, 4.4) + glyph("萬", RED, 9.2, 4.6);
  else if (k < 31) body = glyph(WIND_CHARS[k - 27]!, INK);
  else if (k === 31) body = glyph("中", RED);
  else if (k === 32) body = glyph("發", GREEN);
  else if (k === 33) body = `<rect x="2" y="2.2" width="6" height="8.6" rx="0.6" fill="none" stroke="${BLUE}" stroke-width="0.7"/><rect x="3.1" y="3.3" width="3.8" height="6.4" rx="0.3" fill="none" stroke="${BLUE}" stroke-width="0.35"/>`;
  else if (k < 38) body = glyph(FLOWER_CHARS[k - 34]!, RED, 7.2) + `<text x="9.2" y="12.2" font-size="1.9" text-anchor="end" fill="${GREEN}" font-family="var(--font)">${k - 33}</text>`;
  else body = glyph(SEASON_CHARS[k - 38]!, GREEN, 7.2) + `<text x="9.2" y="12.2" font-size="1.9" text-anchor="end" fill="${RED}" font-family="var(--font)">${k - 37}</text>`;
  if (labels) body += `<text x="0.7" y="2.1" font-size="2" font-weight="700" fill="${INK}" font-family="var(--font)">${tileCode(k)}</text>`;
  return body;
}
