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

// Zero

test("a new artifact tracker has no planning artifacts", async () => {
  const harness = await createHarness();
  try {
    assert.deepEqual(harness.tracker.snapshot(), []);
  } finally {
    await harness.cleanUp();
  }
});

test("a zero-byte planning artifact is valid text", async () => {
  const harness = await createHarness();
  try {
    const path = join(harness.root, "empty.md");
    await writeFile(path, "");

    harness.tracker.register({ path });

    assert.deepEqual(
      harness.tracker.snapshot().map(({ content, error, revision }) => ({ content, error, revision })),
      [{ content: "", error: undefined, revision: 1 }],
    );
  } finally {
    await harness.cleanUp();
  }
});

// One

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

// Many

test("registering the same path updates one stable planning artifact", async () => {
  const harness = await createHarness();
  try {
    const path = join(harness.root, "plan.md");
    await writeFile(path, "# Plan\n");

    const first = harness.tracker.register({ path: "plan.md", title: "Draft" });
    const second = harness.tracker.register({ path, title: "Final" });

    assert.deepEqual(second, first);
    assert.deepEqual(
      harness.tracker.snapshot().map(({ id, title, revision }) => ({ id, title, revision })),
      [{ id: "artifact-1", title: "Final", revision: 1 }],
    );
  } finally {
    await harness.cleanUp();
  }
});

test("multiple planning artifacts refresh independently and recover together", async () => {
  const harness = await createHarness();
  try {
    const firstPath = join(harness.root, "first.md");
    const secondPath = join(harness.root, "second.md");
    await writeFile(firstPath, "first draft\n");
    await writeFile(secondPath, "second draft\n");
    harness.tracker.register({ path: firstPath });
    harness.tracker.register({ path: secondPath });

    await writeFile(firstPath, "first ready\n");
    const refreshed = harness.tracker.snapshot();

    assert.deepEqual(
      refreshed.map(({ id, content, revision }) => ({ id, content, revision })),
      [
        { id: "artifact-1", content: "first ready\n", revision: 2 },
        { id: "artifact-2", content: "second draft\n", revision: 1 },
      ],
    );

    const recovered = new ArtifactTracker({ sessionDir: harness.sessionDir, cwd: harness.root });
    assert.deepEqual(
      recovered.snapshot().map(({ id, content, revision }) => ({ id, content, revision })),
      refreshed.map(({ id, content, revision }) => ({ id, content, revision })),
    );
  } finally {
    await harness.cleanUp();
  }
});

// Boundaries

test("unchanged snapshots preserve the planning artifact revision", async () => {
  const harness = await createHarness();
  try {
    const path = join(harness.root, "stable.md");
    await writeFile(path, "stable\n");
    harness.tracker.register({ path });

    const first = harness.tracker.snapshot();
    const second = harness.tracker.snapshot();

    assert.equal(first[0].revision, 1);
    assert.equal(second[0].revision, 1);
  } finally {
    await harness.cleanUp();
  }
});

// Interfaces

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

// Exceptions

test("a missing planning artifact recovers when its file is created", async () => {
  const harness = await createHarness();
  try {
    const path = join(harness.root, "eventual.md");
    harness.tracker.register({ path });
    const [missing] = harness.tracker.snapshot();
    assert.match(missing.error || "", /ENOENT/);
    assert.equal(missing.revision, 1);

    await writeFile(path, "# Now available\n");
    const [available] = harness.tracker.snapshot();

    assert.deepEqual(
      { content: available.content, error: available.error, revision: available.revision },
      { content: "# Now available\n", error: undefined, revision: 2 },
    );
  } finally {
    await harness.cleanUp();
  }
});

// Simple scenarios

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
