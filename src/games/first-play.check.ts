/**
 * Plays every puzzle as a first-time player would: a fresh browser profile, default settings, and
 * only what is on screen. For each puzzle it checks that the core actions can be found and used
 * from visible controls (the board, buttons, the board menu button, the how-to card), and lists
 * every command that nothing on screen leads to.
 *
 * Runs a dev server and a headless Chrome (CHROME, else google-chrome-stable / chromium on PATH).
 * Exits non-zero when anything is unreachable. Usage: bun run check:first-play [puzzle ids…]
 */
import { chromium, type Page } from "playwright-core";

const port = 3900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}/games/`;
const chrome = process.env.CHROME ?? Bun.which("google-chrome-stable") ?? Bun.which("chromium") ?? Bun.which("chromium-browser");
if (!chrome) throw new Error("no Chrome found: set CHROME to a Chrome or Chromium binary");

const server = Bun.spawn(["bun", "run", "src/cli.ts", "dev", "--port", String(port)], { stdout: "ignore", stderr: "ignore" });
const browser = await chromium.launch({ executablePath: chrome });
const failures: string[] = [];

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch { /* not up yet */ }
    await Bun.sleep(500);
  }
  throw new Error("dev server didn't start");
}

/** True if an element matching `sel` is on screen and not hidden. */
const visible = (page: Page, sel: string) => page.locator(sel).first().isVisible().catch(() => false);

async function check(page: Page, id: string, name: string): Promise<void> {
  const fail = (what: string) => failures.push(`${id}: ${what}`);
  await page.goto(base);
  await page.waitForSelector(".index .card", { timeout: 60_000 });
  const card = page.locator(".index .card").filter({ has: page.locator("strong", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) }).first();
  if (!(await card.isVisible())) { fail("not on the game list"); return; }
  await card.click();
  await page.waitForFunction((pid) => (globalThis as any).pteraGames?.shell?.session?.def.id === pid, id, { timeout: 90_000 });
  await page.waitForTimeout(400);

  if (!(await visible(page, ".boardbox .view svg, .boardbox .view canvas, .boardbox .view [class]"))) fail("no board on screen");
  if (!(await visible(page, ".w-howto"))) fail("nothing on screen says how to play on first open");
  const play = page.locator(".w-howto button", { hasText: /^play$/ }).first();
  if (await play.isVisible()) await play.click();
  else fail("the how-to card has no visible way to start playing");
  for (const [cmd, what] of [["shell.hint", "hint"], ["shell.undo", "undo"], ["shell.new", "new game"]] as const) {
    if (!(await visible(page, `[data-command="${cmd}"]`))) fail(`no visible ${what} button`);
  }
  if (!(await visible(page, ".board-menu-btn"))) fail("no visible way into the board menu");

  // a command counts as on screen when a visible control runs it, here or in any panel tab (tabs are visible and named)
  const seen = new Set<string>();
  const collect = async () => { for (const id of await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-command]")].filter((el) => el.offsetParent !== null).map((el) => el.dataset.command!))) seen.add(id); };
  await collect();
  for (const tab of await page.locator(".tabs button[role=tab]").all()) { await tab.click(); await page.waitForTimeout(50); await collect(); }
  const missing: string[] = await page.evaluate((onScreen) => {
    const sh = (globalThis as any).pteraGames.shell;
    const shown = (sel: string) => onScreen.some((id) => sel === `[data-command="${CSS.escape(id)}"]`);
    const ctx = sh.hub.context();
    return sh.hub.all()
      .filter((c: any) => !c.hidden && (!c.when || c.when(ctx)))
      .filter((c: any) => !c.mouse?.length)
      .filter((c: any) => !/^(technique|widget|toggle|fx)\./.test(c.id) && !c.id.startsWith("shell.preset-"))
      .filter((c: any) => !/(^|[.-])(left|right|up|down|cursor|home|end|next|prev|select-all|deselect|mode-next)([.-]|$)/.test(c.id))
      .filter((c: any) => ![c.menu].flat().includes("board"))
      .filter((c: any) => !shown(`[data-command="${CSS.escape(c.id)}"]`))
      .map((c: any) => `${c.id} (${c.label})`);
  }, [...seen]);
  for (const m of missing) fail(`only reachable by key or palette: ${m}`);

  const techniques: number = await page.evaluate(() => (globalThis as any).pteraGames.shell.techniques?.list.length ?? 0);
  if (techniques) await castOnce(page, fail);
}

/**
 * Uses a technique the way the strip offers it: open "skills", pick one that has an instance,
 * click where its step points, and expect the board to change.
 */
async function castOnce(page: Page, fail: (what: string) => void): Promise<void> {
  const skills = page.locator(".w-strip .st-tile", { hasText: "skills" }).first();
  if (!(await skills.isVisible())) { fail("has techniques but nothing on screen leads to them"); return; }
  const spot: { name: string; x: number; y: number } | null = await page.evaluate(() => {
    const g = (globalThis as any).pteraGames, sh = g.shell, s = sh.session;
    for (const t of sh.techniques.list) {
      if (!g.techniques.aimable(s.def, t)) continue;
      const step = g.techniques.findStep(s.def, t, s.puzzle, s.state);
      const r = step && sh.view?.handle.locate?.(step.focus)?.[0];
      if (r) return { name: t.name, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  if (!spot) return;
  await skills.click();
  const tile = page.locator(".w-strip .st-tile", { hasText: spot.name }).first();
  if (!(await tile.isVisible())) { fail(`technique "${spot.name}" isn't on the strip`); return; }
  await tile.click();
  const before = await page.evaluate(() => JSON.stringify((globalThis as any).pteraGames.shell.session.state));
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.move(spot.x + 1, spot.y);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => JSON.stringify((globalThis as any).pteraGames.shell.session.state));
  if (before === after) fail(`picking "${spot.name}" and clicking where it applies changed nothing`);
}

try {
  await waitForServer();
  const page = await (await browser.newContext()).newPage();
  await page.goto(base);
  await page.waitForSelector(".index .card");
  const all: { id: string; name: string }[] = await page.evaluate(() => (globalThis as any).pteraGames.registry.listPuzzles().map((d: any) => ({ id: d.id, name: d.name })));
  const only = process.argv.slice(2);
  for (const p of all.filter((x) => !only.length || only.includes(x.id))) {
    const fresh = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    try {
      await check(fresh, p.id, p.name);
    } catch (e) {
      failures.push(`${p.id}: ${e instanceof Error ? e.message : e}`);
    }
    await fresh.context().close();
  }
} finally {
  await browser.close();
  server.kill();
}

for (const f of failures) console.log(f);
console.log(failures.length ? `${failures.length} problems` : "every puzzle's core actions are on screen");
process.exit(failures.length ? 1 : 0);
