#!/usr/bin/env node

import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.PLANNING_CANVAS_HOME || join(homedir(), ".cache", "planning-canvas");
const argv = process.argv.slice(2);
const command = argv[0];
const option = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function output(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

function paths(sessionId) {
  const dir = join(root, sessionId);
  return { dir, registry: join(dir, "registry.json") };
}

function readRegistry(sessionId) {
  const { registry } = paths(sessionId);
  if (!existsSync(registry)) fail(`planning canvas session not found: ${sessionId}`);
  return JSON.parse(readFileSync(registry, "utf8"));
}

function writeRegistry(sessionId, registry) {
  const file = paths(sessionId).registry;
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600 });
  renameSync(temporary, file);
}

function request(registry, method, path, body, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: registry.port,
        method,
        path,
        headers: {
          "x-planning-canvas-token": registry.token,
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
        },
        signal,
      },
      (res) => {
        let response = "";
        res.on("data", (chunk) => (response += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(response);
          } catch {
            parsed = { error: response || `HTTP ${res.statusCode}` };
          }
          if ((res.statusCode || 500) >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          else resolve(parsed);
        });
      },
    );
    req.on("error", reject);
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error("request timed out")));
    if (data) req.write(data);
    req.end();
  });
}

function openBrowser(url) {
  if (process.env.PLANNING_CANVAS_NO_OPEN === "1") return;
  const [program, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(program, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The URL is still printed when no opener is available.
  }
}

async function spawnServer(sessionId, token, topic) {
  const { dir, registry } = paths(sessionId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const child = spawn(
    process.execPath,
    [
      join(here, "server.mjs"),
      "--session",
      sessionId,
      "--token",
      token,
      "--dir",
      dir,
      "--registry",
      registry,
      "--topic",
      topic,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  for (let attempt = 0; attempt < 100; attempt++) {
    await sleep(50);
    if (!existsSync(registry)) continue;
    try {
      const current = JSON.parse(readFileSync(registry, "utf8"));
      if (current.port && current.pid === child.pid) return current;
    } catch {
      // Atomic rename makes this unlikely; retry if observed.
    }
  }
  fail("planning canvas server failed to start");
}

function browserUrl(registry) {
  return `http://127.0.0.1:${registry.port}/?token=${encodeURIComponent(registry.token)}`;
}

async function start() {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const topic = option("--topic") || "Planning session";
  const sessionId = `pc-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const token = randomBytes(24).toString("base64url");
  const registry = await spawnServer(sessionId, token, topic);
  const url = browserUrl(registry);
  openBrowser(url);
  output({ type: "started", sessionId, topic, url });
}

async function resume() {
  const sessionId = option("--session") || fail("resume requires --session");
  const { dir } = paths(sessionId);
  let registry = readRegistry(sessionId);
  const stateFile = join(dir, "state.json");
  if (!existsSync(stateFile)) fail(`planning canvas state not found: ${sessionId}`);
  const persisted = JSON.parse(readFileSync(stateFile, "utf8"));
  if (["closed", "cancelled"].includes(persisted.status)) {
    fail(`planning canvas session is ${persisted.status} and cannot be resumed`);
  }

  let restarted = false;
  try {
    await request(registry, "GET", "/state", undefined, undefined, 750);
  } catch {
    registry = await spawnServer(
      sessionId,
      registry.token,
      persisted.topic || registry.topic || "Planning session",
    );
    restarted = true;
  }

  const url = browserUrl(registry);
  openBrowser(url);
  output({ type: "resumed", sessionId, topic: persisted.topic, url, restarted });
}

async function readQuestion() {
  const inline = option("--json");
  const file = option("--file");
  if (inline) return JSON.parse(inline);
  if (file) return JSON.parse(readFileSync(isAbsolute(file) ? file : join(process.cwd(), file), "utf8"));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (chunks.length === 0) fail("ask requires --json, --file, or JSON on stdin");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function waitForEvent(sessionId, signal) {
  const registry = readRegistry(sessionId);
  const event = await request(registry, "GET", `/wait?cursor=${registry.cursor || 0}`, undefined, signal);
  if (event.seq) writeRegistry(sessionId, { ...registry, cursor: event.seq });
  return event;
}

async function ask() {
  const sessionId = option("--session") || fail("ask requires --session");
  const registry = readRegistry(sessionId);
  const question = await readQuestion();
  await request(registry, "POST", "/question", question);
  output(await waitForEvent(sessionId));
}

async function wait() {
  const sessionId = option("--session") || fail("wait requires --session");
  output(await waitForEvent(sessionId));
}

async function artifact() {
  const sessionId = option("--session") || fail("artifact requires --session");
  const path = option("--path") || fail("artifact requires --path");
  const title = option("--title");
  const registered = await request(readRegistry(sessionId), "POST", "/artifact", { path, title });
  output({ type: "artifact", ...registered });
}

async function close() {
  const sessionId = option("--session") || fail("close requires --session");
  const registry = readRegistry(sessionId);
  try {
    process.kill(registry.pid, "SIGTERM");
  } catch {
    // Already closed.
  }
  writeRegistry(sessionId, { ...registry, status: "closed" });
  output({ type: "closed", sessionId });
}

async function inspect() {
  const sessionId = option("--session") || fail("state requires --session");
  output(await request(readRegistry(sessionId), "GET", "/state"));
}

const commands = { start, resume, ask, wait, artifact, close, state: inspect };
if (!commands[command]) {
  fail("usage: canvas.mjs <start|resume|ask|wait|artifact|state|close>");
}

commands[command]().catch((error) => fail(error.stack || error.message || String(error)));
