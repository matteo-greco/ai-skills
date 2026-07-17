import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the planning canvas extension is discovered through its installation symlink", async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-extension-"));
  const agentDir = join(home, ".pi", "agent");
  const extensions = join(agentDir, "extensions");
  const installed = join(extensions, "planning-canvas");

  try {
    await mkdir(extensions, { recursive: true });
    await symlink(skillRoot, installed, "dir");
    const loader = new DefaultResourceLoader({ cwd: home, agentDir });

    await loader.reload();
    const result = loader.getExtensions();

    assert.deepEqual(
      { errors: result.errors, extensionCount: result.extensions.length },
      { errors: [], extensionCount: 1 },
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
