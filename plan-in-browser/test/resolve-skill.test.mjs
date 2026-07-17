import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { spawnSync } from "node:child_process";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(skillRoot, "resolve-skill.mjs");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("resolves a project-local skill by directory name", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "resolve-skill-"));
  temporaryDirectories.push(cwd);
  const skill = join(cwd, ".agents", "skills", "example", "SKILL.md");
  await mkdir(dirname(skill), { recursive: true });
  await writeFile(skill, "---\nname: example\ndescription: test fixture\n---\n");

  const result = spawnSync(process.execPath, [cli, "example"], { cwd, encoding: "utf8" });

  assert.deepEqual(
    { status: result.status, output: result.stdout.trim() },
    { status: 0, output: await realpath(skill) },
  );
});

test("rejects invalid skill names", () => {
  const result = spawnSync(process.execPath, [cli, "../example"], { encoding: "utf8" });

  assert.deepEqual(
    { status: result.status, showsUsage: /usage: resolve-skill/.test(result.stderr) },
    { status: 2, showsUsage: true },
  );
});
