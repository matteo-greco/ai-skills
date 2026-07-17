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
