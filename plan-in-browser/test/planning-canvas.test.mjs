import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const openedUrls = [];
  const runtime = new ControlledPlanningRuntime();
  const client = new PlanningSessionClient({ root, runtime, openBrowser: (url) => openedUrls.push(url) });
  let sessionId;

  return {
    client,
    root,
    openedUrls,
    async start(topic) {
      const started = await client.start(topic);
      sessionId = started.sessionId;
      return started;
    },
    async idleRuntime() {
      await runtime.idle(sessionId);
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

sessionTest("an idle planning session resumes with its topic", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Release planning");
    await harness.idleRuntime();

    const resumed = await harness.client.resume(started.sessionId);

    assert.deepEqual(
      { topic: resumed.topic, restarted: resumed.restarted },
      { topic: "Release planning", restarted: true },
    );
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

sessionTest("a closed planning session cannot recover", async () => {
  const harness = await createHarness();
  try {
    const started = await harness.start("Completed planning");
    await harness.idleRuntime();

    await harness.client.close(started.sessionId);

    await assert.rejects(harness.client.resume(started.sessionId), /closed and cannot be resumed/);
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
  } finally {
    if (sessionId) spawnSync(process.execPath, [cli, "close", "--session", sessionId], { env });
    await rm(home, { recursive: true, force: true });
  }
});
