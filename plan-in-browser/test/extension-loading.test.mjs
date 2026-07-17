import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadExtensions } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the planning canvas extension loads through its auto-discovery symlink", async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-extension-"));
  const extensions = join(home, ".pi", "agent", "extensions");
  const installed = join(extensions, "planning-canvas");

  try {
    await mkdir(extensions, { recursive: true });
    await symlink(skillRoot, installed, "dir");

    const result = await loadExtensions([join(installed, "index.ts")], skillRoot);

    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
