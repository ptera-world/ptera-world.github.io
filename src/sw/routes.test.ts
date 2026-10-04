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

test("the version changes with any listed file and ignores excluded ones", () => {
  const root = mkdtempSync(join(tmpdir(), "sw-"));
  mkdirSync(join(root, "a"));
  writeFileSync(join(root, "index.html"), "x");
  writeFileSync(join(root, "a", "f.js"), "1");
  writeFileSync(join(root, "sw.js"), "worker");
  const exclude = new Set(["/sw.js"]);
  const v1 = buildManifest(root, { exclude });
  expect(v1.files).toEqual(["/", "/a/f.js"]);
  writeFileSync(join(root, "sw.js"), "worker2");
  expect(buildManifest(root, { exclude }).version).toBe(v1.version);
  writeFileSync(join(root, "a", "f.js"), "2");
  expect(buildManifest(root, { exclude }).version).not.toBe(v1.version);
});
