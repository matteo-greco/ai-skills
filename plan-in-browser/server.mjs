#!/usr/bin/env node

import http from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const sessionId = option("--session");
const token = option("--token");
const dir = option("--dir");
const registryFile = option("--registry");
const topic = option("--topic") || "Planning session";
if (!sessionId || !token || !dir || !registryFile) {
  throw new Error("missing --session, --token, --dir, or --registry");
}

mkdirSync(dir, { recursive: true });
const stateFile = join(dir, "state.json");
let state = {
  sessionId,
  topic,
  status: "live",
  nodes: [],
  events: [],
  seq: 0,
};
if (existsSync(stateFile)) {
  try {
    state = { ...state, ...JSON.parse(readFileSync(stateFile, "utf8")), status: "live" };
  } catch {
    // A corrupt recovery file starts a fresh canvas.
  }
}

const waiters = new Set();
const nodeById = (id) => state.nodes.find((node) => node.id === id);
const firstEventAfter = (cursor) => state.events.find((event) => event.seq > cursor);

function persist() {
  const temporary = `${stateFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temporary, stateFile);
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function settle(waiter, event) {
  clearTimeout(waiter.timer);
  waiters.delete(waiter);
  sendJson(waiter.res, event);
}

function flushWaiters() {
  for (const waiter of [...waiters]) {
    const event = firstEventAfter(waiter.cursor);
    if (event) settle(waiter, event);
  }
}

function emit(event) {
  event.seq = ++state.seq;
  state.events.push(event);
  persist();
  flushWaiters();
}

function authorized(req, url) {
  return req.headers["x-planning-canvas-token"] === token || url.searchParams.get("token") === token;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204, { "cache-control": "public, max-age=86400" });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/") {
    const page = readFileSync(join(here, "page", "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    return res.end(page);
  }

  if (!authorized(req, url)) return sendJson(res, { error: "unauthorized" }, 401);

  if (req.method === "GET" && url.pathname === "/state") {
    return sendJson(res, {
      sessionId: state.sessionId,
      topic: state.topic,
      status: state.status,
      tree: state.nodes,
      cursor: state.seq,
    });
  }

  if (req.method === "GET" && url.pathname === "/wait") {
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const event = firstEventAfter(cursor);
    if (event) return sendJson(res, event);

    // Hold the request until the browser answers. There is deliberately no
    // heartbeat timeout: waking the agent just because an hour elapsed would
    // trigger an unnecessary model continuation.
    const waiter = { cursor, res, timer: undefined };
    waiters.add(waiter);
    res.on("close", () => {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/question") {
    const question = await readJson(req);
    if (!question.id || !question.question || !question.answerType) {
      return sendJson(res, { error: "invalid question" }, 400);
    }
    for (const node of state.nodes) {
      if (node.status === "active" && node.id !== question.id) node.status = "pending";
    }
    const existing = nodeById(question.id);
    const next = { ...question, status: "active", answer: existing?.answer || null };
    if (existing) Object.assign(existing, next);
    else state.nodes.push(next);
    persist();
    return sendJson(res, { ok: true, id: question.id });
  }

  if (req.method === "POST" && url.pathname === "/answer") {
    const { nodeId, selectedOptionIds = [], note = "" } = await readJson(req);
    const node = nodeById(nodeId);
    if (!node || node.status !== "active") return sendJson(res, { error: "question is not active" }, 409);
    node.answer = { selectedOptionIds, note };
    node.status = "resolved";
    emit({ type: "answer", questionId: nodeId, selectedOptionIds, note });
    return sendJson(res, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/edit") {
    const { nodeId, selectedOptionIds = [], note = "" } = await readJson(req);
    const node = nodeById(nodeId);
    if (!node) return sendJson(res, { error: "unknown question" }, 404);
    node.answer = { selectedOptionIds, note };
    node.status = "resolved";
    emit({ type: "edit", questionId: nodeId, selectedOptionIds, note });
    return sendJson(res, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/cancel") {
    state.status = "cancelled";
    emit({ type: "cancel" });
    return sendJson(res, { ok: true });
  }

  return sendJson(res, { error: "not found" }, 404);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  persist();
  const temporary = `${registryFile}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({ sessionId, topic: state.topic, token, port: address.port, pid: process.pid, cursor: 0 }, null, 2),
    { mode: 0o600 },
  );
  renameSync(temporary, registryFile);
});

function shutdown() {
  state.status = state.status === "cancelled" ? "cancelled" : "closed";
  persist();
  for (const waiter of [...waiters]) settle(waiter, { type: "cancel" });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
