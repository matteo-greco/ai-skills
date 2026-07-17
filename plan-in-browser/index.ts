import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  createPlanningSessionOwner,
  NoRecoverablePlanningSessionError,
} from "./dist/planning-session-owner.js";
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function registerPlanningCanvas(pi: ExtensionAPI, client: PlanningSession) {
  const owner = createPlanningSessionOwner({
    client,
    record(entry) {
      pi.appendEntry("planning-canvas-session", entry);
    },
  });

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
      ctx.ui.setStatus("planning-canvas", "waiting in browser · model idle");
      ctx.ui.setWorkingIndicator({ frames: [] });
      let asked;
      try {
        asked = await owner.ask(params, signal);
      } finally {
        ctx.ui.setWorkingIndicator();
        ctx.ui.setStatus("planning-canvas", undefined);
      }
      if (asked.attachment === "started") ctx.ui.notify(`Planning canvas: ${asked.url}`, "info");
      if (asked.attachment === "resumed") ctx.ui.notify(`Recovered planning canvas: ${asked.url}`, "warning");
      if (asked.event.restarted && asked.event.url) {
        ctx.ui.notify(`Recovered planning canvas: ${asked.event.url}`, "warning");
      }
      const event: CanvasEvent = asked.event;
      const summary =
        event.type === "answer" || event.type === "edit"
          ? `User ${event.type === "edit" ? "revised" : "answered"} ${event.questionId}: selected ${JSON.stringify(event.selectedOptionIds || [])}${event.note ? `; note: ${event.note}` : ""}`
          : event.type === "idle"
            ? "Planning canvas paused after two hours without browser activity; its persisted session can be resumed."
            : event.type === "cancel"
              ? "User cancelled the browser planning session."
              : JSON.stringify(event);
      return {
        content: [{ type: "text" as const, text: summary }],
        details: { ...event, sessionId: asked.sessionId, url: asked.url },
      };
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const resumed = await owner.resume(params.sessionId);
      ctx.ui.notify(`Planning canvas resumed: ${resumed.url}`, "info");
      return {
        content: [{ type: "text" as const, text: `Resumed planning canvas ${resumed.sessionId}${resumed.restarted ? " with a restarted server" : ""}.` }],
        details: resumed,
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
    async execute(_toolCallId, params, signal) {
      const artifact = await owner.artifact(params.path, params.title, signal);
      return {
        content: [{ type: "text" as const, text: `Showing planning artifact ${artifact.path}.` }],
        details: { path: artifact.path, url: artifact.url },
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
      const closed = await owner.close();
      if (!closed.closed) {
        return { content: [{ type: "text" as const, text: "No planning canvas is active." }], details: {} };
      }
      return {
        content: [{ type: "text" as const, text: `Closed planning canvas ${closed.sessionId}.` }],
        details: closed.result,
      };
    },
  });

  pi.registerCommand("planning-canvas-resume", {
    description: "Resume the planning canvas saved in this Pi session, or a specified canvas session id",
    handler: async (args, ctx) => {
      try {
        const resumed = await owner.resume(args.trim() || undefined);
        ctx.ui.notify(
          `Planning canvas ${resumed.restarted ? "restarted" : "reopened"}: ${resumed.url}`,
          "info",
        );
      } catch (error) {
        const noRecoverableSession = error instanceof NoRecoverablePlanningSessionError;
        const message = errorMessage(error);
        ctx.ui.notify(
          noRecoverableSession ? message : `Could not resume planning canvas: ${message}`,
          noRecoverableSession ? "warning" : "error",
        );
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const restored = await owner.restore(ctx.sessionManager.getBranch());
    if (restored.status === "attached") {
      ctx.ui.notify(
        `Recovered planning canvas ${restored.restarted ? "after restarting its server" : ""}: ${restored.url}`,
        "info",
      );
    } else if (restored.status === "recoverable") {
      ctx.ui.notify(
        `Planning canvas ${restored.sessionId} is recoverable with /planning-canvas-resume: ${errorMessage(restored.error)}`,
        "warning",
      );
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || (event.toolName !== "write" && event.toolName !== "edit")) return;
    const input = event.input as { path?: unknown };
    if (typeof input.path !== "string") return;
    try {
      await owner.artifact(input.path, undefined, ctx.signal);
    } catch (error) {
      // Artifact display must never turn a successful file edit into a failed tool call.
      ctx.ui.notify(`Could not show planning artifact: ${errorMessage(error)}`, "warning");
    }
  });
}

export function createPlanningCanvasExtension(
  createClient: () => PlanningSession = () => new PlanningSessionClient(),
) {
  return (pi: ExtensionAPI) => registerPlanningCanvas(pi, createClient());
}

export default createPlanningCanvasExtension();
