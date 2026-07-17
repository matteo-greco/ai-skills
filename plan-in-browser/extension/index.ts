import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
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
            ? "User cancelled the browser planning session."
            : JSON.stringify(event);
      return { content: [{ type: "text", text: summary }], details: { ...event, url } };
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
      return {
        content: [{ type: "text", text: `Closed planning canvas ${closedSession}.` }],
        details: closed,
      };
    },
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
  });
}
