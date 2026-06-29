#!/usr/bin/env node
// `tt` — the think-through helper CLI. Wraps every server call so the agent never
// writes raw curl and cursors are handled automatically. See PROTOCOL.md.
//
//   tt boot --topic "<plan>" [--resume]   start/restart the server, print {url,...}
//   tt ask <node.json | -->               POST the active question (file or stdin)
//   tt wait                               long-poll the next event (run in background)
//   tt retract <id...>                    grey nodes (recoverable)
//   tt state                              print the full tree
//   tt export                             print {path, tree} (after approve)
//   tt kill                               stop the server

import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(process.cwd(), "scratchpad", "think-through");
const ACTIVE = join(DIR, "active.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(name);
const rest = argv.slice(1).filter((a) => !a.startsWith("--"));

function die(msg) {
  process.stderr.write(msg + "\n");
  process.exit(1);
}
function out(obj) {
  process.stdout.write((typeof obj === "string" ? obj : JSON.stringify(obj)) + "\n");
}
const regFile = (id) => join(DIR, `${id}.json`);
const readJSON = (f) => JSON.parse(readFileSync(f, "utf8"));

function activeSession() {
  const id = flag("--session") || (existsSync(ACTIVE) ? readJSON(ACTIVE).sessionId : null);
  if (!id) die("no active session — run `tt boot` first (or pass --session <id>)");
  return id;
}
function registry(id) {
  const f = regFile(id);
  if (!existsSync(f)) die(`no registry for session ${id}`);
  return readJSON(f);
}

// minimal http client (zero deps)
function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: data ? { "content-type": "application/json" } : {} },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on("error", reject);
    // long enough for the server's 3500s long-poll cap
    req.setTimeout(3600 * 1000, () => req.destroy(new Error("__timeout__")));
    if (data) req.write(data);
    req.end();
  });
}

function slugify(s) {
  return (
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "untitled"
  );
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// ---- commands -------------------------------------------------------------
async function boot() {
  mkdirSync(DIR, { recursive: true });
  const resume = has("--resume");
  let id, slug;
  if (resume) {
    id = activeSession();
    slug = registry(id).slug;
  } else {
    slug = slugify(flag("--topic"));
    id = `tt-${Math.random().toString(16).slice(2, 6)}`;
  }
  const serverPath = join(HERE, "server.mjs");
  const a = ["--session", id, "--slug", slug, ...(resume ? ["--resume"] : [])];
  const child = spawn(process.execPath, [serverPath, ...a], { detached: true, stdio: "ignore" });
  child.unref();

  // wait for the server to publish its port into the registry
  let reg;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    if (existsSync(regFile(id))) {
      try {
        reg = readJSON(regFile(id));
        if (reg.port) break;
      } catch {
        /* mid-write */
      }
    }
  }
  if (!reg?.port) die("server failed to start");
  // active pointer: {sessionId, cursor consumed so far}
  writeFileSync(ACTIVE, JSON.stringify({ sessionId: id, cursor: resume ? reg.cursor : 0 }, null, 2));
  out({ url: `http://127.0.0.1:${reg.port}`, sessionId: id, port: reg.port, slug, cursor: reg.cursor });
}

async function ask() {
  const reg = registry(activeSession());
  const fileArg = rest[0];
  let raw;
  if (!fileArg || fileArg === "-") raw = await readStdin();
  else raw = readFileSync(isAbsolute(fileArg) ? fileArg : join(process.cwd(), fileArg), "utf8");
  const node = JSON.parse(raw);
  const r = await request(reg.port, "POST", "/question", node);
  out(r.body);
}

async function wait() {
  const id = activeSession();
  const reg = registry(id);
  const consumed = existsSync(ACTIVE) ? readJSON(ACTIVE).cursor || 0 : 0;
  let r;
  try {
    r = await request(reg.port, "GET", `/wait?cursor=${consumed}`);
  } catch (e) {
    // server gone / connection refused → tell the agent to heal
    return out({ type: "server-down", error: String(e.message || e) });
  }
  let ev;
  try {
    ev = JSON.parse(r.body);
  } catch {
    ev = { type: "timeout" };
  }
  if (ev.seq) writeFileSync(ACTIVE, JSON.stringify({ sessionId: id, cursor: ev.seq }, null, 2));
  out(ev);
}

async function retract() {
  const reg = registry(activeSession());
  const r = await request(reg.port, "POST", "/retract", { ids: rest, restore: has("--restore") });
  out(r.body);
}

async function state() {
  const reg = registry(activeSession());
  const r = await request(reg.port, "GET", "/state");
  out(r.body);
}

async function exportCmd() {
  const reg = registry(activeSession());
  const r = await request(reg.port, "GET", "/export");
  out(r.body);
}

async function kill() {
  const id = activeSession();
  const reg = registry(id);
  if (reg.pid) {
    try {
      process.kill(reg.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  writeFileSync(regFile(id), JSON.stringify({ ...reg, status: "closed" }, null, 2));
  out({ ok: true, killed: reg.pid ?? null });
}

const table = { boot, ask, wait, retract, state, export: exportCmd, kill };
(table[cmd] || (() => die(`usage: tt <boot|ask|wait|retract|state|export|kill>`)))().catch((e) =>
  die(String(e.stack || e)),
);
