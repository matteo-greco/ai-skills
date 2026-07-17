import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export class ChildProcessPlanningRuntime {
    children = new Map();
    argumentsFor(input) {
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
    async start(input) {
        const child = spawn(process.execPath, this.argumentsFor(input), {
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            cwd: input.cwd,
        });
        if (!child.pid || !child.stdout || !child.stderr) {
            throw new Error("planning canvas server failed to start");
        }
        const readiness = await new Promise((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            let settled = false;
            const finish = (error, ready) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                child.removeListener("error", onError);
                child.removeListener("exit", onExit);
                if (error)
                    reject(error);
                else
                    resolve(ready);
            };
            const onError = (error) => finish(error);
            const onExit = (code) => finish(new Error(stderr.trim() || `planning canvas server exited ${code}`));
            const timer = setTimeout(() => finish(new Error(stderr.trim() || "planning canvas server failed to start")), 5_000);
            child.on("error", onError);
            child.on("exit", onExit);
            child.stderr.on("data", (chunk) => (stderr += chunk));
            child.stdout.on("data", (chunk) => {
                stdout += chunk;
                const newline = stdout.indexOf("\n");
                if (newline < 0)
                    return;
                try {
                    const ready = JSON.parse(stdout.slice(0, newline));
                    if (typeof ready.port !== "number")
                        throw new Error("runtime did not report a port");
                    finish(undefined, { port: ready.port });
                }
                catch (cause) {
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
    argumentsFor(input) {
        return [...super.argumentsFor(input), "--termination-reason", "idle"];
    }
    async idle(sessionId) {
        if (!sessionId)
            throw new Error("planning session has not started");
        const child = this.children.get(sessionId);
        if (!child)
            throw new Error(`planning runtime is not live: ${sessionId}`);
        await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", () => resolve());
            if (!child.kill("SIGTERM"))
                reject(new Error(`could not stop planning runtime: ${sessionId}`));
        });
    }
}
