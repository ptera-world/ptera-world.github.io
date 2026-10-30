import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildManifest } from "./manifest";
import { aheadAllowed, isMedia, keyForFile, keysForPath } from "./routes";

test("a directory's index.html is keyed by the directory URL", () => {
  expect(keyForFile("index.html")).toBe("/");
  expect(keyForFile("prose/index.html")).toBe("/prose/");
  expect(keyForFile("prose/but/index.html")).toBe("/prose/but/");
  expect(keyForFile("404.html")).toBe("/404.html");
  expect(keyForFile("games/main.js")).toBe("/games/main.js");
});

test("a bare directory path also matches the directory", () => {
  expect(keysForPath("/prose/but")).toEqual(["/prose/but", "/prose/but/"]);
  expect(keysForPath("/prose/")).toEqual(["/prose/"]);
});

test("each file has its own hash; the version changes with any of them and ignores excluded ones", async () => {
  const root = mkdtempSync(join(tmpdir(), "sw-"));
  mkdirSync(join(root, "a"));
  writeFileSync(join(root, "index.html"), "x");
  writeFileSync(join(root, "a", "f.js"), "1");
  writeFileSync(join(root, "sw.js"), "worker");
  const exclude = new Set(["/sw.js"]);
  const v1 = await buildManifest(root, { exclude });
  expect(Object.keys(v1.files)).toEqual(["/", "/a/f.js"]);
  writeFileSync(join(root, "sw.js"), "worker2");
  expect((await buildManifest(root, { exclude })).version).toBe(v1.version);
  writeFileSync(join(root, "a", "f.js"), "2");
  const v2 = await buildManifest(root, { exclude });
  expect(v2.version).not.toBe(v1.version);
  expect(v2.files["/"]).toBe(v1.files["/"]);
  expect(v2.files["/a/f.js"]).not.toBe(v1.files["/a/f.js"]);
});

test("media: only cross-origin cors GETs for images, sound and video", () => {
  const o = "https://ptera.world";
  const req = (p: Partial<{ method: string; mode: string; destination: string; url: string }>) =>
    ({ method: "GET", mode: "cors", destination: "image", url: "https://raw.githubusercontent.com/a.png", ...p });
  expect(isMedia(req({}), o)).toBe(true);
  expect(isMedia(req({ destination: "audio" }), o)).toBe(true);
  expect(isMedia(req({ mode: "no-cors" }), o)).toBe(false);
  expect(isMedia(req({ destination: "script" }), o)).toBe(false);
  expect(isMedia(req({ method: "POST" }), o)).toBe(false);
  expect(isMedia(req({ url: "https://ptera.world/a.png" }), o)).toBe(false);
});

test("downloading ahead: wifi means a connection the browser says is wifi, and never with save-data", () => {
  expect(aheadAllowed("off", { type: "wifi" })).toBe(false);
  expect(aheadAllowed("always", { type: "cellular", saveData: true })).toBe(true);
  expect(aheadAllowed("wifi", { type: "wifi" })).toBe(true);
  expect(aheadAllowed("wifi", { type: "ethernet" })).toBe(true);
  expect(aheadAllowed("wifi", { type: "cellular" })).toBe(false);
  expect(aheadAllowed("wifi", { type: "wifi", saveData: true })).toBe(false);
  // safari, firefox and desktop chrome say nothing: not wifi
  expect(aheadAllowed("wifi", undefined)).toBe(false);
  expect(aheadAllowed("wifi", {})).toBe(false);
});
