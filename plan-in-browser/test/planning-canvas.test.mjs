import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(skillRoot, "canvas.mjs");

function runCli(args, env) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function spawnCli(args, env) {
  const child = spawn(process.execPath, [cli, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return {
    child,
    completed: new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(JSON.parse(stdout));
        else reject(new Error(stderr || `canvas exited ${code}`));
      });
    }),
  };
}

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${pid} did not exit`);
}

async function waitForReplacementRegistry(file, previousPid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const registry = JSON.parse(await readFile(file, "utf8"));
      if (registry.pid !== previousPid) return registry;
    } catch {
      // Atomic registry replacement can briefly hide the file.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("replacement runtime was not registered");
}

async function waitForQuestion(url, token) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${url}state`, { headers: { "x-planning-canvas-token": token } });
    const state = await response.json();
    if (state.tree.length > 0) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("question was not published");
}

test("a state request recovers a crashed planning session", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-recovery-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  let sessionId;

  try {
    const started = runCli(["start", "--topic", "Recovery test"], env);
    sessionId = started.sessionId;
    const registryFile = join(home, sessionId, "registry.json");
    const original = JSON.parse(await readFile(registryFile, "utf8"));
    process.kill(original.pid, "SIGKILL");
    await waitForExit(original.pid);

    const state = runCli(["state", "--session", sessionId], env);
    const recovered = JSON.parse(await readFile(registryFile, "utf8"));

    assert.equal(state.status, "live");
    assert.notEqual(recovered.pid, original.pid);
  } finally {
    if (sessionId) runCli(["close", "--session", sessionId], env);
    await rm(home, { recursive: true, force: true });
  }
});

test("closing a crashed planning session prevents recovery", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-closed-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  let sessionId;

  try {
    const started = runCli(["start", "--topic", "Closed test"], env);
    sessionId = started.sessionId;
    const registryFile = join(home, sessionId, "registry.json");
    const registry = JSON.parse(await readFile(registryFile, "utf8"));
    process.kill(registry.pid, "SIGKILL");
    await waitForExit(registry.pid);
    runCli(["close", "--session", sessionId], env);

    const state = spawnSync(process.execPath, [cli, "state", "--session", sessionId], {
      encoding: "utf8",
      env,
    });
    const closedRegistry = JSON.parse(await readFile(registryFile, "utf8"));
    const closedState = JSON.parse(await readFile(join(home, sessionId, "state.json"), "utf8"));

    assert.notEqual(state.status, 0);
    assert.match(state.stderr, /closed/);
    assert.notEqual(closedRegistry.pid, registry.pid);
    assert.equal(closedState.status, "closed");
  } finally {
    if (sessionId) spawnSync(process.execPath, [cli, "close", "--session", sessionId], { env });
    await rm(home, { recursive: true, force: true });
  }
});

test("recovers the pre-refactor persisted session format", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-legacy-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  const sessionId = "pc-legacy-fixture";
  const directory = join(home, sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "state.json"),
    JSON.stringify({
      sessionId,
      topic: "Legacy planning",
      status: "idle",
      nodes: [],
      artifacts: [],
      events: [],
      seq: 0,
      cwd: home,
    }),
  );
  await writeFile(
    join(directory, "registry.json"),
    JSON.stringify({
      sessionId,
      topic: "Legacy planning",
      token: "legacy-token",
      port: 1,
      pid: 999999,
      cursor: 0,
      status: "idle",
    }),
  );

  try {
    const state = runCli(["state", "--session", sessionId], env);
    assert.equal(state.topic, "Legacy planning");
    assert.equal(state.status, "live");
  } finally {
    runCli(["close", "--session", sessionId], env);
    await rm(home, { recursive: true, force: true });
  }
});

test("cancellation remains the durable outcome after close", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-cancelled-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  let sessionId;

  try {
    const started = runCli(["start", "--topic", "Cancellation test"], env);
    sessionId = started.sessionId;
    const browserUrl = new URL(started.url);
    const cancelled = await fetch(`${browserUrl.origin}/cancel`, {
      method: "POST",
      headers: { "x-planning-canvas-token": browserUrl.searchParams.get("token") },
    });
    assert.equal(cancelled.status, 200);
    runCli(["close", "--session", sessionId], env);

    const state = JSON.parse(await readFile(join(home, sessionId, "state.json"), "utf8"));
    const registry = JSON.parse(await readFile(join(home, sessionId, "registry.json"), "utf8"));
    assert.equal(state.status, "cancelled");
    assert.equal(registry.status, "closed");
  } finally {
    if (sessionId) spawnSync(process.execPath, [cli, "close", "--session", sessionId], { env });
    await rm(home, { recursive: true, force: true });
  }
});

test("an ordinary operation recovers an idle planning session", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-idle-"));
  const env = {
    ...process.env,
    PLANNING_CANVAS_HOME: home,
    PLANNING_CANVAS_NO_OPEN: "1",
    PLANNING_CANVAS_IDLE_MS: "150",
  };
  let sessionId;

  try {
    const started = runCli(["start", "--topic", "Idle recovery"], env);
    sessionId = started.sessionId;
    const registryFile = join(home, sessionId, "registry.json");
    const original = JSON.parse(await readFile(registryFile, "utf8"));
    await waitForExit(original.pid);

    const state = runCli(["state", "--session", sessionId], env);
    const recovered = JSON.parse(await readFile(registryFile, "utf8"));
    assert.equal(state.status, "live");
    assert.notEqual(recovered.pid, original.pid);
  } finally {
    if (sessionId) runCli(["close", "--session", sessionId], env);
    await rm(home, { recursive: true, force: true });
  }
});

test("artifacts remain registered across runtime recovery", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-artifact-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  const artifactPath = join(home, "plan.md");
  await writeFile(artifactPath, "# Durable plan\n");
  let sessionId;

  try {
    const started = runCli(["start", "--topic", "Artifact recovery"], env);
    sessionId = started.sessionId;
    runCli(["artifact", "--session", sessionId, "--path", artifactPath], env);
    const registryFile = join(home, sessionId, "registry.json");
    const original = JSON.parse(await readFile(registryFile, "utf8"));
    process.kill(original.pid, "SIGKILL");
    await waitForExit(original.pid);

    const state = runCli(["state", "--session", sessionId], env);
    assert.equal(state.artifacts.length, 1);
    assert.equal(state.artifacts[0].path, artifactPath);
    assert.equal(state.artifacts[0].content, "# Durable plan\n");
  } finally {
    if (sessionId) runCli(["close", "--session", sessionId], env);
    await rm(home, { recursive: true, force: true });
  }
});

test("asking a question recovers a crashed planning session", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-ask-recovery-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  let sessionId;

  try {
    const started = runCli(["start", "--topic", "Ask recovery test"], env);
    sessionId = started.sessionId;
    const registryFile = join(home, sessionId, "registry.json");
    const original = JSON.parse(await readFile(registryFile, "utf8"));
    process.kill(original.pid, "SIGKILL");
    await waitForExit(original.pid);

    const question = { id: "recovered", question: "Did recovery work?", answerType: "confirm" };
    const asking = spawnCli(["ask", "--session", sessionId, "--json", JSON.stringify(question)], env);
    const completion = asking.completed.then(
      (event) => ({ event }),
      (error) => ({ error }),
    );
    const recovered = await waitForReplacementRegistry(registryFile, original.pid);
    const baseUrl = `http://127.0.0.1:${recovered.port}/`;
    await waitForQuestion(baseUrl, recovered.token);

    await fetch(`${baseUrl}answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-planning-canvas-token": recovered.token },
      body: JSON.stringify({ nodeId: question.id, selectedOptionIds: ["confirmed"] }),
    });
    const result = await completion;
    if (result.error) throw result.error;
    assert.equal(result.event.questionId, question.id);
    assert.equal(result.event.restarted, true);
    assert.match(result.event.url, new RegExp(`:${recovered.port}/`));
  } finally {
    if (sessionId) runCli(["close", "--session", sessionId], env);
    await rm(home, { recursive: true, force: true });
  }
});

test("the single agent cursor does not replay delivered events", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-cursor-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  let sessionId;

  try {
    const started = runCli(["start", "--topic", "Cursor test"], env);
    sessionId = started.sessionId;
    const browserUrl = new URL(started.url);
    const token = browserUrl.searchParams.get("token");
    const baseUrl = `${browserUrl.origin}/`;
    const question = { id: "cursor", question: "First delivery?", answerType: "confirm" };
    const asking = spawnCli(["ask", "--session", sessionId, "--json", JSON.stringify(question)], env);
    await waitForQuestion(baseUrl, token);
    await fetch(`${baseUrl}answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-planning-canvas-token": token },
      body: JSON.stringify({ nodeId: question.id, selectedOptionIds: ["confirmed"] }),
    });
    assert.equal((await asking.completed).seq, 1);

    const waiting = spawnCli(["wait", "--session", sessionId], env);
    await fetch(`${baseUrl}edit`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-planning-canvas-token": token },
      body: JSON.stringify({ nodeId: question.id, selectedOptionIds: ["confirmed"], note: "revised" }),
    });
    const revised = await waiting.completed;
    assert.equal(revised.type, "edit");
    assert.equal(revised.seq, 2);
  } finally {
    if (sessionId) runCli(["close", "--session", sessionId], env);
    await rm(home, { recursive: true, force: true });
  }
});

test("runs a canvas question through the HTTP server", { timeout: 10_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "planning-canvas-"));
  const env = { ...process.env, PLANNING_CANVAS_HOME: home, PLANNING_CANVAS_NO_OPEN: "1" };
  let sessionId;

  try {
    const started = runCli(["start", "--topic", "Test planning"], env);
    sessionId = started.sessionId;
    const browserUrl = new URL(started.url);
    const token = browserUrl.searchParams.get("token");
    const baseUrl = `${browserUrl.origin}/`;

    const page = await fetch(started.url);
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.headers.get("content-security-policy"), /script-src[^;]*unsafe-inline/);
    assert.match(await page.text(), /<script src="\/assets\/app\.js"><\/script>/);
    const app = await fetch(`${baseUrl}assets/app.js`);
    assert.equal(app.status, 200);
    assert.match(app.headers.get("content-type"), /^text\/javascript/);

    const question = {
      id: "delivery",
      question: "How should this ship?",
      answerType: "single",
      options: [{ id: "ci", label: "In CI" }],
    };
    const asking = spawnCli(
      ["ask", "--session", sessionId, "--json", JSON.stringify(question)],
      env,
    );
    const state = await waitForQuestion(baseUrl, token);
    assert.equal(state.tree[0].question, question.question);

    const answer = await fetch(`${baseUrl}answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-planning-canvas-token": token },
      body: JSON.stringify({ nodeId: question.id, selectedOptionIds: ["ci"], note: "Required" }),
    });
    assert.equal(answer.status, 200);
    assert.deepEqual(await asking.completed, {
      type: "answer",
      questionId: "delivery",
      selectedOptionIds: ["ci"],
      note: "Required",
      seq: 1,
    });
  } finally {
    if (sessionId) runCli(["close", "--session", sessionId], env);
    await rm(home, { recursive: true, force: true });
  }
});
