import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, "..");
function systemBrowserOpener(url) {
    if (process.env.PLANNING_CANVAS_NO_OPEN === "1")
        return;
    const [program, args] = process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
            ? ["cmd", ["/c", "start", "", url]]
            : ["xdg-open", [url]];
    try {
        const child = spawn(program, args, { detached: true, stdio: "ignore" });
        child.unref();
    }
    catch {
        // Callers still receive the URL when no opener is available.
    }
}
export class PlanningSessionClient {
    root;
    cwd;
    openBrowser;
    constructor(options = {}) {
        this.root = options.root || process.env.PLANNING_CANVAS_HOME || join(homedir(), ".cache", "planning-canvas");
        this.cwd = options.cwd || process.cwd();
        this.openBrowser = options.openBrowser || systemBrowserOpener;
    }
    paths(sessionId) {
        const dir = join(this.root, sessionId);
        return { dir, registry: join(dir, "registry.json"), state: join(dir, "state.json") };
    }
    readRegistry(sessionId) {
        const { registry } = this.paths(sessionId);
        if (!existsSync(registry))
            throw new Error(`planning canvas session not found: ${sessionId}`);
        return JSON.parse(readFileSync(registry, "utf8"));
    }
    writeRegistry(sessionId, registry) {
        const file = this.paths(sessionId).registry;
        const temporary = `${file}.tmp`;
        writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600 });
        renameSync(temporary, file);
    }
    async request(registry, method, path, body, signal, timeoutMs) {
        return new Promise((resolve, reject) => {
            const data = body === undefined ? undefined : JSON.stringify(body);
            const req = http.request({
                host: "127.0.0.1",
                port: registry.port,
                method,
                path,
                headers: {
                    "x-planning-canvas-token": registry.token,
                    ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
                },
                signal,
            }, (res) => {
                let response = "";
                res.on("data", (chunk) => (response += chunk));
                res.on("end", () => {
                    let parsed;
                    try {
                        parsed = JSON.parse(response);
                    }
                    catch {
                        parsed = { error: response || `HTTP ${res.statusCode}` };
                    }
                    if ((res.statusCode || 500) >= 400)
                        reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
                    else
                        resolve(parsed);
                });
            });
            req.on("error", reject);
            if (timeoutMs)
                req.setTimeout(timeoutMs, () => req.destroy(new Error("request timed out")));
            if (data)
                req.write(data);
            req.end();
        });
    }
    browserUrl(registry) {
        return `http://127.0.0.1:${registry.port}/?token=${encodeURIComponent(registry.token)}`;
    }
    async spawnRuntime(sessionId, token, topic) {
        const { dir, registry: registryFile } = this.paths(sessionId);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const child = spawn(process.execPath, [
            join(skillRoot, "server.mjs"),
            "--session",
            sessionId,
            "--token",
            token,
            "--dir",
            dir,
            "--topic",
            topic,
        ], { detached: true, stdio: ["ignore", "pipe", "pipe"], cwd: this.cwd });
        if (!child.pid)
            throw new Error("planning canvas server failed to start");
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
        let previous = {};
        if (existsSync(registryFile)) {
            try {
                previous = JSON.parse(readFileSync(registryFile, "utf8"));
            }
            catch {
                // Replace a corrupt connection registry.
            }
        }
        const registry = {
            ...previous,
            sessionId,
            topic,
            token,
            port: readiness.port,
            pid: child.pid,
            cursor: previous.cursor || 0,
            status: "live",
        };
        this.writeRegistry(sessionId, registry);
        return registry;
    }
    readPersistedState(sessionId) {
        const { state } = this.paths(sessionId);
        if (!existsSync(state))
            throw new Error(`planning canvas state not found: ${sessionId}`);
        return JSON.parse(readFileSync(state, "utf8"));
    }
    async ensureLive(sessionId) {
        let registry = this.readRegistry(sessionId);
        const persisted = this.readPersistedState(sessionId);
        if (registry.status === "closed") {
            throw new Error("planning canvas session is closed and cannot be resumed");
        }
        if (persisted.status === "closed" || persisted.status === "cancelled") {
            throw new Error(`planning canvas session is ${persisted.status} and cannot be resumed`);
        }
        let restarted = false;
        try {
            await this.request(registry, "GET", "/state", undefined, undefined, 750);
        }
        catch {
            registry = await this.spawnRuntime(sessionId, registry.token, persisted.topic || registry.topic || "Planning session");
            restarted = true;
            this.openBrowser(this.browserUrl(registry));
        }
        return { registry, persisted, restarted };
    }
    async start(topic = "Planning session") {
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        const sessionId = `pc-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
        const token = randomBytes(24).toString("base64url");
        const registry = await this.spawnRuntime(sessionId, token, topic);
        const url = this.browserUrl(registry);
        this.openBrowser(url);
        return { type: "started", sessionId, topic, url };
    }
    async resume(sessionId) {
        const { registry, persisted, restarted } = await this.ensureLive(sessionId);
        const url = this.browserUrl(registry);
        if (!restarted)
            this.openBrowser(url);
        return { type: "resumed", sessionId, topic: persisted.topic, url, restarted };
    }
    async waitForEvent(sessionId, signal, registry) {
        const event = await this.request(registry, "GET", `/wait?cursor=${registry.cursor || 0}`, undefined, signal);
        if (event.seq)
            this.writeRegistry(sessionId, { ...registry, cursor: event.seq });
        return event;
    }
    async ask(sessionId, question, signal) {
        const live = await this.ensureLive(sessionId);
        await this.request(live.registry, "POST", "/question", question, signal);
        const event = await this.waitForEvent(sessionId, signal, live.registry);
        return live.restarted
            ? { ...event, restarted: true, url: this.browserUrl(live.registry) }
            : event;
    }
    async wait(sessionId, signal) {
        const live = await this.ensureLive(sessionId);
        const event = await this.waitForEvent(sessionId, signal, live.registry);
        return live.restarted
            ? { ...event, restarted: true, url: this.browserUrl(live.registry) }
            : event;
    }
    async artifact(sessionId, path, title, signal) {
        const { registry } = await this.ensureLive(sessionId);
        return this.request(registry, "POST", "/artifact", { path, title }, signal);
    }
    async close(sessionId) {
        let registry = this.readRegistry(sessionId);
        const persisted = this.readPersistedState(sessionId);
        if (persisted.status !== "closed") {
            let runtimeIsLive = false;
            try {
                await this.request(registry, "GET", "/state", undefined, undefined, 750);
                runtimeIsLive = true;
            }
            catch {
                // A non-terminal planning session must recover so the runtime remains
                // the sole writer of its durable terminal status.
            }
            if (!runtimeIsLive && persisted.status !== "cancelled") {
                registry = await this.spawnRuntime(sessionId, registry.token, persisted.topic || registry.topic || "Planning session");
                runtimeIsLive = true;
            }
            if (runtimeIsLive) {
                await this.request(registry, "POST", "/close");
                let reachedTerminalState = false;
                for (let attempt = 0; attempt < 50; attempt += 1) {
                    const current = this.readPersistedState(sessionId);
                    if (current.status === "closed" || current.status === "cancelled") {
                        reachedTerminalState = true;
                        break;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
                if (!reachedTerminalState)
                    throw new Error("planning canvas runtime did not close");
            }
        }
        this.writeRegistry(sessionId, { ...registry, status: "closed" });
        return { type: "closed", sessionId };
    }
    async state(sessionId, signal) {
        const { registry } = await this.ensureLive(sessionId);
        return this.request(registry, "GET", "/state", undefined, signal);
    }
}
