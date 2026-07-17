import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { ArtifactTracker } from "../dist/artifact-tracker.js";

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "artifact-tracker-"));
  const sessionDir = join(root, "session");
  return {
    root,
    sessionDir,
    tracker: new ArtifactTracker({ sessionDir, cwd: root }),
    async cleanUp() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("registered planning artifacts recover from the tracker store", async () => {
  const harness = await createHarness();
  try {
    const path = join(harness.root, "durable.md");
    await writeFile(path, "# Durable plan\n");
    harness.tracker.register({ path });

    const recovered = new ArtifactTracker({ sessionDir: harness.sessionDir, cwd: harness.root });

    assert.deepEqual(
      recovered.snapshot().map(({ path: artifactPath, content, revision }) => ({ path: artifactPath, content, revision })),
      [{ path, content: "# Durable plan\n", revision: 1 }],
    );
  } finally {
    await harness.cleanUp();
  }
});

test("a tracked planning artifact includes its changes from HEAD", async () => {
  const harness = await createHarness();
  try {
    const path = join(harness.root, "plan.md");
    spawnSync("git", ["init", "-q", harness.root]);
    spawnSync("git", ["-C", harness.root, "config", "user.email", "test@example.com"]);
    spawnSync("git", ["-C", harness.root, "config", "user.name", "Test"]);
    await writeFile(path, "first\nsecond\n");
    spawnSync("git", ["-C", harness.root, "add", "plan.md"]);
    spawnSync("git", ["-C", harness.root, "commit", "-qm", "initial"]);
    await writeFile(path, "first\nchanged\nadded\n");

    harness.tracker.register({ path });
    const [artifact] = harness.tracker.snapshot();

    assert.deepEqual(
      { additions: artifact.diff?.additions, deletions: artifact.diff?.deletions, against: artifact.diff?.against },
      { additions: 2, deletions: 1, against: "HEAD" },
    );
    assert.match(artifact.diff?.text || "", /^diff --git a\/plan\.md b\/plan\.md/m);
  } finally {
    await harness.cleanUp();
  }
});

test("snapshot refreshes a planning artifact after its file changes", async () => {
  const harness = await createHarness();
  try {
    const path = join(harness.root, "changing.md");
    await writeFile(path, "draft\n");
    harness.tracker.register({ path });

    await writeFile(path, "ready\n");
    const [artifact] = harness.tracker.snapshot();

    assert.deepEqual(
      { content: artifact.content, revision: artifact.revision },
      { content: "ready\n", revision: 2 },
    );
  } finally {
    await harness.cleanUp();
  }
});

test("registering a planning artifact exposes its current content", async () => {
  const harness = await createHarness();
  try {
    const path = join(harness.root, "plan.md");
    await writeFile(path, "# Release plan\n");

    const registered = harness.tracker.register({ path: "plan.md", title: "Release plan" });
    const artifacts = harness.tracker.snapshot();

    assert.deepEqual(registered, { id: "artifact-1", path });
    assert.deepEqual(artifacts, [{
      id: "artifact-1",
      path,
      displayPath: "plan.md",
      title: "Release plan",
      revision: 1,
      content: "# Release plan\n",
    }]);
  } finally {
    await harness.cleanUp();
  }
});
