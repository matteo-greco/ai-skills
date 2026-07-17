import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve symlinks because the extension is commonly linked into ~/.pi/agent/extensions.
const here = dirname(realpathSync(fileURLToPath(import.meta.url)));
const cli = join(here, "..", "canvas.mjs");

const OptionSchema = Type.Object({
  id: Type.String({ description: "Stable option identity returned by the canvas" }),
  label: Type.String({ description: "Human-readable option label" }),
  detail: Type.Optional(Type.String({ description: "Trade-off or consequence shown below the label" })),
});

const QuestionSchema = Type.Object({
  topic: Type.Optional(Type.String({ description: "Short session topic; used when opening the first canvas" })),
  id: Type.String({ description: "Stable question identity" }),
  question: Type.String({ description: "One clear, specific question for the user" }),
  context: Type.Optional(Type.String({ description: "Why this decision matters now" })),
  answerType: StringEnum(["single", "multi", "free", "confirm"] as const),
  options: Type.Optional(Type.Array(OptionSchema)),
  recommendedOptionIds: Type.Optional(Type.Array(Type.String())),
  recommendation: Type.Optional(Type.String({ description: "Recommended answer and concise reasoning" })),
});

type CanvasEvent = {
  type: "started" | "answer" | "edit" | "cancel" | "timeout" | "closed";
  sessionId?: string;
  questionId?: string;
  selectedOptionIds?: string[];
  note?: string;
  reason?: string;
  url?: string;
};

function runCli(args: string[], signal?: AbortSignal): Promise<CanvasEvent> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("Planning canvas question cancelled"));
      if (code !== 0) return reject(new Error(stderr.trim() || `planning canvas exited ${code}`));
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`Invalid planning canvas response: ${stdout || stderr}`));
      }
    });
  });
}

export default function planningCanvas(pi: ExtensionAPI) {
  let sessionId: string | undefined;
  let url: string | undefined;
  const registeredArtifacts = new Set<string>();

  async function registerArtifact(path: string, cwd: string, title?: string, signal?: AbortSignal) {
    if (!sessionId) throw new Error("No planning canvas is active.");
    const absolutePath = resolve(cwd, path);
    if (registeredArtifacts.has(absolutePath) && !title) return absolutePath;
    await runCli(
      [
        "artifact",
        "--session",
        sessionId,
        "--path",
        absolutePath,
        ...(title ? ["--title", title] : []),
      ],
      signal,
    );
    registeredArtifacts.add(absolutePath);
    return absolutePath;
  }

  pi.registerTool({
    name: "planning_canvas",
    label: "Planning Canvas",
    description:
      "Ask one human-in-the-loop planning question in an interactive browser canvas and wait for the user's answer. Use instead of asking planning questions in terminal prose when the plan-in-browser skill is active.",
    promptSnippet: "Present one planning decision in the browser and wait for its answer",
    promptGuidelines: [
      "When plan-in-browser is active, use planning_canvas for every human decision and never ask that decision in assistant prose.",
      "Treat planning_canvas tool results as authoritative user feedback and continue the source planning discipline from them.",
    ],
    parameters: QuestionSchema,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!sessionId) {
        const started = await runCli(["start", "--topic", params.topic || params.question], signal);
        sessionId = started.sessionId;
        url = started.url;
        if (url) ctx.ui.notify(`Planning canvas: ${url}`, "info");
      }

      ctx.ui.setStatus("planning-canvas", "waiting in browser · model idle");
      ctx.ui.setWorkingIndicator({ frames: [] });
      let event: CanvasEvent;
      try {
        event = await runCli(
          ["ask", "--session", sessionId!, "--json", JSON.stringify(params)],
          signal,
        );
      } finally {
        ctx.ui.setWorkingIndicator();
        ctx.ui.setStatus("planning-canvas", undefined);
      }
      const summary =
        event.type === "answer" || event.type === "edit"
          ? `User ${event.type === "edit" ? "revised" : "answered"} ${event.questionId}: selected ${JSON.stringify(event.selectedOptionIds || [])}${event.note ? `; note: ${event.note}` : ""}`
          : event.type === "cancel"
            ? event.reason === "idle"
              ? "Planning canvas closed after two hours without browser activity."
              : "User cancelled the browser planning session."
            : JSON.stringify(event);
      return { content: [{ type: "text", text: summary }], details: { ...event, url } };
    },
  });

  pi.registerTool({
    name: "planning_canvas_artifact",
    label: "Show Planning Artifact",
    description:
      "Show a local text artifact in the active browser planning canvas. Use when a planning workflow changes a file through bash or another mechanism that bypasses the write/edit tools.",
    promptSnippet: "Register a local text artifact for live display in the planning canvas",
    promptGuidelines: [
      "When plan-in-browser is active, use planning_canvas_artifact for planning artifacts changed through bash or another mechanism that bypasses write/edit; successful write/edit calls are tracked automatically.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Artifact path, absolute or relative to the project directory" }),
      title: Type.Optional(Type.String({ description: "Optional display title; the relative path is used by default" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const absolutePath = await registerArtifact(params.path, ctx.cwd, params.title, signal);
      return {
        content: [{ type: "text", text: `Showing planning artifact ${absolutePath}.` }],
        details: { path: absolutePath, url },
      };
    },
  });

  pi.registerTool({
    name: "planning_canvas_close",
    label: "Close Planning Canvas",
    description: "Close the active browser planning canvas after its source workflow completes or is cancelled.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      if (!sessionId) {
        return { content: [{ type: "text", text: "No planning canvas is active." }], details: {} };
      }
      const closed = await runCli(["close", "--session", sessionId]);
      const closedSession = sessionId;
      sessionId = undefined;
      url = undefined;
      registeredArtifacts.clear();
      return {
        content: [{ type: "text", text: `Closed planning canvas ${closedSession}.` }],
        details: closed,
      };
    },
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!sessionId || event.isError || (event.toolName !== "write" && event.toolName !== "edit")) return;
    const input = event.input as { path?: unknown };
    if (typeof input.path !== "string") return;
    try {
      await registerArtifact(input.path, ctx.cwd, undefined, ctx.signal);
    } catch (error) {
      // Artifact display must never turn a successful file edit into a failed tool call.
      ctx.ui.notify(`Could not show planning artifact: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }
  });

  pi.on("session_shutdown", async () => {
    if (!sessionId) return;
    try {
      await runCli(["close", "--session", sessionId]);
    } catch {
      // The server may already have been closed from the browser.
    }
    sessionId = undefined;
    url = undefined;
    registeredArtifacts.clear();
  });
}
