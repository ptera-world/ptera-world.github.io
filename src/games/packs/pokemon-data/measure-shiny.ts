/**
 * Measures how different each pokémon's shiny sprite looks from its normal one and writes
 * shiny-diff.json: the shiny media's difference (see Media.difference), which odd-one-out picks its rounds by (the difference has to be known when a
 * puzzle is generated, which is deterministic and offline, so it can't be measured then).
 *
 * The sprites are decoded and compared in headless Chrome, so the pixels are the ones players see.
 * Nothing but the numbers is kept. Run: `bun run src/games/packs/pokemon-data/measure-shiny.ts`
 * (CHROME, else google-chrome-stable / chromium on PATH; needs network).
 *
 * The number: over every pixel either sprite draws, the mean CIE76 colour difference (ΔE in Lab,
 * a transparent pixel counting as white), so a large area changed a little and a small area
 * changed a lot both count, roughly as much as the eye notices them.
 */
import { chromium } from "playwright-core";
import { writeFileSync } from "fs";
import { decode, type PokemonDataFile } from "../../lib/pokemon/codec";
import { mediaUrl } from "../../lib/pokemon/media";

const file = (await Bun.file(new URL("./data.json", import.meta.url)).json()) as PokemonDataFile;
const items = decode(file).filter((i) => i.media.includes("sprite") && i.media.includes("shiny"));
const chrome = process.env.CHROME ?? Bun.which("google-chrome-stable") ?? Bun.which("chromium") ?? Bun.which("chromium-browser");
if (!chrome) throw new Error("no Chrome found: set CHROME to a Chrome or Chromium binary");

const browser = await chromium.launch({ executablePath: chrome });
const page = await browser.newPage();
await page.goto("about:blank");
await page.evaluate(() => {
  const lab = (r: number, g: number, b: number): [number, number, number] => {
    const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const R = lin(r), G = lin(g), B = lin(b);
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const pixels = async (url: string) => {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  };
  (globalThis as any).measure = async (a: string, b: string) => {
    const [p, q] = await Promise.all([pixels(a), pixels(b)]);
    if (p.width !== q.width || p.height !== q.height) return { diff: null, why: "sizes differ" };
    let sum = 0, n = 0;
    const px = (d: Uint8ClampedArray, i: number) => {
      const al = d[i + 3]! / 255;
      return lab(d[i]! * al + 255 * (1 - al), d[i + 1]! * al + 255 * (1 - al), d[i + 2]! * al + 255 * (1 - al));
    };
    for (let i = 0; i < p.data.length; i += 4) {
      if (p.data[i + 3]! < 16 && q.data[i + 3]! < 16) continue;
      const x = px(p.data, i), y = px(q.data, i);
      sum += Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
      n++;
    }
    return { diff: n ? sum / n : 0 };
  };
});

const out: Record<string, number> = {};
const failed: string[] = [];
let done = 0;
const queue = items.slice();
await Promise.all(Array.from({ length: 12 }, async () => {
  for (let it = queue.shift(); it; it = queue.shift()) {
    const r = await page.evaluate(([a, b]) => (globalThis as any).measure(a, b), [mediaUrl(it, "sprite")!, mediaUrl(it, "shiny")!] as const).catch((e: Error) => ({ diff: null, why: e.message }));
    if (typeof r.diff === "number") out[it.id] = Math.round(r.diff * 10) / 10;
    else failed.push(`${it.id}: ${(r as { why?: string }).why}`);
    if (++done % 100 === 0) console.log(`${done}/${items.length}`);
  }
}));
await browser.close();

const sorted = Object.fromEntries(items.filter((i) => i.id in out).map((i) => [i.id, out[i.id]!]));
writeFileSync(new URL("./shiny-diff.json", import.meta.url), JSON.stringify({ dataset: file.version, diff: sorted }) + "\n");
console.log(`measured ${Object.keys(sorted).length}, failed ${failed.length}`);
for (const f of failed) console.log(`  ${f}`);
