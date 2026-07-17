import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { resolve } from "node:path";
import { PlanningSessionClient, type CanvasEvent } from "./dist/session.js";

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

type PlanningSession = Pick<PlanningSessionClient, "start" | "resume" | "ask" | "artifact" | "close">;

function registerPlanningCanvas(pi: ExtensionAPI, client: PlanningSession) {
  const sessionEntryType = "planning-canvas-session";
  let sessionId: string | undefined;
  let recoverableSessionId: string | undefined;
  let url: string | undefined;
  const registeredArtifacts = new Set<string>();

  function rememberSession(status: "active" | "closed") {
    if (!sessionId) return;
    pi.appendEntry(sessionEntryType, { sessionId, url, status });
  }

  async function resumeSession(id: string) {
    const resumed = await client.resume(id);
    sessionId = id;
    recoverableSessionId = id;
    url = resumed.url;
    registeredArtifacts.clear();
    return resumed;
  }

  async function registerArtifact(path: string, cwd: string, title?: string, signal?: AbortSignal) {
    if (!sessionId) throw new Error("No planning canvas is active.");
    const absolutePath = resolve(cwd, path);
    if (registeredArtifacts.has(absolutePath) && !title) return absolutePath;
    await client.artifact(sessionId, absolutePath, title, signal);
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
      "If a plan-in-browser canvas is interrupted and automatic recovery does not succeed, call planning_canvas_resume before continuing.",
    ],
    parameters: QuestionSchema,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!sessionId) {
        const started = await client.start(params.topic || params.question);
        sessionId = started.sessionId;
        recoverableSessionId = sessionId;
        url = started.url;
        rememberSession("active");
        if (url) ctx.ui.notify(`Planning canvas: ${url}`, "info");
      }

      ctx.ui.setStatus("planning-canvas", "waiting in browser · model idle");
      ctx.ui.setWorkingIndicator({ frames: [] });
      let event: CanvasEvent;
      try {
        event = await client.ask(sessionId!, params, signal);
      } finally {
        ctx.ui.setWorkingIndicator();
        ctx.ui.setStatus("planning-canvas", undefined);
      }
      if (event.restarted && event.url) {
        url = event.url;
        rememberSession("active");
        ctx.ui.notify(`Recovered planning canvas: ${event.url}`, "warning");
      }
      const summary =
        event.type === "answer" || event.type === "edit"
          ? `User ${event.type === "edit" ? "revised" : "answered"} ${event.questionId}: selected ${JSON.stringify(event.selectedOptionIds || [])}${event.note ? `; note: ${event.note}` : ""}`
          : event.type === "idle"
            ? "Planning canvas paused after two hours without browser activity; its persisted session can be resumed."
            : event.type === "cancel"
              ? "User cancelled the browser planning session."
              : JSON.stringify(event);
      return { content: [{ type: "text", text: summary }], details: { ...event, sessionId, url } };
    },
  });

  pi.registerTool({
    name: "planning_canvas_resume",
    label: "Resume Planning Canvas",
    description:
      "Resume the browser planning canvas associated with this Pi session after an extension reload, idle shutdown, or server crash.",
    promptSnippet: "Resume a persisted browser planning canvas after an interruption",
    parameters: Type.Object({
      sessionId: Type.Optional(Type.String({ description: "Canvas session id; defaults to the canvas saved in this Pi session" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const target = params.sessionId || sessionId || recoverableSessionId;
      if (!target) throw new Error("No recoverable planning canvas is recorded in this Pi session.");
      const resumed = await resumeSession(target);
      rememberSession("active");
      if (url) ctx.ui.notify(`Planning canvas resumed: ${url}`, "info");
      return {
        content: [{ type: "text", text: `Resumed planning canvas ${target}${resumed.restarted ? " with a restarted server" : ""}.` }],
        details: { ...resumed, sessionId: target, url },
      };
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
      const target = sessionId || recoverableSessionId;
      if (!target) {
        return { content: [{ type: "text", text: "No planning canvas is active." }], details: {} };
      }
      const closed = await client.close(target);
      sessionId = target;
      const closedSession = target;
      rememberSession("closed");
      sessionId = undefined;
      recoverableSessionId = undefined;
      url = undefined;
      registeredArtifacts.clear();
      return {
        content: [{ type: "text", text: `Closed planning canvas ${closedSession}.` }],
        details: closed,
      };
    },
  });

  pi.registerCommand("planning-canvas-resume", {
    description: "Resume the planning canvas saved in this Pi session, or a specified canvas session id",
    handler: async (args, ctx) => {
      const target = args.trim() || sessionId || recoverableSessionId;
      if (!target) {
        ctx.ui.notify("No recoverable planning canvas is recorded in this Pi session.", "warning");
        return;
      }
      try {
        const resumed = await resumeSession(target);
        rememberSession("active");
        ctx.ui.notify(
          `Planning canvas ${resumed.restarted ? "restarted" : "reopened"}: ${resumed.url}`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(`Could not resume planning canvas: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionId = undefined;
    recoverableSessionId = undefined;
    url = undefined;
    registeredArtifacts.clear();

    const saved = [...ctx.sessionManager.getBranch()].reverse().find(
      (entry) => entry.type === "custom" && entry.customType === sessionEntryType,
    );
    if (!saved || saved.type !== "custom") return;
    const data = saved.data as { sessionId?: unknown; status?: unknown } | undefined;
    if (data?.status !== "active" || typeof data.sessionId !== "string") return;
    recoverableSessionId = data.sessionId;

    try {
      const resumed = await resumeSession(data.sessionId);
      ctx.ui.notify(
        `Recovered planning canvas ${resumed.restarted ? "after restarting its server" : ""}: ${resumed.url}`,
        "info",
      );
    } catch (error) {
      ctx.ui.notify(
        `Planning canvas ${data.sessionId} is recoverable with /planning-canvas-resume: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
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
    // Keep active canvases recoverable across Pi reloads, resumes, and clean exits.
    // The server's idle timeout handles sessions that are never resumed.
    sessionId = undefined;
    url = undefined;
    registeredArtifacts.clear();
  });
}

export function createPlanningCanvasExtension(
  createClient: () => PlanningSession = () => new PlanningSessionClient(),
) {
  return (pi: ExtensionAPI) => registerPlanningCanvas(pi, createClient());
}

export default createPlanningCanvasExtension();
