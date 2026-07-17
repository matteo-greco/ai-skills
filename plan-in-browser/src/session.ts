import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ChildProcessPlanningRuntime,
  type PlanningRuntime,
  type PlanningRuntimeConnection,
} from "./runtime-process.js";

export type CanvasEvent = {
  type: "started" | "resumed" | "answer" | "edit" | "idle" | "cancel" | "timeout" | "closed";
  sessionId?: string;
  questionId?: string;
  selectedOptionIds?: string[];
  note?: string;
  reason?: string;
  url?: string;
  restarted?: boolean;
  seq?: number;
};

export type Question = {
  id: string;
  question: string;
  answerType: "single" | "multi" | "free" | "confirm";
  topic?: string;
  context?: string;
  options?: Array<{ id: string; label: string; detail?: string }>;
  recommendedOptionIds?: string[];
  recommendation?: string;
};

type PendingDelivery = { seq: number; clientId: string };

type Registry = {
  version: 2;
  sessionId: string;
  token: string;
  port: number;
  pid: number;
  runtimeId: string;
  processStart: string;
  acknowledgedSeq: number;
  pendingDelivery?: PendingDelivery;
};

type PersistedState = {
  version: 2;
  sessionId: string;
  topic: string;
  status: "open" | "cancelled" | "closed";
  nodes: unknown[];
  events: CanvasEvent[];
  seq: number;
  cwd: string;
};

type ClientOptions = {
  root?: string;
  cwd?: string;
  openBrowser?: (url: string) => void;
  runtime?: PlanningRuntime;
};

function systemBrowserOpener(url: string) {
  if (process.env.PLANNING_CANVAS_NO_OPEN === "1") return;
  const [program, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(program, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Callers still receive the URL when no opener is available.
  }
}

export class PlanningSessionClient {
  readonly root: string;
  readonly cwd: string;
  readonly openBrowser: (url: string) => void;
  readonly runtime: PlanningRuntime;
  private readonly clientId = randomBytes(12).toString("base64url");

  constructor(options: ClientOptions = {}) {
    this.root = options.root || process.env.PLANNING_CANVAS_HOME || join(homedir(), ".cache", "planning-canvas");
    this.cwd = options.cwd || process.cwd();
    this.openBrowser = options.openBrowser || systemBrowserOpener;
    this.runtime = options.runtime || new ChildProcessPlanningRuntime();
  }

  private paths(sessionId: string) {
    const dir = join(this.root, sessionId);
    return {
      dir,
      registry: join(dir, "registry.json"),
      state: join(dir, "state.json"),
      artifacts: join(dir, "artifacts.json"),
      takeover: join(dir, "takeover.lock"),
    };
  }

  private readRegistry(sessionId: string): Registry {
    const { registry: file } = this.paths(sessionId);
    if (!existsSync(file)) throw new Error(`planning canvas connection not found: ${sessionId}`);
    const registry = JSON.parse(readFileSync(file, "utf8")) as Partial<Registry> & Record<string, unknown>;
    if (registry.version !== 2) throw new Error("unsupported planning canvas connection format");
    const pending = registry.pendingDelivery;
    if (
      registry.sessionId !== sessionId
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
          || typeof pending.clientId !== "string"))
    ) {
      throw new Error("invalid planning canvas connection record");
    }
    return registry as Registry;
  }

  private writeRegistry(sessionId: string, registry: Registry) {
    const file = this.paths(sessionId).registry;
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600 });
    renameSync(temporary, file);
  }

  private readPersistedState(sessionId: string): PersistedState {
    const { state: file } = this.paths(sessionId);
    if (!existsSync(file)) throw new Error(`planning canvas state not found: ${sessionId}`);
    const state = JSON.parse(readFileSync(file, "utf8")) as Partial<PersistedState>;
    if (state.version !== 2) throw new Error("unsupported planning canvas state format");
    if (
      state.sessionId !== sessionId
      || typeof state.topic !== "string"
      || !["open", "cancelled", "closed"].includes(state.status || "")
      || !Array.isArray(state.nodes)
      || !Array.isArray(state.events)
      || typeof state.seq !== "number"
    ) {
      throw new Error("invalid planning canvas state");
    }
    return state as PersistedState;
  }

  private connection(registry: Registry): PlanningRuntimeConnection {
    return {
      sessionId: registry.sessionId,
      runtimeId: registry.runtimeId,
      processStart: registry.processStart,
      pid: registry.pid,
      port: registry.port,
    };
  }

  private async request<T>(
    registry: Registry,
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port: registry.port,
          method,
          path,
          headers: {
            "x-planning-canvas-token": registry.token,
            ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          },
          signal,
        },
        (res) => {
          let response = "";
          res.on("data", (chunk) => (response += chunk));
          res.on("end", () => {
            let parsed: { error?: string };
            try {
              parsed = JSON.parse(response) as { error?: string };
            } catch {
              parsed = { error: response || `HTTP ${res.statusCode}` };
            }
            if ((res.statusCode || 500) >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            else resolve(parsed as T);
          });
        },
      );
      req.on("error", reject);
      if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error("request timed out")));
      if (data) req.write(data);
      req.end();
    });
  }

  private browserUrl(registry: Registry) {
    return `http://127.0.0.1:${registry.port}/?token=${encodeURIComponent(registry.token)}`;
  }

  private async spawnRuntime(sessionId: string, token: string, topic: string, previous?: Registry) {
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
    const registry: Registry = {
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

  private rejectTerminal(state: PersistedState) {
    if (state.status !== "open") {
      throw new Error(`planning session is ${state.status} and cannot be resumed`);
    }
  }

  private async probe(registry: Registry) {
    const remote = await this.request<{ runtimeId?: string }>(
      registry,
      "GET",
      "/state",
      undefined,
      undefined,
      750,
    );
    if (remote.runtimeId !== registry.runtimeId) throw new Error("planning runtime identity mismatch");
  }

  private async withTakeoverLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const lock = this.paths(sessionId).takeover;
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        writeFileSync(lock, JSON.stringify({ pid: process.pid, clientId: this.clientId }), {
          flag: "wx",
          mode: 0o600,
        });
        break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
        try {
          const owner = JSON.parse(readFileSync(lock, "utf8")) as { pid?: unknown };
          if (typeof owner.pid !== "number") throw new Error("invalid takeover owner");
          process.kill(owner.pid, 0);
        } catch (ownerError) {
          if ((ownerError as NodeJS.ErrnoException).code !== "EPERM") {
            rmSync(lock, { recursive: true, force: true });
            continue;
          }
        }
        if (Date.now() >= deadline) throw new Error("timed out waiting for planning runtime takeover");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try {
      return await operation();
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }

  private async ensureLive(sessionId: string) {
    let persisted = this.readPersistedState(sessionId);
    this.rejectTerminal(persisted);
    let registry = this.readRegistry(sessionId);
    try {
      await this.probe(registry);
      return { registry, persisted, restarted: false };
    } catch {
      const failedRuntimeId = registry.runtimeId;
      const recovered = await this.withTakeoverLock(sessionId, async () => {
        persisted = this.readPersistedState(sessionId);
        this.rejectTerminal(persisted);
        registry = this.readRegistry(sessionId);
        try {
          await this.probe(registry);
          return { registry, persisted, restarted: registry.runtimeId !== failedRuntimeId };
        } catch {
          await this.runtime.retire(this.connection(registry));
          registry = await this.spawnRuntime(sessionId, registry.token, persisted.topic, registry);
          return { registry, persisted, restarted: true };
        }
      });
      if (recovered.restarted) this.openBrowser(this.browserUrl(recovered.registry));
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
    return { type: "started" as const, sessionId, topic, url };
  }

  async resume(sessionId: string) {
    const { registry, persisted, restarted } = await this.ensureLive(sessionId);
    const url = this.browserUrl(registry);
    if (!restarted) this.openBrowser(url);
    return { type: "resumed" as const, sessionId, topic: persisted.topic, url, restarted };
  }

  private acknowledgePriorDelivery(sessionId: string, registry: Registry) {
    if (registry.pendingDelivery?.clientId !== this.clientId) return registry;
    const acknowledged: Registry = {
      ...registry,
      acknowledgedSeq: Math.max(registry.acknowledgedSeq, registry.pendingDelivery.seq),
    };
    delete acknowledged.pendingDelivery;
    this.writeRegistry(sessionId, acknowledged);
    return acknowledged;
  }

  acknowledge(sessionId: string, event: CanvasEvent) {
    if (!event.seq) return;
    const registry = this.readRegistry(sessionId);
    if (registry.pendingDelivery?.seq !== event.seq) return;
    this.writeRegistry(sessionId, { ...registry, acknowledgedSeq: event.seq, pendingDelivery: undefined });
  }

  private async waitForEvent(sessionId: string, signal: AbortSignal | undefined, registry: Registry) {
    const delivery = this.acknowledgePriorDelivery(sessionId, registry);
    const event = await this.request<CanvasEvent>(
      delivery,
      "GET",
      `/wait?cursor=${delivery.acknowledgedSeq}`,
      undefined,
      signal,
    );
    if (event.seq) {
      this.writeRegistry(sessionId, {
        ...delivery,
        pendingDelivery: { seq: event.seq, clientId: this.clientId },
      });
    }
    return event;
  }

  async ask(sessionId: string, question: Question, signal?: AbortSignal) {
    const live = await this.ensureLive(sessionId);
    const registry = this.acknowledgePriorDelivery(sessionId, live.registry);
    await this.request(registry, "POST", "/question", question, signal);
    const event = await this.waitForEvent(sessionId, signal, registry);
    return live.restarted
      ? { ...event, restarted: true, url: this.browserUrl(registry) }
      : event;
  }

  async wait(sessionId: string, signal?: AbortSignal) {
    const live = await this.ensureLive(sessionId);
    const event = await this.waitForEvent(sessionId, signal, live.registry);
    return live.restarted
      ? { ...event, restarted: true, url: this.browserUrl(live.registry) }
      : event;
  }

  async artifact(sessionId: string, path: string, title?: string, signal?: AbortSignal) {
    const { registry } = await this.ensureLive(sessionId);
    return this.request<{ ok: boolean; id: string; path: string }>(
      registry,
      "POST",
      "/artifact",
      { path, title },
      signal,
    );
  }

  async close(sessionId: string) {
    const persisted = this.readPersistedState(sessionId);
    const registryFile = this.paths(sessionId).registry;
    if (!existsSync(registryFile)) {
      if (persisted.status === "open") throw new Error(`planning canvas connection not found: ${sessionId}`);
      return { type: "closed" as const, sessionId };
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
    if (existsSync(registryFile)) unlinkSync(registryFile);
    return { type: "closed" as const, sessionId };
  }

  async state(sessionId: string, signal?: AbortSignal) {
    const persisted = this.readPersistedState(sessionId);
    if (persisted.status !== "open") {
      const artifactFile = this.paths(sessionId).artifacts;
      const artifactStore = existsSync(artifactFile)
        ? JSON.parse(readFileSync(artifactFile, "utf8")) as { artifacts?: unknown[] }
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
    return this.request<Record<string, unknown>>(registry, "GET", "/state", undefined, signal);
  }
}
