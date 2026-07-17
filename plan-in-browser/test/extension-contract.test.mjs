import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { createPlanningCanvasExtension } from "../index.ts";

function planningSessionAdapter() {
  return {
    async start(topic) {
      return { type: "started", sessionId: "planning-1", topic, url: "http://planning.test/" };
    },
    async ask(_sessionId, question) {
      return {
        type: "answer",
        questionId: question.id,
        selectedOptionIds: ["confirmed"],
        note: "Ship it",
        seq: 1,
      };
    },
    async resume(sessionId) {
      return { type: "resumed", sessionId, topic: "Adapter contract", url: "http://planning.test/", restarted: false };
    },
    async artifact(_sessionId, path) {
      return { ok: true, id: "artifact-1", path };
    },
    async close(sessionId) {
      return { type: "closed", sessionId };
    },
  };
}

async function createPiHarness() {
  const home = await mkdtemp(join(tmpdir(), "planning-pi-adapter-"));
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: home,
    agentDir: join(home, ".pi", "agent"),
    settingsManager,
    extensionFactories: [{
      name: "planning-canvas-contract",
      factory: createPlanningCanvasExtension(() => planningSessionAdapter()),
    }],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: home,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(home),
    settingsManager,
    noTools: "builtin",
  });
  return {
    session,
    async cleanUp() {
      session.dispose();
      await rm(home, { recursive: true, force: true });
    },
  };
}

test("the Pi adapter exposes the four planning tools", async () => {
  const harness = await createPiHarness();
  try {
    assert.deepEqual(harness.session.agent.state.tools.map((tool) => tool.name).sort(), [
      "planning_canvas",
      "planning_canvas_artifact",
      "planning_canvas_close",
      "planning_canvas_resume",
    ]);
  } finally {
    await harness.cleanUp();
  }
});

test("the Pi planning tool returns the person's answer", async () => {
  const harness = await createPiHarness();
  try {
    const tool = harness.session.agent.state.tools.find(({ name }) => name === "planning_canvas");
    const result = await tool.execute(
      "planning-call",
      { topic: "Adapter contract", id: "ship", question: "Ship it?", answerType: "confirm" },
    );

    assert.equal(result.content[0].text, 'User answered ship: selected ["confirmed"]; note: Ship it');
  } finally {
    await harness.cleanUp();
  }
});

function registrationHarness(client) {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const entries = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { events.set(name, handler); },
    appendEntry(type, data) { entries.push({ type, data }); },
  };
  createPlanningCanvasExtension(() => client)(pi);
  return { tools, commands, events, entries };
}

function adapterContext(branch = []) {
  const notifications = [];
  return {
    notifications,
    context: {
      signal: undefined,
      sessionManager: { getBranch: () => branch },
      ui: {
        notify(message, level) { notifications.push([message, level]); },
        setStatus() {},
        setWorkingIndicator() {},
      },
    },
  };
}

test("a planning question retries failed automatic recovery instead of starting", async () => {
  const calls = [];
  let resumeAttempts = 0;
  const client = planningSessionAdapter();
  client.start = async () => { calls.push("start"); throw new Error("must not start"); };
  client.resume = async (sessionId) => {
    calls.push(["resume", sessionId]);
    resumeAttempts += 1;
    if (resumeAttempts === 1) throw new Error("offline");
    return { type: "resumed", sessionId, topic: "Recovered", url: "http://planning.test/recovered", restarted: true };
  };
  client.ask = async (sessionId, asked) => {
    calls.push(["ask", sessionId]);
    return { type: "answer", questionId: asked.id, selectedOptionIds: ["confirmed"] };
  };
  const registered = registrationHarness(client);
  const branch = [{ type: "custom", customType: "planning-canvas-session", data: { sessionId: "saved-1", status: "active" } }];
  const { context } = adapterContext(branch);

  await registered.events.get("session_start")({}, context);
  await registered.tools.get("planning_canvas").execute(
    "planning-call",
    { id: "ship", question: "Ship it?", answerType: "confirm" },
    undefined,
    undefined,
    context,
  );

  assert.deepEqual(calls, [["resume", "saved-1"], ["resume", "saved-1"], ["ask", "saved-1"]]);
});

test("the resume tool and command delegate through the same owner", async () => {
  const calls = [];
  const client = planningSessionAdapter();
  client.resume = async (sessionId) => {
    calls.push(sessionId);
    return { type: "resumed", sessionId, topic: "Resume", url: `http://planning.test/${sessionId}`, restarted: false };
  };
  const registered = registrationHarness(client);
  const { context } = adapterContext();

  await registered.tools.get("planning_canvas_resume").execute(
    "resume-call", { sessionId: "from-tool" }, undefined, undefined, context,
  );
  await registered.commands.get("planning-canvas-resume").handler("from-command", context);

  assert.deepEqual(calls, ["from-tool", "from-command"]);
  assert.deepEqual(registered.entries.map(({ data }) => data.sessionId), ["from-tool", "from-command"]);
});

test("the resume command presents missing recoverable ownership as a warning", async () => {
  const registered = registrationHarness(planningSessionAdapter());
  const { context, notifications } = adapterContext();

  await registered.commands.get("planning-canvas-resume").handler("", context);

  assert.deepEqual(notifications, [[
    "No recoverable planning canvas is recorded in this Pi session.",
    "warning",
  ]]);
});

test("automatic artifact failures remain warnings after successful edits", async () => {
  const client = planningSessionAdapter();
  client.artifact = async () => { throw new Error("display unavailable"); };
  const registered = registrationHarness(client);
  const { context, notifications } = adapterContext();
  await registered.tools.get("planning_canvas").execute(
    "planning-call",
    { id: "ship", question: "Ship it?", answerType: "confirm" },
    undefined,
    undefined,
    context,
  );

  await registered.events.get("tool_result")(
    { toolName: "write", isError: false, input: { path: "plan.md" } },
    context,
  );

  assert.deepEqual(notifications.at(-1), ["Could not show planning artifact: display unavailable", "warning"]);
});
