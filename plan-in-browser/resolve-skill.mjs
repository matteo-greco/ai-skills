#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error("usage: resolve-skill.mjs <skill-name>");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const roots = [
  join(cwd, ".agents", "skills"),
  join(cwd, ".pi", "skills"),
  join(homedir(), ".agents", "skills"),
  join(homedir(), ".pi", "agent", "skills"),
  join(homedir(), ".claude", "skills"),
  join(homedir(), ".codex", "skills"),
];

function frontmatterName(file) {
  try {
    const text = readFileSync(file, "utf8");
    const match = text.match(/^---\s*\n[\s\S]*?^name:\s*([^\s#]+).*?^---\s*$/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

const candidates = [];
for (const root of roots) {
  const direct = join(root, name, "SKILL.md");
  if (existsSync(direct)) candidates.push(direct);

  if (!existsSync(root)) continue;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const file = join(root, entry.name, "SKILL.md");
    if (existsSync(file) && frontmatterName(file) === name) candidates.push(file);
  }
}

const self = realpathSync(join(here, "SKILL.md"));
const found = candidates.find((file) => realpathSync(file) !== self);
if (!found) {
  console.error(`skill not found: ${name}`);
  process.exit(1);
}

process.stdout.write(resolve(found) + "\n");
