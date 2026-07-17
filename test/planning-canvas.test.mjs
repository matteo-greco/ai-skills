import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repositoryRoot, "plan-in-browser", "canvas.mjs");

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

async function waitForQuestion(url, token) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${url}state`, { headers: { "x-planning-canvas-token": token } });
    const state = await response.json();
    if (state.tree.length > 0) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("question was not published");
}

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
