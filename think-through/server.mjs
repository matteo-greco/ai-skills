#!/usr/bin/env node
// think-through server — node stdlib, zero deps.
// Single writer of session state. Long-polls the agent via /wait; the browser
// polls /state and POSTs answers. See PROTOCOL.md.

import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const IDLE_MS = 2 * 60 * 60 * 1000; // browser-poll idle → self-shutdown
const WAIT_HOLD_MS = 3500 * 1000; // server-side long-poll cap (< curl --max-time 3600)

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sessionId = opt("--session") || `tt-${Math.random().toString(16).slice(2, 6)}`;
const resume = args.includes("--resume");
let slug = opt("--slug") || "untitled";

const DIR = join(process.cwd(), "scratchpad", "think-through");
mkdirSync(DIR, { recursive: true });
const STATE_FILE = join(DIR, `${sessionId}.state.json`);
const REG_FILE = join(DIR, `${sessionId}.json`);

// ---- state ----------------------------------------------------------------
// nodes: ordered list. status: active | resolved | retracted.
// events: append-only; each has a monotonic seq. cursor = last seq emitted.
let state = { sessionId, slug, status: "live", nodes: [], events: [], seq: 0, exportPath: null };

if (resume && existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    state.status = "live";
    slug = state.slug || slug;
  } catch {
    /* corrupt state → start fresh */
  }
}

const persist = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const nodeById = (id) => state.nodes.find((n) => n.id === id);

// ---- long-poll waiters ----------------------------------------------------
const waiters = new Set(); // { cursor, res, timer }

function firstEventAfter(cursor) {
  return state.events.find((e) => e.seq > cursor);
}

function settle(waiter, payload) {
  clearTimeout(waiter.timer);
  waiters.delete(waiter);
  json(waiter.res, payload);
}

function flushWaiters() {
  for (const w of [...waiters]) {
    const ev = firstEventAfter(w.cursor);
    if (ev) settle(w, ev);
  }
}

function emit(ev) {
  ev.seq = ++state.seq;
  state.events.push(ev);
  writeRegistry();
  persist();
  flushWaiters();
}

// ---- registry (the address book tt reads) ---------------------------------
function writeRegistry() {
  writeFileSync(
    REG_FILE,
    JSON.stringify({ port, slug, sessionId, pid: process.pid, cursor: state.seq, status: state.status }, null, 2),
  );
}

// ---- http helpers ---------------------------------------------------------
function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// ---- page -----------------------------------------------------------------
let lastBrowserPoll = Date.now();
function servePage(res) {
  const file = join(HERE, "page", "index.html");
  if (existsSync(file)) {
    const html = readFileSync(file);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } else {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PLACEHOLDER);
  }
}

// ---- request router -------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method;

  // GET /
  if (method === "GET" && path === "/") {
    lastBrowserPoll = Date.now();
    return servePage(res);
  }

  // GET /state  — browser poll (~1s) and `tt state`
  if (method === "GET" && path === "/state") {
    lastBrowserPoll = Date.now();
    return json(res, { tree: state.nodes, cursor: state.seq, status: state.status, slug });
  }

  // GET /wait?cursor=N  — agent long-poll
  if (method === "GET" && path === "/wait") {
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const ev = firstEventAfter(cursor);
    if (ev) return json(res, ev);
    const waiter = { cursor, res };
    waiter.timer = setTimeout(() => settle(waiter, { type: "timeout" }), WAIT_HOLD_MS);
    waiters.add(waiter);
    req.on("close", () => {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
    });
    return;
  }

  // GET /export — chosen path + resolved tree (valid after approve)
  if (method === "GET" && path === "/export") {
    return json(res, { path: state.exportPath, tree: state.nodes });
  }

  // POST /question — agent adds the active node
  if (method === "POST" && path === "/question") {
    const node = await readBody(req);
    node.status = "active";
    node.answer = null;
    const existing = nodeById(node.id);
    if (existing) Object.assign(existing, node);
    else state.nodes.push(node);
    persist();
    return json(res, { ok: true, id: node.id });
  }

  // POST /retract — agent greys nodes (recoverable). { ids:[], restore?:bool }
  if (method === "POST" && path === "/retract") {
    const { ids = [], restore = false } = await readBody(req);
    for (const id of ids) {
      const n = nodeById(id);
      if (n) n.status = restore ? (n.answer ? "resolved" : "active") : "retracted";
    }
    persist();
    return json(res, { ok: true, ids });
  }

  // POST /answer — browser answers the active node
  if (method === "POST" && path === "/answer") {
    const { nodeId, selected = [], rider = "" } = await readBody(req);
    const n = nodeById(nodeId);
    if (n) {
      n.answer = { selected, rider };
      n.status = "resolved";
    }
    emit({ type: "answer", nodeId, selected, rider });
    return json(res, { ok: true });
  }

  // POST /edit — browser revises a resolved node
  if (method === "POST" && path === "/edit") {
    const { nodeId, selected = [], rider = "" } = await readBody(req);
    const n = nodeById(nodeId);
    if (n) n.answer = { selected, rider };
    emit({ type: "edit", nodeId, selected, rider });
    return json(res, { ok: true });
  }

  // POST /approve — browser approves; carries the export path
  if (method === "POST" && path === "/approve") {
    const { path: exportPath } = await readBody(req);
    state.exportPath = exportPath || `docs/designs/${slug}.md`;
    state.status = "approved";
    emit({ type: "approve", path: state.exportPath });
    return json(res, { ok: true });
  }

  // POST /cancel — browser cancels
  if (method === "POST" && path === "/cancel") {
    state.status = "cancelled";
    emit({ type: "cancel" });
    return json(res, { ok: true });
  }

  json(res, { error: "not found" }, 404);
});

// ---- boot -----------------------------------------------------------------
let port;
server.listen(0, "127.0.0.1", () => {
  port = server.address().port;
  writeRegistry();
  persist();
  // stdout contract for `tt boot`:
  process.stdout.write(
    JSON.stringify({ url: `http://127.0.0.1:${port}`, sessionId, port, slug, cursor: state.seq }) + "\n",
  );
});

// ---- idle self-shutdown ---------------------------------------------------
setInterval(() => {
  if (Date.now() - lastBrowserPoll > IDLE_MS) {
    state.status = "idle-exit";
    writeRegistry();
    persist();
    process.exit(0);
  }
}, 60 * 1000).unref();

// ---- placeholder page (until page/index.html exists) ----------------------
const PLACEHOLDER = `<!doctype html><meta charset=utf-8>
<title>think-through — ${slug}</title>
<body style="font:14px ui-monospace,monospace;max-width:760px;margin:40px auto;padding:0 16px;color:#222">
<h1 style="font-family:ui-serif,serif">think-through · ${slug}</h1>
<p style="color:#888">Placeholder UI — the real page/ is not built yet. Live state below (polls /state).</p>
<pre id=out style="white-space:pre-wrap;background:#f6f6f4;padding:12px;border-radius:8px"></pre>
<script>
async function tick(){
  try{const r=await fetch('/state');document.getElementById('out').textContent=JSON.stringify(await r.json(),null,2);}
  catch(e){document.getElementById('out').textContent='server gone';}
}
setInterval(tick,1000);tick();
</script>`;
