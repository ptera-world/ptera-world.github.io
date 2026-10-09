import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildManifest } from "./manifest";
import { keyForFile, keysForPath } from "./routes";

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
