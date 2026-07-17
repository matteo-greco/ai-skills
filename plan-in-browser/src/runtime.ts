import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Question } from "./session.js";

type Answer = { selectedOptionIds: string[]; note: string };
type DecisionNode = Question & { status: "active" | "pending" | "resolved"; answer: Answer | null };
type CanvasEvent = { type: string; seq: number; [key: string]: unknown };
type ArtifactDiff = {
  text: string;
  additions: number;
  deletions: number;
  against: "HEAD" | "/dev/null";
};
type Artifact = {
  id: string;
  path: string;
  displayPath: string;
  title?: string;
  revision: number;
  content?: string;
  error?: string;
  diff?: ArtifactDiff;
};
type PlanningState = {
  sessionId: string;
  topic: string;
  status: string;
  nodes: DecisionNode[];
  artifacts: Artifact[];
  events: CanvasEvent[];
  seq: number;
  cwd: string;
};
type Waiter = { cursor: number; res: ServerResponse };
type ArtifactWatcher = { watcher: FSWatcher; paths: Set<string> };
type ArtifactInput = { path: string; title?: string };
type AnswerInput = { nodeId: string; selectedOptionIds?: string[]; note?: string };

const here = dirname(fileURLToPath(import.meta.url));
const pageRoot = join(here, "..", "page");
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const sessionId = option("--session");
const token = option("--token");
const dir = option("--dir");
const topic = option("--topic") || "Planning session";
const MAX_ARTIFACT_BYTES = 512 * 1024;
const CLOSE_GRACE_MS = 1500;
const configuredIdleMs = Number(process.env.PLANNING_CANVAS_IDLE_MS);
const IDLE_MS = Number.isFinite(configuredIdleMs) && configuredIdleMs > 0
  ? configuredIdleMs
  : 2 * 60 * 60 * 1000;
if (!sessionId || !token || !dir) {
  throw new Error("missing --session, --token, or --dir");
}

mkdirSync(dir, { recursive: true });
const stateFile = join(dir, "state.json");
let state: PlanningState = {
  sessionId,
  topic,
  status: "live",
  nodes: [],
  artifacts: [],
  events: [],
  seq: 0,
  cwd: process.cwd(),
};
if (existsSync(stateFile)) {
  try {
    state = { ...state, ...JSON.parse(readFileSync(stateFile, "utf8")), status: "live" };
  } catch {
    // A corrupt recovery file starts a fresh canvas.
  }
}
state.artifacts ||= [];
state.cwd ||= process.cwd();

const waiters = new Set<Waiter>();
const artifactWatchers = new Map<string, ArtifactWatcher>();
let lastBrowserActivity = Date.now();
let shuttingDown = false;
const nodeById = (id: string) => state.nodes.find((node) => node.id === id);
const firstEventAfter = (cursor: number) => state.events.find((event) => event.seq > cursor);

function persist() {
  const temporary = `${stateFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temporary, stateFile);
}

function sendJson(res: ServerResponse, value: unknown, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve((body ? JSON.parse(body) : {}) as T);
      } catch {
        resolve({} as T);
      }
    });
  });
}

function settle(waiter: Waiter, event: CanvasEvent | { type: string; reason?: string }) {
  waiters.delete(waiter);
  sendJson(waiter.res, event);
}

function flushWaiters() {
  for (const waiter of [...waiters]) {
    const event = firstEventAfter(waiter.cursor);
    if (event) settle(waiter, event);
  }
}

function emit(input: { type: string; [key: string]: unknown }) {
  const event: CanvasEvent = { ...input, seq: ++state.seq };
  state.events.push(event);
  persist();
  flushWaiters();
}

function authorized(req: IncomingMessage, url: URL) {
  return req.headers["x-planning-canvas-token"] === token || url.searchParams.get("token") === token;
}

function artifactByPath(path: string) {
  return state.artifacts.find((artifact) => artifact.path === path);
}

function runGit(args: string[]) {
  return spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: MAX_ARTIFACT_BYTES * 4,
    windowsHide: true,
  });
}

function countDiffChanges(text: string) {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function gitDiffForArtifact(path: string, hasContent: boolean): ArtifactDiff | undefined {
  const worktree = runGit(["-C", dirname(path), "rev-parse", "--show-toplevel"]);
  if (worktree.status !== 0) return undefined;
  const root = worktree.stdout.trim();
  const displayPath = relative(root, path);
  if (!displayPath || displayPath === ".." || displayPath.startsWith("../") || displayPath.startsWith("..\\")) {
    return undefined;
  }

  const tracked = runGit(["-C", root, "ls-files", "--error-unmatch", "--", displayPath]).status === 0;
  const hasHead = runGit(["-C", root, "rev-parse", "--verify", "HEAD"]).status === 0;
  let result;
  if (tracked && hasHead) {
    result = runGit(
      ["-C", root, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--unified=3", "HEAD", "--", displayPath],
    );
    if (result.status !== 0) return undefined;
  } else if (hasContent) {
    result = runGit(
      ["-C", root, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--unified=3", "--no-index", "--", "/dev/null", displayPath],
    );
    if (result.status !== 0 && result.status !== 1) return undefined;
  } else {
    return undefined;
  }

  const text = result.stdout;
  if (!text.includes("@@")) return undefined;
  return { text, ...countDiffChanges(text), against: tracked && hasHead ? "HEAD" : "/dev/null" };
}

function refreshArtifact(artifact: Artifact, shouldPersist = true) {
  let content;
  let error;
  try {
    const stats = statSync(artifact.path);
    if (!stats.isFile()) throw new Error("Not a regular file");
    if (stats.size > MAX_ARTIFACT_BYTES) {
      throw new Error(`File is larger than ${Math.round(MAX_ARTIFACT_BYTES / 1024)} KB`);
    }
    const buffer = readFileSync(artifact.path);
    if (buffer.includes(0)) throw new Error("Binary files cannot be displayed");
    content = buffer.toString("utf8");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  const diff = gitDiffForArtifact(artifact.path, content !== undefined);
  const unchangedDiff = artifact.diff?.text === diff?.text
    && artifact.diff?.additions === diff?.additions
    && artifact.diff?.deletions === diff?.deletions
    && artifact.diff?.against === diff?.against;
  if (artifact.content === content && artifact.error === error && unchangedDiff) return false;
  artifact.content = content;
  artifact.error = error;
  artifact.diff = diff;
  artifact.revision = (artifact.revision || 0) + 1;
  if (shouldPersist) persist();
  return true;
}

function ensureArtifactWatcher(artifact: Artifact) {
  const directory = dirname(artifact.path);
  let entry = artifactWatchers.get(directory);
  if (entry) {
    entry.paths.add(artifact.path);
    return;
  }

  const paths = new Set([artifact.path]);
  try {
    const watcher = watch(directory, (_eventType, filename) => {
      const changedName = filename ? String(filename) : undefined;
      for (const path of paths) {
        if (!changedName || basename(path) === changedName) {
          const current = artifactByPath(path);
          if (current) refreshArtifact(current);
        }
      }
    });
    watcher.on("error", () => {
      watcher.close();
      artifactWatchers.delete(directory);
    });
    entry = { watcher, paths };
    artifactWatchers.set(directory, entry);
  } catch {
    // The initial content remains visible even if its directory cannot be watched.
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204, { "cache-control": "public, max-age=86400" });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/") {
    lastBrowserActivity = Date.now();
    const page = readFileSync(join(pageRoot, "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    return res.end(page);
  }

  const pageAssets: Record<string, [string, string]> = {
    "/assets/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/assets/highlight.min.js": ["vendor/highlight.min.js", "text/javascript; charset=utf-8"],
    "/assets/highlight-github.min.css": ["vendor/highlight-github.min.css", "text/css; charset=utf-8"],
  };
  if (req.method === "GET" && pageAssets[url.pathname]) {
    const [filename, contentType] = pageAssets[url.pathname];
    const asset = readFileSync(join(pageRoot, filename));
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    });
    return res.end(asset);
  }

  if (!authorized(req, url)) return sendJson(res, { error: "unauthorized" }, 401);

  if (req.method === "GET" && url.pathname === "/state") {
    lastBrowserActivity = Date.now();
    return sendJson(res, {
      sessionId: state.sessionId,
      topic: state.topic,
      status: state.status,
      tree: state.nodes,
      artifacts: state.artifacts,
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
    const waiter: Waiter = { cursor, res };
    waiters.add(waiter);
    res.on("close", () => {
      waiters.delete(waiter);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/question") {
    const question = await readJson<Question>(req);
    if (!question.id || !question.question || !question.answerType) {
      return sendJson(res, { error: "invalid question" }, 400);
    }
    for (const node of state.nodes) {
      if (node.status === "active" && node.id !== question.id) node.status = "pending";
    }
    const existing = nodeById(question.id);
    const next: DecisionNode = { ...question, status: "active", answer: existing?.answer || null };
    if (existing) Object.assign(existing, next);
    else state.nodes.push(next);
    persist();
    return sendJson(res, { ok: true, id: question.id });
  }

  if (req.method === "POST" && url.pathname === "/artifact") {
    const input = await readJson<ArtifactInput>(req);
    if (typeof input.path !== "string" || !input.path.trim()) {
      return sendJson(res, { error: "artifact path is required" }, 400);
    }
    const path = isAbsolute(input.path) ? resolve(input.path) : resolve(state.cwd, input.path);
    let artifact = artifactByPath(path);
    if (!artifact) {
      const displayPath = relative(state.cwd, path);
      artifact = {
        id: `artifact-${state.artifacts.length + 1}`,
        path,
        displayPath: displayPath && !displayPath.startsWith("..") ? displayPath : path,
        title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : undefined,
        revision: 0,
      };
      state.artifacts.push(artifact);
    } else if (typeof input.title === "string" && input.title.trim()) {
      artifact.title = input.title.trim();
    }
    refreshArtifact(artifact, false);
    ensureArtifactWatcher(artifact);
    persist();
    return sendJson(res, { ok: true, id: artifact.id, path: artifact.path });
  }

  if (req.method === "POST" && url.pathname === "/answer") {
    const { nodeId, selectedOptionIds = [], note = "" } = await readJson<AnswerInput>(req);
    const node = nodeById(nodeId);
    if (!node || node.status !== "active") return sendJson(res, { error: "question is not active" }, 409);
    node.answer = { selectedOptionIds, note };
    node.status = "resolved";
    emit({ type: "answer", questionId: nodeId, selectedOptionIds, note });
    return sendJson(res, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/edit") {
    const { nodeId, selectedOptionIds = [], note = "" } = await readJson<AnswerInput>(req);
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

  if (req.method === "POST" && url.pathname === "/close") {
    state.status = state.status === "cancelled" ? "cancelled" : "closed";
    persist();
    sendJson(res, { ok: true });
    setTimeout(() => shutdown("closed", true), CLOSE_GRACE_MS).unref();
    return;
  }

  return sendJson(res, { error: "not found" }, 404);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address() as AddressInfo;
  for (const artifact of state.artifacts) {
    refreshArtifact(artifact, false);
    ensureArtifactWatcher(artifact);
  }
  persist();
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});

function shutdown(reason: string = "closed", stateAlreadyPersisted = false) {
  if (shuttingDown) return;
  shuttingDown = true;
  state.status = state.status === "cancelled" ? "cancelled" : reason;
  for (const { watcher } of artifactWatchers.values()) watcher.close();
  artifactWatchers.clear();
  if (!stateAlreadyPersisted) persist();
  const waiterEvent = reason === "idle" ? { type: "idle", reason: "idle" } : { type: "cancel" };
  for (const waiter of [...waiters]) settle(waiter, waiterEvent);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

setInterval(() => {
  if (Date.now() - lastBrowserActivity >= IDLE_MS) shutdown("idle");
}, Math.min(60_000, IDLE_MS)).unref();

process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());
