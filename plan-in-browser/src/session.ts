import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

type Registry = {
  sessionId: string;
  topic?: string;
  token: string;
  port: number;
  pid: number;
  cursor?: number;
  status?: string;
};

type PersistedState = {
  topic?: string;
  status?: string;
};

type ClientOptions = {
  root?: string;
  cwd?: string;
  openBrowser?: (url: string) => void;
};

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, "..");

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

  constructor(options: ClientOptions = {}) {
    this.root = options.root || process.env.PLANNING_CANVAS_HOME || join(homedir(), ".cache", "planning-canvas");
    this.cwd = options.cwd || process.cwd();
    this.openBrowser = options.openBrowser || systemBrowserOpener;
  }

  private paths(sessionId: string) {
    const dir = join(this.root, sessionId);
    return { dir, registry: join(dir, "registry.json"), state: join(dir, "state.json") };
  }

  private readRegistry(sessionId: string): Registry {
    const { registry } = this.paths(sessionId);
    if (!existsSync(registry)) throw new Error(`planning canvas session not found: ${sessionId}`);
    return JSON.parse(readFileSync(registry, "utf8")) as Registry;
  }

  private writeRegistry(sessionId: string, registry: Registry) {
    const file = this.paths(sessionId).registry;
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600 });
    renameSync(temporary, file);
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

  private async spawnRuntime(sessionId: string, token: string, topic: string): Promise<Registry> {
    const { dir, registry: registryFile } = this.paths(sessionId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const child = spawn(
      process.execPath,
      [
        join(skillRoot, "server.mjs"),
        "--session",
        sessionId,
        "--token",
        token,
        "--dir",
        dir,
        "--topic",
        topic,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"], cwd: this.cwd },
    );
    if (!child.pid) throw new Error("planning canvas server failed to start");

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
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.stdout.on("data", (chunk) => {
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
    let previous: Partial<Registry> = {};
    if (existsSync(registryFile)) {
      try {
        previous = JSON.parse(readFileSync(registryFile, "utf8")) as Partial<Registry>;
      } catch {
        // Replace a corrupt connection registry.
      }
    }
    const registry: Registry = {
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

  private readPersistedState(sessionId: string): PersistedState {
    const { state } = this.paths(sessionId);
    if (!existsSync(state)) throw new Error(`planning canvas state not found: ${sessionId}`);
    return JSON.parse(readFileSync(state, "utf8")) as PersistedState;
  }

  private async ensureLive(sessionId: string) {
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
    } catch {
      registry = await this.spawnRuntime(
        sessionId,
        registry.token,
        persisted.topic || registry.topic || "Planning session",
      );
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
    return { type: "started" as const, sessionId, topic, url };
  }

  async resume(sessionId: string) {
    const { registry, persisted, restarted } = await this.ensureLive(sessionId);
    const url = this.browserUrl(registry);
    if (!restarted) this.openBrowser(url);
    return { type: "resumed" as const, sessionId, topic: persisted.topic, url, restarted };
  }

  private async waitForEvent(sessionId: string, signal: AbortSignal | undefined, registry: Registry) {
    const event = await this.request<CanvasEvent>(
      registry,
      "GET",
      `/wait?cursor=${registry.cursor || 0}`,
      undefined,
      signal,
    );
    if (event.seq) this.writeRegistry(sessionId, { ...registry, cursor: event.seq });
    return event;
  }

  async ask(sessionId: string, question: Question, signal?: AbortSignal) {
    const live = await this.ensureLive(sessionId);
    await this.request(live.registry, "POST", "/question", question, signal);
    const event = await this.waitForEvent(sessionId, signal, live.registry);
    return live.restarted
      ? { ...event, restarted: true, url: this.browserUrl(live.registry) }
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
    let registry = this.readRegistry(sessionId);
    const persisted = this.readPersistedState(sessionId);

    if (persisted.status !== "closed") {
      let runtimeIsLive = false;
      try {
        await this.request(registry, "GET", "/state", undefined, undefined, 750);
        runtimeIsLive = true;
      } catch {
        // A non-terminal planning session must recover so the runtime remains
        // the sole writer of its durable terminal status.
      }

      if (!runtimeIsLive && persisted.status !== "cancelled") {
        registry = await this.spawnRuntime(
          sessionId,
          registry.token,
          persisted.topic || registry.topic || "Planning session",
        );
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
        if (!reachedTerminalState) throw new Error("planning canvas runtime did not close");
      }
    }

    this.writeRegistry(sessionId, { ...registry, status: "closed" });
    return { type: "closed" as const, sessionId };
  }

  async state(sessionId: string, signal?: AbortSignal) {
    const { registry } = await this.ensureLive(sessionId);
    return this.request<Record<string, unknown>>(registry, "GET", "/state", undefined, signal);
  }
}
