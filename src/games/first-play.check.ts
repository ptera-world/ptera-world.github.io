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

/** True if an element matching `sel` is visible and overlaps the board. */
const covers = (page: Page, sel: string) => page.evaluate((s) => {
  const el = document.querySelector<HTMLElement>(s);
  const board = document.querySelector<HTMLElement>(".boardwrap");
  if (!el || !board || el.offsetParent === null) return false;
  const a = el.getBoundingClientRect(), b = board.getBoundingClientRect();
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}, sel);

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
  if (await covers(page, ".w-howto")) fail("the how-to card covers the board");
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

/** Center of the first screen rect of the step `name`'s technique would make now (aimable ones only), or of any aimable technique's. */
async function spotOf(page: Page, name: string | null): Promise<{ name: string; x: number; y: number } | null> {
  return page.evaluate((want) => {
    const g = (globalThis as any).pteraGames, sh = g.shell, s = sh.session;
    for (const t of sh.techniques.list) {
      if (want !== null && t.name !== want) continue;
      if (!g.techniques.aimable(s.def, t)) continue;
      const step = g.techniques.findStep(s.def, t, s.puzzle, s.state);
      const r = step && sh.view?.handle.locate?.(step.focus)?.[0];
      if (r) return { name: t.name, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, name);
}

const stateOf = (page: Page) => page.evaluate(() => JSON.stringify((globalThis as any).pteraGames.shell.session.state));
const armedOf = (page: Page) => page.evaluate(() => (globalThis as any).pteraGames.shell.cast.armed?.name ?? null);

async function clickAt(page: Page, p: { x: number; y: number }, button: "left" | "middle" = "left"): Promise<void> {
  await page.mouse.move(p.x, p.y);
  await page.mouse.move(p.x + 1, p.y);
  await page.mouse.click(p.x, p.y, { button });
  await page.waitForTimeout(150);
}

/**
 * Uses techniques the way the palette offers them: every technique tile the same size and
 * without hover text; pick one that has an instance, click where its step points, expect the board
 * to change, and a second instance to take one more click. Then switch techniques with the pointer
 * on the board: by key, by the picker (key held, pointer moved toward an entry, key let go), and
 * one-handed with the picker on the middle button, back to a mark included.
 */
async function castOnce(page: Page, fail: (what: string) => void): Promise<void> {
  const tiles = page.locator(".w-strip .st-tile.skill");
  if (!(await tiles.first().isVisible())) { fail("has techniques but the palette shows none"); return; }
  const sizes: string[] = await page.evaluate(() => [...new Set([...document.querySelectorAll<HTMLElement>(".w-strip .st-tile")].map((b) => `${Math.round(b.getBoundingClientRect().height)}`))]);
  if (sizes.length !== 1) fail(`palette tiles have different heights: ${sizes.join(", ")}`);
  const colors: number = await page.evaluate(() => new Set([...document.querySelectorAll<HTMLElement>(".w-strip .st-tile.skill")].map((b) => getComputedStyle(b).borderLeftColor)).size);
  const count = await tiles.count();
  if (count > 1 && colors < count) fail(`${count} technique tiles share ${colors} colors`);
  await tiles.first().hover();
  await page.waitForTimeout(700);
  if (await visible(page, ".tip.on")) fail("hovering a palette tile shows hover text");

  const spot = await spotOf(page, null);
  if (!spot) return;
  const tile = page.locator(".w-strip .st-tile.skill", { hasText: spot.name }).first();
  if (!(await tile.isVisible())) { fail(`technique "${spot.name}" isn't in the palette`); return; }
  await tile.click();
  await page.waitForTimeout(150);
  if (await covers(page, ".w-watch")) fail("the technique demo covers the board");
  const before = await stateOf(page);
  await clickAt(page, spot);
  const after = await stateOf(page);
  if (before === after) { fail(`picking "${spot.name}" and clicking where it applies changed nothing`); return; }
  const next = await spotOf(page, spot.name);
  if (next) {
    await clickAt(page, next);
    if ((await stateOf(page)) === after) fail(`a second "${spot.name}" took more than one click`);
  }

  // switching with the pointer staying on the board
  const board = await page.locator(".boardbox").boundingBox();
  if (!board) return;
  const mid = { x: board.x + board.width / 2, y: board.y + board.height / 2 };
  await page.mouse.move(mid.x, mid.y);
  const keyed: { key: string; name: string } | null = await page.evaluate(() => {
    const sh = (globalThis as any).pteraGames.shell;
    for (const t of sh.cast.palette()) {
      if (t.id === sh.cast.armed?.id) continue;
      const k = sh.hub.keysFor(`technique.pick.${t.id}`)[0];
      if (k) return { key: k, name: t.name };
    }
    return null;
  });
  if (keyed) {
    await page.keyboard.press(keyed.key);
    await page.waitForTimeout(80);
    if ((await armedOf(page)) !== keyed.name) fail(`pressing ${keyed.key} with the pointer on the board didn't pick "${keyed.name}"`);
  }
  const pickerKey: string | null = await page.evaluate(() => (globalThis as any).pteraGames.shell.hub.keysFor("shell.skill-picker")[0] ?? null);
  if (!pickerKey) { fail("the technique picker has no key"); return; }
  /** Opens the picker with `down`, moves toward the entry named `name` and lets go with `up`; returns what is picked after. */
  const flick = async (down: () => Promise<void>, up: () => Promise<void>, name: string): Promise<void> => {
    await page.mouse.move(mid.x, mid.y);
    await down();
    await page.waitForTimeout(300);
    const to = await page.evaluate((n) => {
      const b = [...document.querySelectorAll<HTMLElement>(".pk-item")].find((x) => x.textContent?.replace(/^\d/, "").trim() === n);
      const r = b?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, name);
    if (!to) { fail(`the picker has no "${name}"`); await page.keyboard.press("Escape"); return; }
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await up();
    await page.waitForTimeout(80);
  };
  const other: string | null = await page.evaluate(() => {
    const sh = (globalThis as any).pteraGames.shell;
    return sh.cast.palette().find((t: any) => t.id !== sh.cast.armed?.id)?.name ?? null;
  });
  if (other) {
    await flick(() => page.keyboard.down(pickerKey), () => page.keyboard.up(pickerKey), other);
    if ((await armedOf(page)) !== other) fail(`holding ${pickerKey}, moving toward "${other}" and letting go didn't pick it`);
  }

  // one-handed: the picker on the middle button, a mark picked from it too
  await page.evaluate(() => {
    const store = (globalThis as any).pteraGames.shell.hub.settings.store;
    store.save({ ...store.getOverrides(), "shell.skill-picker": { mouse: ["middle", "middle:up"] } });
  });
  await page.waitForTimeout(100);
  const target: string | null = await page.evaluate(() => {
    const sh = (globalThis as any).pteraGames.shell;
    return sh.cast.palette().find((t: any) => t.id !== sh.cast.armed?.id)?.name ?? null;
  });
  const beforeMiddle = await stateOf(page);
  if (target) {
    await flick(() => page.mouse.down({ button: "middle" }), () => page.mouse.up({ button: "middle" }), target);
    if ((await armedOf(page)) !== target) fail(`middle-button picker didn't pick "${target}"`);
    if ((await stateOf(page)) !== beforeMiddle) fail("opening the picker with the middle button also changed the board");
  }
  const mark: string | null = await page.evaluate(() => (globalThis as any).pteraGames.shell.cast.marks()[0]?.label ?? null);
  if (mark) {
    await flick(() => page.mouse.down({ button: "middle" }), () => page.mouse.up({ button: "middle" }), mark);
    if ((await armedOf(page)) !== null) fail(`middle-button picker didn't go back to the "${mark}" mark`);
  }
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
