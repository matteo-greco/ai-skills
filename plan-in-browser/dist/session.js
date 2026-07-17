import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ChildProcessPlanningRuntime, } from "./runtime-process.js";
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
    runtime;
    clientId = randomBytes(12).toString("base64url");
    constructor(options = {}) {
        this.root = options.root || process.env.PLANNING_CANVAS_HOME || join(homedir(), ".cache", "planning-canvas");
        this.cwd = options.cwd || process.cwd();
        this.openBrowser = options.openBrowser || systemBrowserOpener;
        this.runtime = options.runtime || new ChildProcessPlanningRuntime();
    }
    paths(sessionId) {
        const dir = join(this.root, sessionId);
        return {
            dir,
            registry: join(dir, "registry.json"),
            state: join(dir, "state.json"),
            artifacts: join(dir, "artifacts.json"),
            takeover: join(dir, "takeover.lock"),
        };
    }
    readRegistry(sessionId) {
        const { registry: file } = this.paths(sessionId);
        if (!existsSync(file))
            throw new Error(`planning canvas connection not found: ${sessionId}`);
        const registry = JSON.parse(readFileSync(file, "utf8"));
        if (registry.version !== 2)
            throw new Error("unsupported planning canvas connection format");
        const pending = registry.pendingDelivery;
        if (registry.sessionId !== sessionId
            || typeof registry.token !== "string"
            || typeof registry.port !== "number"
            || typeof registry.pid !== "number"
            || typeof registry.runtimeId !== "string"
            || typeof registry.processStart !== "string"
            || typeof registry.acknowledgedSeq !== "number"
            || "status" in registry
            || "topic" in registry
            || (pending !== undefined
                && (typeof pending !== "object"
                    || pending === null
                    || typeof pending.seq !== "number"
                    || typeof pending.clientId !== "string"))) {
            throw new Error("invalid planning canvas connection record");
        }
        return registry;
    }
    writeRegistry(sessionId, registry) {
        const file = this.paths(sessionId).registry;
        const temporary = `${file}.tmp`;
        writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600 });
        renameSync(temporary, file);
    }
    readPersistedState(sessionId) {
        const { state: file } = this.paths(sessionId);
        if (!existsSync(file))
            throw new Error(`planning canvas state not found: ${sessionId}`);
        const state = JSON.parse(readFileSync(file, "utf8"));
        if (state.version !== 2)
            throw new Error("unsupported planning canvas state format");
        if (state.sessionId !== sessionId
            || typeof state.topic !== "string"
            || !["open", "cancelled", "closed"].includes(state.status || "")
            || !Array.isArray(state.nodes)
            || !Array.isArray(state.events)
            || typeof state.seq !== "number") {
            throw new Error("invalid planning canvas state");
        }
        return state;
    }
    connection(registry) {
        return {
            sessionId: registry.sessionId,
            runtimeId: registry.runtimeId,
            processStart: registry.processStart,
            pid: registry.pid,
            port: registry.port,
        };
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
    async spawnRuntime(sessionId, token, topic, previous) {
        const { dir } = this.paths(sessionId);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const runtimeId = randomBytes(18).toString("base64url");
        const connection = await this.runtime.start({
            sessionId,
            token,
            runtimeId,
            sessionDir: dir,
            topic,
            cwd: this.cwd,
        });
        const registry = {
            version: 2,
            sessionId,
            token,
            port: connection.port,
            pid: connection.pid,
            runtimeId: connection.runtimeId,
            processStart: connection.processStart,
            acknowledgedSeq: previous?.acknowledgedSeq || 0,
            ...(previous?.pendingDelivery ? { pendingDelivery: previous.pendingDelivery } : {}),
        };
        this.writeRegistry(sessionId, registry);
        return registry;
    }
    rejectTerminal(state) {
        if (state.status !== "open") {
            throw new Error(`planning session is ${state.status} and cannot be resumed`);
        }
    }
    async probe(registry) {
        const remote = await this.request(registry, "GET", "/state", undefined, undefined, 750);
        if (remote.runtimeId !== registry.runtimeId)
            throw new Error("planning runtime identity mismatch");
    }
    async withTakeoverLock(sessionId, operation) {
        const lock = this.paths(sessionId).takeover;
        const deadline = Date.now() + 10_000;
        while (true) {
            try {
                writeFileSync(lock, JSON.stringify({ pid: process.pid, clientId: this.clientId }), {
                    flag: "wx",
                    mode: 0o600,
                });
                break;
            }
            catch (cause) {
                if (cause.code !== "EEXIST")
                    throw cause;
                try {
                    const owner = JSON.parse(readFileSync(lock, "utf8"));
                    if (typeof owner.pid !== "number")
                        throw new Error("invalid takeover owner");
                    process.kill(owner.pid, 0);
                }
                catch (ownerError) {
                    if (ownerError.code !== "EPERM") {
                        rmSync(lock, { recursive: true, force: true });
                        continue;
                    }
                }
                if (Date.now() >= deadline)
                    throw new Error("timed out waiting for planning runtime takeover");
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        }
        try {
            return await operation();
        }
        finally {
            rmSync(lock, { recursive: true, force: true });
        }
    }
    async ensureLive(sessionId) {
        let persisted = this.readPersistedState(sessionId);
        this.rejectTerminal(persisted);
        let registry = this.readRegistry(sessionId);
        try {
            await this.probe(registry);
            return { registry, persisted, restarted: false };
        }
        catch {
            const failedRuntimeId = registry.runtimeId;
            const recovered = await this.withTakeoverLock(sessionId, async () => {
                persisted = this.readPersistedState(sessionId);
                this.rejectTerminal(persisted);
                registry = this.readRegistry(sessionId);
                try {
                    await this.probe(registry);
                    return { registry, persisted, restarted: registry.runtimeId !== failedRuntimeId };
                }
                catch {
                    await this.runtime.retire(this.connection(registry));
                    registry = await this.spawnRuntime(sessionId, registry.token, persisted.topic, registry);
                    return { registry, persisted, restarted: true };
                }
            });
            if (recovered.restarted)
                this.openBrowser(this.browserUrl(recovered.registry));
            return recovered;
        }
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
    acknowledgePriorDelivery(sessionId, registry) {
        if (registry.pendingDelivery?.clientId !== this.clientId)
            return registry;
        const acknowledged = {
            ...registry,
            acknowledgedSeq: Math.max(registry.acknowledgedSeq, registry.pendingDelivery.seq),
        };
        delete acknowledged.pendingDelivery;
        this.writeRegistry(sessionId, acknowledged);
        return acknowledged;
    }
    acknowledge(sessionId, event) {
        if (!event.seq)
            return;
        const registry = this.readRegistry(sessionId);
        if (registry.pendingDelivery?.seq !== event.seq)
            return;
        this.writeRegistry(sessionId, { ...registry, acknowledgedSeq: event.seq, pendingDelivery: undefined });
    }
    async waitForEvent(sessionId, signal, registry) {
        const delivery = this.acknowledgePriorDelivery(sessionId, registry);
        const event = await this.request(delivery, "GET", `/wait?cursor=${delivery.acknowledgedSeq}`, undefined, signal);
        if (event.seq) {
            this.writeRegistry(sessionId, {
                ...delivery,
                pendingDelivery: { seq: event.seq, clientId: this.clientId },
            });
        }
        return event;
    }
    async ask(sessionId, question, signal) {
        const live = await this.ensureLive(sessionId);
        const registry = this.acknowledgePriorDelivery(sessionId, live.registry);
        await this.request(registry, "POST", "/question", question, signal);
        const event = await this.waitForEvent(sessionId, signal, registry);
        return live.restarted
            ? { ...event, restarted: true, url: this.browserUrl(registry) }
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
        const persisted = this.readPersistedState(sessionId);
        const registryFile = this.paths(sessionId).registry;
        if (!existsSync(registryFile)) {
            if (persisted.status === "open")
                throw new Error(`planning canvas connection not found: ${sessionId}`);
            return { type: "closed", sessionId };
        }
        let registry = this.readRegistry(sessionId);
        if (persisted.status === "open") {
            const live = await this.ensureLive(sessionId);
            registry = live.registry;
            await this.request(registry, "POST", "/close");
            const terminal = this.readPersistedState(sessionId);
            if (terminal.status !== "closed" && terminal.status !== "cancelled") {
                throw new Error("planning canvas runtime did not close");
            }
        }
        await this.runtime.retire(this.connection(registry));
        if (existsSync(registryFile))
            unlinkSync(registryFile);
        return { type: "closed", sessionId };
    }
    async state(sessionId, signal) {
        const persisted = this.readPersistedState(sessionId);
        if (persisted.status !== "open") {
            const artifactFile = this.paths(sessionId).artifacts;
            const artifactStore = existsSync(artifactFile)
                ? JSON.parse(readFileSync(artifactFile, "utf8"))
                : {};
            return {
                sessionId: persisted.sessionId,
                topic: persisted.topic,
                status: persisted.status,
                tree: persisted.nodes,
                artifacts: Array.isArray(artifactStore.artifacts) ? artifactStore.artifacts : [],
                cursor: persisted.seq,
            };
        }
        const { registry } = await this.ensureLive(sessionId);
        return this.request(registry, "GET", "/state", undefined, signal);
    }
}
