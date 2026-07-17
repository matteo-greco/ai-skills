import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlanningSessionOwner } from "../dist/planning-session-owner.js";

function ownerHarness(overrides = {}) {
  const calls = [];
  const client = {
    async start(topic) {
      calls.push(["start", topic]);
      return { type: "started", sessionId: "planning-1", topic, url: "http://planning.test/1" };
    },
    async resume(sessionId) {
      calls.push(["resume", sessionId]);
      return { type: "resumed", sessionId, topic: "Planning", url: `http://planning.test/${sessionId}`, restarted: false };
    },
    async ask(sessionId, question) {
      calls.push(["ask", sessionId, question.id]);
      return { type: "answer", questionId: question.id, selectedOptionIds: ["yes"] };
    },
    async artifact(sessionId, path, title) {
      calls.push(["artifact", sessionId, path, title]);
      return { ok: true, id: "artifact-1", path };
    },
    async close(sessionId) {
      calls.push(["close", sessionId]);
      return { type: "closed", sessionId };
    },
    ...overrides,
  };
  const owner = createPlanningSessionOwner({
    client,
    record(entry) {
      calls.push(["record", entry]);
    },
  });
  return { owner, calls };
}

const question = { id: "ship", question: "Ship it?", answerType: "confirm" };

test("first ask starts and records a Planning session before asking", async () => {
  const { owner, calls } = ownerHarness();

  const result = await owner.ask(question);

  assert.deepEqual(calls, [
    ["start", "Ship it?"],
    ["record", { sessionId: "planning-1", url: "http://planning.test/1", status: "active" }],
    ["ask", "planning-1", "ship"],
  ]);
  assert.deepEqual(result, {
    event: { type: "answer", questionId: "ship", selectedOptionIds: ["yes"] },
    sessionId: "planning-1",
    url: "http://planning.test/1",
    attachment: "started",
  });
});

test("subsequent asks reuse the attached Planning session", async () => {
  const { owner, calls } = ownerHarness();
  await owner.ask(question);
  calls.length = 0;

  const result = await owner.ask({ ...question, id: "second" });

  assert.deepEqual(calls, [["ask", "planning-1", "second"]]);
  assert.equal(result.sessionId, "planning-1");
  assert.equal(result.attachment, undefined);
});

test("ask retries recoverable ownership and records it before asking", async () => {
  let attempts = 0;
  const { owner, calls } = ownerHarness({
    async resume(sessionId) {
      calls.push(["resume", sessionId]);
      attempts += 1;
      if (attempts === 1) throw new Error("runtime unavailable");
      return { type: "resumed", sessionId, topic: "Planning", url: "http://planning.test/recovered", restarted: true };
    },
  });
  const branch = [{ type: "custom", customType: "planning-canvas-session", data: { sessionId: "saved-1", url: "http://old", status: "active" } }];
  const restored = await owner.restore(branch);
  assert.equal(restored.status, "recoverable");
  calls.length = 0;

  const result = await owner.ask(question);

  assert.deepEqual(calls, [
    ["resume", "saved-1"],
    ["record", { sessionId: "saved-1", url: "http://planning.test/recovered", status: "active" }],
    ["ask", "saved-1", "ship"],
  ]);
  assert.equal(result.attachment, "resumed");
  assert.equal(result.url, "http://planning.test/recovered");
});

test("failed recoverable asks preserve ownership and never start a replacement", async () => {
  const { owner, calls } = ownerHarness({
    async resume(sessionId) {
      calls.push(["resume", sessionId]);
      throw new Error("still unavailable");
    },
  });
  await owner.restore([{ type: "custom", customType: "planning-canvas-session", data: { sessionId: "saved-1", status: "active" } }]);
  calls.length = 0;

  await assert.rejects(owner.ask(question), /still unavailable/);
  await assert.rejects(owner.ask(question), /still unavailable/);

  assert.deepEqual(calls, [["resume", "saved-1"], ["resume", "saved-1"]]);
});

test("explicit resume requires an explicit or recoverable target", async () => {
  const { owner } = ownerHarness();
  await assert.rejects(owner.resume(), /No recoverable planning canvas is recorded in this Pi session/);
});

test("failed explicit resume preserves prior ownership", async () => {
  const { owner, calls } = ownerHarness({
    async resume(sessionId) {
      calls.push(["resume", sessionId]);
      throw new Error("cannot resume target");
    },
  });
  await owner.ask(question);
  calls.length = 0;

  await assert.rejects(owner.resume("other-1"), /cannot resume target/);
  await owner.ask({ ...question, id: "after-failure" });

  assert.deepEqual(calls, [["resume", "other-1"], ["ask", "planning-1", "after-failure"]]);
});

test("a restarted ask records and returns the refreshed URL", async () => {
  const { owner, calls } = ownerHarness({
    async ask(sessionId, asked) {
      calls.push(["ask", sessionId, asked.id]);
      return { type: "answer", questionId: asked.id, restarted: true, url: "http://planning.test/refreshed" };
    },
  });

  const result = await owner.ask(question);

  assert.deepEqual(calls.at(-1), ["record", { sessionId: "planning-1", url: "http://planning.test/refreshed", status: "active" }]);
  assert.equal(result.url, "http://planning.test/refreshed");
});

test("restore uses only the newest matching branch entry", async () => {
  const { owner, calls } = ownerHarness();
  const result = await owner.restore([
    { type: "custom", customType: "planning-canvas-session", data: { sessionId: "old", status: "active" } },
    { type: "custom", customType: "other", data: { sessionId: "ignored", status: "active" } },
    { type: "custom", customType: "planning-canvas-session", data: { sessionId: "new", status: "active" } },
  ]);

  assert.equal(result.status, "attached");
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [["resume", "new"], ["record", { sessionId: "new", url: "http://planning.test/new", status: "active" }]]);
});

test("a closed tombstone prevents restoring older ownership", async () => {
  const { owner, calls } = ownerHarness();
  const result = await owner.restore([
    { type: "custom", customType: "planning-canvas-session", data: { sessionId: "old", status: "active" } },
    { type: "custom", customType: "planning-canvas-session", data: { sessionId: "old", status: "closed" } },
  ]);

  assert.deepEqual(result, { status: "closed" });
  assert.deepEqual(calls, []);
});

test("malformed newest data does not fall back to stale ownership", async () => {
  const { owner, calls } = ownerHarness();
  const result = await owner.restore([
    { type: "custom", customType: "planning-canvas-session", data: { sessionId: "old", status: "active" } },
    { type: "custom", customType: "planning-canvas-session", data: { sessionId: 42, status: "active" } },
  ]);

  assert.deepEqual(result, { status: "invalid" });
  assert.deepEqual(calls, []);
});

test("artifact registration requires attachment and uses owned identity", async () => {
  const { owner, calls } = ownerHarness();
  await assert.rejects(owner.artifact("plan.md"), /No planning canvas is active/);
  await owner.ask(question);
  calls.length = 0;

  const result = await owner.artifact("plan.md", "Plan");

  assert.deepEqual(calls, [["artifact", "planning-1", "plan.md", "Plan"]]);
  assert.deepEqual(result, { path: "plan.md", sessionId: "planning-1", url: "http://planning.test/1" });
});

test("close records before clearing and repeated close is a no-op", async () => {
  const { owner, calls } = ownerHarness();
  await owner.ask(question);
  calls.length = 0;

  const closed = await owner.close();
  const repeated = await owner.close();

  assert.deepEqual(calls, [
    ["close", "planning-1"],
    ["record", { sessionId: "planning-1", url: "http://planning.test/1", status: "closed" }],
  ]);
  assert.deepEqual(closed, { closed: true, sessionId: "planning-1", result: { type: "closed", sessionId: "planning-1" } });
  assert.deepEqual(repeated, { closed: false });
});

test("close targets recoverable ownership and remains retryable after failure", async () => {
  let closeAttempts = 0;
  const { owner, calls } = ownerHarness({
    async resume(sessionId) {
      calls.push(["resume", sessionId]);
      throw new Error("offline");
    },
    async close(sessionId) {
      calls.push(["close", sessionId]);
      closeAttempts += 1;
      if (closeAttempts === 1) throw new Error("close failed");
      return { type: "closed", sessionId };
    },
  });
  await owner.restore([{ type: "custom", customType: "planning-canvas-session", data: { sessionId: "saved-1", url: "http://old", status: "active" } }]);
  calls.length = 0;

  await assert.rejects(owner.close(), /close failed/);
  await owner.close();

  assert.deepEqual(calls, [
    ["close", "saved-1"],
    ["close", "saved-1"],
    ["record", { sessionId: "saved-1", url: "http://old", status: "closed" }],
  ]);
});
