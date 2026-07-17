import { execFile } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export type PlanningRuntimeStart = {
  sessionId: string;
  token: string;
  runtimeId: string;
  sessionDir: string;
  topic: string;
  cwd: string;
};

export type PlanningRuntimeConnection = {
  sessionId: string;
  runtimeId: string;
  processStart: string;
  pid: number;
  port: number;
};

export interface PlanningRuntime {
  start(input: PlanningRuntimeStart): Promise<PlanningRuntimeConnection>;
  retire(connection: PlanningRuntimeConnection): Promise<void>;
}

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(skillRoot, "server.mjs");
const execFileAsync = promisify(execFile);
const RETIRE_GRACE_MS = 500;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function processDetails(pid: number) {
  try {
    const [{ stdout: command }, { stdout: started }] = await Promise.all([
      execFileAsync("ps", ["-ww", "-p", String(pid), "-o", "command="]),
      execFileAsync("ps", ["-p", String(pid), "-o", "lstart="]),
    ]);
    if (!command.trim() || !started.trim()) return undefined;
    return { command: command.trim(), processStart: started.trim() };
  } catch {
    return undefined;
  }
}

const processCommand = async (pid: number) => (await processDetails(pid))?.command;

function commandHasArgument(command: string, name: string, value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${name}\\s+${escaped}(?:\\s|$)`).test(command);
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class ChildProcessPlanningRuntime implements PlanningRuntime {
  protected readonly children = new Map<string, ChildProcess>();

  protected argumentsFor(input: PlanningRuntimeStart) {
    return [
      serverPath,
      "--session",
      input.sessionId,
      "--token",
      input.token,
      "--runtime-id",
      input.runtimeId,
      "--dir",
      input.sessionDir,
      "--topic",
      input.topic,
    ];
  }

  async start(input: PlanningRuntimeStart): Promise<PlanningRuntimeConnection> {
    const child = spawn(process.execPath, this.argumentsFor(input), {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: input.cwd,
    });
    if (!child.pid || !child.stdout || !child.stderr) {
      throw new Error("planning canvas server failed to start");
    }

    const readiness = await new Promise<{ port: number }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error, ready?: { port: number }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        if (error) reject(error);
        else resolve(ready!);
      };
      const onError = (error: Error) => finish(error);
      const onExit = (code: number | null) =>
        finish(new Error(stderr.trim() || `planning canvas server exited ${code}`));
      const timer = setTimeout(
        () => finish(new Error(stderr.trim() || "planning canvas server failed to start")),
        5_000,
      );
      child.on("error", onError);
      child.on("exit", onExit);
      child.stderr!.on("data", (chunk) => (stderr += chunk));
      child.stdout!.on("data", (chunk) => {
        stdout += chunk;
        const newline = stdout.indexOf("\n");
        if (newline < 0) return;
        try {
          const ready = JSON.parse(stdout.slice(0, newline)) as { port?: unknown };
          if (typeof ready.port !== "number") throw new Error("runtime did not report a port");
          finish(undefined, { port: ready.port });
        } catch (cause) {
          finish(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
    });

    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    this.children.set(input.runtimeId, child);
    child.once("exit", () => this.children.delete(input.runtimeId));
    const details = await processDetails(child.pid);
    if (!details) {
      child.kill("SIGKILL");
      throw new Error("planning canvas runtime identity could not be established");
    }
    return {
      sessionId: input.sessionId,
      runtimeId: input.runtimeId,
      processStart: details.processStart,
      pid: child.pid,
      port: readiness.port,
    };
  }

  protected async owns(connection: PlanningRuntimeConnection) {
    const child = this.children.get(connection.runtimeId);
    if (child?.pid === connection.pid && child.exitCode === null) return true;
    const details = await processDetails(connection.pid);
    if (!details || details.processStart !== connection.processStart) return false;
    return details.command.includes(serverPath)
      && commandHasArgument(details.command, "--session", connection.sessionId)
      && commandHasArgument(details.command, "--runtime-id", connection.runtimeId);
  }

  protected signal(connection: PlanningRuntimeConnection, signal: NodeJS.Signals) {
    return process.kill(connection.pid, signal);
  }

  async retire(connection: PlanningRuntimeConnection): Promise<void> {
    if (!(await this.owns(connection))) {
      const command = await processCommand(connection.pid);
      if (!command && !processExists(connection.pid)) return;
      if (command && !command.includes(serverPath)) return;
      throw new Error("planning canvas runtime ownership could not be verified; refusing takeover");
    }

    try {
      this.signal(connection, "SIGTERM");
    } catch (cause) {
      if (!(await processCommand(connection.pid))) return;
      throw cause;
    }

    const deadline = Date.now() + RETIRE_GRACE_MS;
    while (Date.now() < deadline) {
      if (!(await processCommand(connection.pid))) return;
      await delay(20);
    }

    if (!(await this.owns(connection))) {
      const command = await processCommand(connection.pid);
      if ((!command && !processExists(connection.pid)) || (command && !command.includes(serverPath))) return;
      throw new Error("planning canvas runtime ownership changed during takeover; refusing termination");
    }
    this.signal(connection, "SIGKILL");
    while (await processCommand(connection.pid)) await delay(10);
  }
}

/** Test adapter with deterministic controls for runtime exits and hangs. */
export class ControlledPlanningRuntime extends ChildProcessPlanningRuntime {
  private childForSession(sessionId: string | undefined) {
    if (!sessionId) throw new Error("planning session has not started");
    const child = [...this.children.values()].find((candidate) => candidate.spawnargs.includes(sessionId));
    if (!child) throw new Error(`planning runtime is not live: ${sessionId}`);
    return child;
  }

  pid(sessionId: string | undefined) {
    return this.childForSession(sessionId).pid;
  }

  async idle(sessionId: string | undefined) {
    const child = this.childForSession(sessionId);
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => resolve());
      if (!child.kill("SIGTERM")) reject(new Error(`could not stop planning runtime: ${sessionId}`));
    });
  }

  hang(sessionId: string | undefined) {
    const child = this.childForSession(sessionId);
    process.kill(child.pid!, "SIGSTOP");
  }

  async exit(sessionId: string | undefined) {
    const child = this.childForSession(sessionId);
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
  }
}
