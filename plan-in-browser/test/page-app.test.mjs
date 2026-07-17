import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the planning page loads vendored scripts without inline JavaScript", async () => {
  const html = await readFile(join(skillRoot, "page", "index.html"), "utf8");

  assert.match(html, /<script src="\/assets\/highlight\.min\.js"><\/script>/);
  assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>/);
});
