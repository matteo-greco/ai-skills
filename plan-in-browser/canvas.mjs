#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { PlanningSessionClient } from "./dist/session.js";

const argv = process.argv.slice(2);
const command = argv[0];
const option = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const client = new PlanningSessionClient({ cwd: process.cwd() });

function output(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
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

const commands = {
  async start() {
    output(await client.start(option("--topic") || "Planning session"));
  },
  async resume() {
    output(await client.resume(option("--session") || fail("resume requires --session")));
  },
  async ask() {
    const sessionId = option("--session") || fail("ask requires --session");
    output(await client.ask(sessionId, await readQuestion()));
  },
  async wait() {
    output(await client.wait(option("--session") || fail("wait requires --session")));
  },
  async artifact() {
    const sessionId = option("--session") || fail("artifact requires --session");
    const path = option("--path") || fail("artifact requires --path");
    const title = option("--title");
    const registered = await client.artifact(sessionId, path, title);
    output({ type: "artifact", ...registered });
  },
  async close() {
    output(await client.close(option("--session") || fail("close requires --session")));
  },
  async state() {
    output(await client.state(option("--session") || fail("state requires --session")));
  },
};

if (!commands[command]) fail("usage: canvas.mjs <start|resume|ask|wait|artifact|state|close>");
commands[command]().catch((error) => fail(error.stack || error.message || String(error)));
