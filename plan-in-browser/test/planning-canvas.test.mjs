import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";

import { ControlledPlanningRuntime } from "../dist/runtime-process.js";
import { PlanningSessionClient } from "../dist/session.js";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(skillRoot, "canvas.mjs");
const sessionTest = (name, run) => test(name, { timeout: 10_000 }, run);

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "planning-session-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const openedUrls = [];
  const runtime = new ControlledPlanningRuntime();
  const client = new PlanningSessionClient({
    root,
    cwd: workspace,
    runtime,
    openBrowser: (url) => openedUrls.push(url),
  });
  let sessionId;

  return {
    client,
    root,
    workspace,
    openedUrls,
    async start(topic) {
      const started = await client.start(topic);
      sessionId = started.sessionId;
      return started;
    },
    async idleRuntime() {
      await runtime.idle(sessionId);
    },
    hangRuntime() {
      runtime.hang(sessionId);
    },
    async exitRuntime() {
      await runtime.exit(sessionId);
    },
    runtimePid() {
      return runtime.pid(sessionId);
    },
    async cleanUp() {
      if (sessionId) await client.close(sessionId).catch(() => {});
      await rm(root, { recursive: true, force: true });
    },
  };
}

function browserEndpoint(url, path) {
  const browserUrl = new URL(url);
  return {
    url: `${browserUrl.origin}${path}`,
    headers: { "x-planning-canvas-token": browserUrl.searchParams.get("token") },
  };
}

async function postFromBrowser(url, path, body) {
  const endpoint = browserEndpoint(url, path);
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { ...endpoint.headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
}

async function waitForQuestion(url) {
  const endpoint = browserEndpoint(url, "/state");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(endpoint.url, { headers: endpoint.headers });
    const state = await response.json();
    if (state.tree.length > 0) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("question was not published");
}

async function waitForRecoveredBrowser(openedUrls) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (openedUrls.length >= 2) return openedUrls.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("recovered planning session did not open in the browser");
}

function spawnCli(args, env) {
  const child = spawn(process.execPath, [cli, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(stderr || `canvas exited ${code}`));
    });
  });
}

sessionTest("runtime inactivity leaves the planning session open and recoverable", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Release planning");
    await harness.idleRuntime();

    const persisted = JSON.parse(await readFile(join(harness.root, started.sessionId, "state.json"), "utf8"));
    const connection = JSON.parse(await readFile(join(harness.root, started.sessionId, "registry.json"), "utf8"));
    const resumed = await harness.client.resume(started.sessionId);

    assert.equal(persisted.status, "open");
    assert.equal(connection.status, undefined);
    assert.equal(connection.topic, undefined);
    assert.equal(typeof connection.runtimeId, "string");
    assert.deepEqual(
      { topic: resumed.topic, restarted: resumed.restarted },
      { topic: "Release planning", restarted: true },
    );
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("a failed health probe retires the verified writer before replacement", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Takeover planning");
    const originalPid = harness.runtimePid();
    const registryPath = join(harness.root, started.sessionId, "registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    await writeFile(registryPath, JSON.stringify({ ...registry, port: 1 }));

    const resumed = await harness.client.resume(started.sessionId);

    assert.equal(resumed.restarted, true);
    assert.notEqual(harness.runtimePid(), originalPid);
    assert.throws(() => process.kill(originalPid, 0));
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("a verified hung writer is forcibly retired before recovery", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Hung runtime planning");
    const originalPid = harness.runtimePid();
    harness.hangRuntime();

    const resumed = await harness.client.resume(started.sessionId);

    assert.equal(resumed.restarted, true);
    assert.notEqual(harness.runtimePid(), originalPid);
    assert.throws(() => process.kill(originalPid, 0));
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("concurrent recovery establishes one replacement writer", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Concurrent takeover");
    harness.hangRuntime();

    const [first, second] = await Promise.all([
      harness.client.resume(started.sessionId),
      harness.client.resume(started.sessionId),
    ]);

    assert.equal(first.restarted, true);
    assert.equal(second.restarted, true);
    assert.equal(first.url, second.url);
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("an unexpectedly exited runtime recovers the open planning session", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Exit recovery");
    await harness.exitRuntime();

    const resumed = await harness.client.resume(started.sessionId);

    assert.equal(resumed.restarted, true);
    assert.equal(resumed.topic, "Exit recovery");
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("asking after idle recovery delivers the person's answer", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Recovery planning");
    await harness.idleRuntime();
    const question = { id: "ship", question: "Ship now?", answerType: "confirm" };

    const answerPending = harness.client.ask(started.sessionId, question);
    const recoveredUrl = await waitForRecoveredBrowser(harness.openedUrls);
    await waitForQuestion(recoveredUrl);
    await postFromBrowser(recoveredUrl, "/answer", {
      nodeId: question.id,
      selectedOptionIds: ["confirmed"],
      note: "Ready",
    });

    const answer = await answerPending;
    assert.deepEqual(
      {
        type: answer.type,
        questionId: answer.questionId,
        selectedOptionIds: answer.selectedOptionIds,
        note: answer.note,
        restarted: answer.restarted,
      },
      {
        type: "answer",
        questionId: "ship",
        selectedOptionIds: ["confirmed"],
        note: "Ready",
        restarted: true,
      },
    );
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("relative artifact paths resolve from the planning workspace", async () => {
  const harness = await createHarness();
  try {
    const artifactPath = join(harness.workspace, "plan.md");
    const resolvedArtifactPath = join(await realpath(harness.workspace), "plan.md");
    await writeFile(artifactPath, "# Workspace plan\n");
    const started = await harness.start("Workspace planning");

    const registered = await harness.client.artifact(started.sessionId, "plan.md");
    const state = await harness.client.state(started.sessionId);

    assert.deepEqual(registered, { ok: true, id: "artifact-1", path: resolvedArtifactPath });
    assert.deepEqual(
      state.artifacts.map(({ path, displayPath, content }) => ({ path, displayPath, content })),
      [{ path: resolvedArtifactPath, displayPath: "plan.md", content: "# Workspace plan\n" }],
    );
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("registered artifacts survive idle recovery", async () => {
  const harness = await createHarness();
  try {
    const artifactPath = join(harness.root, "plan.md");
    await writeFile(artifactPath, "# Durable plan\n");
    const started = await harness.start("Artifact planning");
    await harness.client.artifact(started.sessionId, artifactPath);
    await harness.idleRuntime();

    const state = await harness.client.state(started.sessionId);

    assert.deepEqual(
      state.artifacts.map(({ path, content }) => ({ path, content })),
      [{ path: artifactPath, content: "# Durable plan\n" }],
    );
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("closure retains planning state and artifacts but removes runtime credentials", async () => {
  const harness = await createHarness();
  try {
    const artifactPath = join(harness.workspace, "final-plan.md");
    await writeFile(artifactPath, "# Final plan\n");
    const started = await harness.start("Completed planning");
    await harness.client.artifact(started.sessionId, artifactPath);
    await harness.idleRuntime();

    await harness.client.close(started.sessionId);

    const persisted = JSON.parse(await readFile(join(harness.root, started.sessionId, "state.json"), "utf8"));
    const terminalState = await harness.client.state(started.sessionId);
    assert.equal(persisted.status, "closed");
    assert.equal(terminalState.status, "closed");
    assert.equal(terminalState.artifacts[0].content, "# Final plan\n");
    await assert.rejects(access(join(harness.root, started.sessionId, "registry.json")));
    await assert.rejects(harness.client.resume(started.sessionId), /closed and cannot be resumed/);

    await harness.client.close(started.sessionId);
    await assert.rejects(access(join(harness.root, started.sessionId, "registry.json")));
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("cancellation remains the planning session outcome after close", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Cancelled planning");
    await postFromBrowser(started.url, "/cancel");

    await harness.client.close(started.sessionId);

    await assert.rejects(harness.client.resume(started.sessionId), /cancelled and cannot be resumed/);
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("an answer is replayed after its delivery process is interrupted", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Replay planning");
    const question = { id: "release", question: "Release?", answerType: "confirm" };
    const answerPending = harness.client.ask(started.sessionId, question);
    await waitForQuestion(started.url);
    await postFromBrowser(started.url, "/answer", {
      nodeId: question.id,
      selectedOptionIds: ["yes"],
      note: "Same decision",
    });
    const first = await answerPending;

    const recoveredClient = new PlanningSessionClient({
      root: harness.root,
      cwd: harness.workspace,
      runtime: new ControlledPlanningRuntime(),
      openBrowser: () => {},
    });
    const replay = await recoveredClient.wait(started.sessionId);
    const editPending = recoveredClient.wait(started.sessionId);
    await postFromBrowser(started.url, "/edit", {
      nodeId: question.id,
      selectedOptionIds: ["later"],
      note: "Revised after replay",
    });
    const edit = await editPending;

    assert.deepEqual(replay, first);
    assert.deepEqual(
      { type: edit.type, selectedOptionIds: edit.selectedOptionIds, note: edit.note },
      { type: "edit", selectedOptionIds: ["later"], note: "Revised after replay" },
    );
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("waiting after an answer delivers only the later edit", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Revision planning");
    const question = { id: "approach", question: "Which approach?", answerType: "single" };
    const answerPending = harness.client.ask(started.sessionId, question);
    await waitForQuestion(started.url);
    await postFromBrowser(started.url, "/answer", { nodeId: question.id, selectedOptionIds: ["simple"] });
    await answerPending;

    const editPending = harness.client.wait(started.sessionId);
    await postFromBrowser(started.url, "/edit", {
      nodeId: question.id,
      selectedOptionIds: ["robust"],
      note: "Changed my mind",
    });

    const edit = await editPending;
    assert.deepEqual(
      {
        type: edit.type,
        questionId: edit.questionId,
        selectedOptionIds: edit.selectedOptionIds,
        note: edit.note,
      },
      {
        type: "edit",
        questionId: "approach",
        selectedOptionIds: ["robust"],
        note: "Changed my mind",
      },
    );
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("an unrelated recorded PID is never terminated", async () => {
  const harness = await createHarness();
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  try {
    const started = await harness.start("Safe takeover");
    await harness.idleRuntime();
    const registryPath = join(harness.root, started.sessionId, "registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    await writeFile(registryPath, JSON.stringify({
      ...registry,
      port: 1,
      pid: unrelated.pid,
      runtimeId: "unrelated-runtime",
    }));

    const resumed = await harness.client.resume(started.sessionId);

    assert.equal(resumed.restarted, true);
    assert.equal(unrelated.exitCode, null);
    process.kill(unrelated.pid, 0);
  } finally {
    unrelated.kill("SIGKILL");
    await new Promise((resolve) => unrelated.once("exit", resolve));
    await harness.cleanUp();
  }
});

sessionTest("unsupported legacy connection records are rejected clearly", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Legacy connection");
    await harness.exitRuntime();
    const registryPath = join(harness.root, started.sessionId, "registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    delete registry.version;
    await writeFile(registryPath, JSON.stringify(registry));

    await assert.rejects(
      harness.client.resume(started.sessionId),
      /unsupported planning canvas connection format/,
    );
  } finally {
    await harness.cleanUp();
  }
});

sessionTest("unsupported legacy persistence is rejected clearly", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-session-legacy-"));
  const sessionId = "legacy-session";
  const dir = join(root, sessionId);
  await mkdir(dir);
  await writeFile(join(dir, "state.json"), JSON.stringify({ topic: "Old", status: "live" }));
  await writeFile(join(dir, "registry.json"), JSON.stringify({ sessionId, token: "old", port: 1, pid: 1 }));
  const client = new PlanningSessionClient({ root, openBrowser: () => {} });
  try {
    await assert.rejects(client.resume(sessionId), /unsupported planning canvas state format/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the shell adapter carries a planning decision through the browser", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-cli-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  let sessionId;

  try {
    const started = spawnSync(process.execPath, [cli, "start", "--topic", "CLI planning"], {
      encoding: "utf8",
      env,
    });
    if (started.status !== 0) throw new Error(started.stderr);
    const session = JSON.parse(started.stdout);
    sessionId = session.sessionId;
    const question = { id: "delivery", question: "How should this ship?", answerType: "single" };

    const answerPending = spawnCli(["ask", "--session", sessionId, "--json", JSON.stringify(question)], env);
    await waitForQuestion(session.url);
    await postFromBrowser(session.url, "/answer", {
      nodeId: question.id,
      selectedOptionIds: ["ci"],
      note: "Required",
    });

    const answer = await answerPending;
    assert.deepEqual(
      {
        type: answer.type,
        questionId: answer.questionId,
        selectedOptionIds: answer.selectedOptionIds,
        note: answer.note,
      },
      {
        type: "answer",
        questionId: "delivery",
        selectedOptionIds: ["ci"],
        note: "Required",
      },
    );

    const editPending = spawnCli(["wait", "--session", sessionId], env);
    await postFromBrowser(session.url, "/edit", {
      nodeId: question.id,
      selectedOptionIds: ["manual"],
      note: "Revised",
    });
    const edit = await editPending;
    assert.equal(edit.type, "edit");
    assert.deepEqual(edit.selectedOptionIds, ["manual"]);
  } finally {
    if (sessionId) spawnSync(process.execPath, [cli, "close", "--session", sessionId], { env });
    await rm(home, { recursive: true, force: true });
  }
});
