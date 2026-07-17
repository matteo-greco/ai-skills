import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PlanningRuntimeStart = {
  sessionId: string;
  token: string;
  dir: string;
  topic: string;
  cwd: string;
};

export type PlanningRuntimeConnection = { pid: number; port: number };

export interface PlanningRuntime {
  start(input: PlanningRuntimeStart): Promise<PlanningRuntimeConnection>;
}

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export class ChildProcessPlanningRuntime implements PlanningRuntime {
  protected readonly children = new Map<string, ChildProcess>();

  protected argumentsFor(input: PlanningRuntimeStart) {
    return [
      join(skillRoot, "server.mjs"),
      "--session",
      input.sessionId,
      "--token",
      input.token,
      "--dir",
      input.dir,
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
    this.children.set(input.sessionId, child);
    child.once("exit", () => this.children.delete(input.sessionId));
    return { pid: child.pid, port: readiness.port };
  }
}

/** Test adapter that can deterministically put an owned runtime into its idle state. */
export class ControlledPlanningRuntime extends ChildProcessPlanningRuntime {
  protected override argumentsFor(input: PlanningRuntimeStart) {
    return [...super.argumentsFor(input), "--termination-reason", "idle"];
  }

  async idle(sessionId: string | undefined) {
    if (!sessionId) throw new Error("planning session has not started");
    const child = this.children.get(sessionId);
    if (!child) throw new Error(`planning runtime is not live: ${sessionId}`);
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => resolve());
      if (!child.kill("SIGTERM")) reject(new Error(`could not stop planning runtime: ${sessionId}`));
    });
  }
}
