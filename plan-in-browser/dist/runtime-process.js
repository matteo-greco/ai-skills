import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(skillRoot, "server.mjs");
const execFileAsync = promisify(execFile);
const RETIRE_GRACE_MS = 500;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function processDetails(pid) {
    try {
        const [{ stdout: command }, { stdout: started }] = await Promise.all([
            execFileAsync("ps", ["-ww", "-p", String(pid), "-o", "command="]),
            execFileAsync("ps", ["-p", String(pid), "-o", "lstart="]),
        ]);
        if (!command.trim() || !started.trim())
            return undefined;
        return { command: command.trim(), processStart: started.trim() };
    }
    catch {
        return undefined;
    }
}
const processCommand = async (pid) => (await processDetails(pid))?.command;
function commandHasArgument(command, name, value) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)${name}\\s+${escaped}(?:\\s|$)`).test(command);
}
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (cause) {
        return cause.code === "EPERM";
    }
}
export class ChildProcessPlanningRuntime {
    children = new Map();
    argumentsFor(input) {
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
    async owns(connection) {
        const child = this.children.get(connection.runtimeId);
        if (child?.pid === connection.pid && child.exitCode === null)
            return true;
        const details = await processDetails(connection.pid);
        if (!details || details.processStart !== connection.processStart)
            return false;
        return details.command.includes(serverPath)
            && commandHasArgument(details.command, "--session", connection.sessionId)
            && commandHasArgument(details.command, "--runtime-id", connection.runtimeId);
    }
    signal(connection, signal) {
        return process.kill(connection.pid, signal);
    }
    async retire(connection) {
        if (!(await this.owns(connection))) {
            const command = await processCommand(connection.pid);
            if (!command && !processExists(connection.pid))
                return;
            if (command && !command.includes(serverPath))
                return;
            throw new Error("planning canvas runtime ownership could not be verified; refusing takeover");
        }
        try {
            this.signal(connection, "SIGTERM");
        }
        catch (cause) {
            if (!(await processCommand(connection.pid)))
                return;
            throw cause;
        }
        const deadline = Date.now() + RETIRE_GRACE_MS;
        while (Date.now() < deadline) {
            if (!(await processCommand(connection.pid)))
                return;
            await delay(20);
        }
        if (!(await this.owns(connection))) {
            const command = await processCommand(connection.pid);
            if ((!command && !processExists(connection.pid)) || (command && !command.includes(serverPath)))
                return;
            throw new Error("planning canvas runtime ownership changed during takeover; refusing termination");
        }
        this.signal(connection, "SIGKILL");
        while (await processCommand(connection.pid))
            await delay(10);
    }
}
/** Test adapter with deterministic controls for runtime exits and hangs. */
export class ControlledPlanningRuntime extends ChildProcessPlanningRuntime {
    childForSession(sessionId) {
        if (!sessionId)
            throw new Error("planning session has not started");
        const child = [...this.children.values()].find((candidate) => candidate.spawnargs.includes(sessionId));
        if (!child)
            throw new Error(`planning runtime is not live: ${sessionId}`);
        return child;
    }
    pid(sessionId) {
        return this.childForSession(sessionId).pid;
    }
    async idle(sessionId) {
        const child = this.childForSession(sessionId);
        await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", () => resolve());
            if (!child.kill("SIGTERM"))
                reject(new Error(`could not stop planning runtime: ${sessionId}`));
        });
    }
    hang(sessionId) {
        const child = this.childForSession(sessionId);
        process.kill(child.pid, "SIGSTOP");
    }
    async exit(sessionId) {
        const child = this.childForSession(sessionId);
        await new Promise((resolve) => {
            child.once("exit", () => resolve());
            child.kill("SIGKILL");
        });
    }
}
