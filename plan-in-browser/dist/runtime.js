import http from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactTracker } from "./artifact-tracker.js";
const here = dirname(fileURLToPath(import.meta.url));
const pageRoot = join(here, "..", "page");
const args = process.argv.slice(2);
const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const sessionId = option("--session");
const token = option("--token");
const runtimeId = option("--runtime-id");
const dir = option("--dir");
const topic = option("--topic") || "Planning session";
const CLOSE_GRACE_MS = 1500;
const configuredIdleMs = Number(process.env.PLANNING_CANVAS_IDLE_MS);
const IDLE_MS = Number.isFinite(configuredIdleMs) && configuredIdleMs > 0
    ? configuredIdleMs
    : 2 * 60 * 60 * 1000;
if (!sessionId || !token || !runtimeId || !dir) {
    throw new Error("missing --session, --token, --runtime-id, or --dir");
}
mkdirSync(dir, { recursive: true });
const stateFile = join(dir, "state.json");
let state = {
    version: 2,
    sessionId,
    topic,
    status: "open",
    nodes: [],
    events: [],
    seq: 0,
    cwd: process.cwd(),
};
if (existsSync(stateFile)) {
    const persisted = JSON.parse(readFileSync(stateFile, "utf8"));
    if (persisted.version !== 2)
        throw new Error("unsupported planning canvas state format");
    if (persisted.sessionId !== sessionId || !["open", "cancelled", "closed"].includes(persisted.status || "")) {
        throw new Error("invalid planning canvas state");
    }
    if (persisted.status !== "open") {
        throw new Error(`planning session is ${persisted.status} and cannot start a runtime`);
    }
    state = { ...state, ...persisted };
}
state.cwd ||= process.cwd();
const artifactTracker = new ArtifactTracker({ sessionDir: dir, cwd: state.cwd });
const waiters = new Set();
let lastBrowserActivity = Date.now();
let shuttingDown = false;
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
            if (body.length > 1024 * 1024)
                req.destroy();
        });
        req.on("end", () => {
            try {
                resolve((body ? JSON.parse(body) : {}));
            }
            catch {
                resolve({});
            }
        });
    });
}
function settle(waiter, event) {
    waiters.delete(waiter);
    sendJson(waiter.res, event);
}
function flushWaiters() {
    for (const waiter of [...waiters]) {
        const event = firstEventAfter(waiter.cursor);
        if (event)
            settle(waiter, event);
    }
}
function emit(input) {
    const event = { ...input, seq: ++state.seq };
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
    const pageAssets = {
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
    if (!authorized(req, url))
        return sendJson(res, { error: "unauthorized" }, 401);
    if (req.method === "GET" && url.pathname === "/state") {
        lastBrowserActivity = Date.now();
        return sendJson(res, {
            sessionId: state.sessionId,
            topic: state.topic,
            status: state.status,
            tree: state.nodes,
            artifacts: artifactTracker.snapshot(),
            cursor: state.seq,
            runtimeId,
        });
    }
    if (req.method === "GET" && url.pathname === "/wait") {
        const cursor = Number(url.searchParams.get("cursor") || 0);
        const event = firstEventAfter(cursor);
        if (event)
            return sendJson(res, event);
        // Hold the request until the browser answers. There is deliberately no
        // heartbeat timeout: waking the agent just because an hour elapsed would
        // trigger an unnecessary model continuation.
        const waiter = { cursor, res };
        waiters.add(waiter);
        res.on("close", () => {
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
            if (node.status === "active" && node.id !== question.id)
                node.status = "pending";
        }
        const existing = nodeById(question.id);
        const next = { ...question, status: "active", answer: existing?.answer || null };
        if (existing)
            Object.assign(existing, next);
        else
            state.nodes.push(next);
        persist();
        return sendJson(res, { ok: true, id: question.id });
    }
    if (req.method === "POST" && url.pathname === "/artifact") {
        const input = await readJson(req);
        if (typeof input.path !== "string" || !input.path.trim()) {
            return sendJson(res, { error: "artifact path is required" }, 400);
        }
        const artifact = artifactTracker.register(input);
        return sendJson(res, { ok: true, ...artifact });
    }
    if (req.method === "POST" && url.pathname === "/answer") {
        const { nodeId, selectedOptionIds = [], note = "" } = await readJson(req);
        const node = nodeById(nodeId);
        if (!node || node.status !== "active")
            return sendJson(res, { error: "question is not active" }, 409);
        node.answer = { selectedOptionIds, note };
        node.status = "resolved";
        emit({ type: "answer", questionId: nodeId, selectedOptionIds, note });
        return sendJson(res, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/edit") {
        const { nodeId, selectedOptionIds = [], note = "" } = await readJson(req);
        const node = nodeById(nodeId);
        if (!node)
            return sendJson(res, { error: "unknown question" }, 404);
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
        if (state.status !== "cancelled")
            state.status = "closed";
        persist();
        sendJson(res, { ok: true });
        setTimeout(() => shutdown(), CLOSE_GRACE_MS).unref();
        return;
    }
    return sendJson(res, { error: "not found" }, 404);
});
server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    persist();
    process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});
function shutdown() {
    if (shuttingDown)
        return;
    shuttingDown = true;
    for (const waiter of [...waiters])
        settle(waiter, { type: "idle", reason: "idle" });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
}
setInterval(() => {
    if (Date.now() - lastBrowserActivity >= IDLE_MS)
        shutdown();
}, Math.min(60_000, IDLE_MS)).unref();
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
