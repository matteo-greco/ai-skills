import type { CanvasEvent, PlanningSessionClient, Question } from "./session.js";

export type PlanningSessionEntry = {
  sessionId: string;
  url?: string;
  status: "active" | "closed";
};

export type PlanningSessionBranchEntry = {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
};

type PlanningSessionOperations = Pick<PlanningSessionClient, "start" | "resume" | "ask" | "artifact" | "close">;

type OwnershipState =
  | { kind: "none" }
  | { kind: "recoverable"; sessionId: string; url?: string }
  | { kind: "attached"; sessionId: string; url: string };

export type AskResult = {
  event: CanvasEvent;
  sessionId: string;
  url: string;
  attachment?: "started" | "resumed";
};

export type RestoreResult =
  | { status: "none" | "closed" | "invalid" }
  | { status: "attached"; sessionId: string; url: string; restarted: boolean }
  | { status: "recoverable"; sessionId: string; url?: string; error: unknown };

export type ResumeResult = {
  type: "resumed";
  sessionId: string;
  topic: string;
  url: string;
  restarted: boolean;
};

export type ArtifactResult = { path: string; sessionId: string; url: string };
export type CloseResult =
  | { closed: false }
  | { closed: true; sessionId: string; result: { type: "closed"; sessionId: string } };

export type PlanningSessionOwner = {
  restore(branch: readonly PlanningSessionBranchEntry[]): Promise<RestoreResult>;
  ask(question: Question, signal?: AbortSignal): Promise<AskResult>;
  resume(sessionId?: string): Promise<ResumeResult>;
  artifact(path: string, title?: string, signal?: AbortSignal): Promise<ArtifactResult>;
  close(): Promise<CloseResult>;
};

export class NoRecoverablePlanningSessionError extends Error {
  constructor() {
    super("No recoverable planning canvas is recorded in this Pi session.");
    this.name = "NoRecoverablePlanningSessionError";
  }
}

export function createPlanningSessionOwner({
  client,
  record,
}: {
  client: PlanningSessionOperations;
  record(entry: PlanningSessionEntry): void;
}): PlanningSessionOwner {
  let state: OwnershipState = { kind: "none" };

  async function attach(sessionId: string) {
    const resumed = await client.resume(sessionId);
    state = { kind: "recoverable", sessionId, url: resumed.url };
    record({ sessionId, url: resumed.url, status: "active" });
    state = { kind: "attached", sessionId, url: resumed.url };
    return resumed;
  }

  return {
    async restore(branch) {
      state = { kind: "none" };
      const saved = [...branch].reverse().find(
        (entry) => entry.type === "custom" && entry.customType === "planning-canvas-session",
      );
      if (!saved) return { status: "none" };
      const data = saved.data as Partial<PlanningSessionEntry> | null;
      if (
        !data
        || typeof data.sessionId !== "string"
        || (data.status !== "active" && data.status !== "closed")
        || (data.url !== undefined && typeof data.url !== "string")
      ) {
        return { status: "invalid" };
      }
      if (data.status === "closed") return { status: "closed" };

      state = { kind: "recoverable", sessionId: data.sessionId, ...(data.url ? { url: data.url } : {}) };
      try {
        const resumed = await attach(data.sessionId);
        return { status: "attached", sessionId: data.sessionId, url: resumed.url, restarted: resumed.restarted };
      } catch (error) {
        return { status: "recoverable", sessionId: data.sessionId, ...(data.url ? { url: data.url } : {}), error };
      }
    },

    async ask(question, signal) {
      let attachment: AskResult["attachment"];
      if (state.kind === "none") {
        const started = await client.start(question.topic || question.question);
        state = { kind: "recoverable", sessionId: started.sessionId, url: started.url };
        record({ sessionId: started.sessionId, url: started.url, status: "active" });
        state = { kind: "attached", sessionId: started.sessionId, url: started.url };
        attachment = "started";
      } else if (state.kind === "recoverable") {
        await attach(state.sessionId);
        attachment = "resumed";
      }

      if (state.kind !== "attached") throw new Error("Planning session is not attached.");
      const event = await client.ask(state.sessionId, question, signal);
      if (event.restarted && event.url) {
        state = { kind: "recoverable", sessionId: state.sessionId, url: event.url };
        record({ sessionId: state.sessionId, url: event.url, status: "active" });
        state = { kind: "attached", sessionId: state.sessionId, url: event.url };
      }
      return { event, sessionId: state.sessionId, url: state.url, ...(attachment ? { attachment } : {}) };
    },

    async resume(sessionId) {
      const target = sessionId || (state.kind === "none" ? undefined : state.sessionId);
      if (!target) throw new NoRecoverablePlanningSessionError();
      return attach(target);
    },

    async artifact(path, title, signal) {
      if (state.kind !== "attached") throw new Error("No planning canvas is active.");
      const owned = state;
      const artifact = await client.artifact(owned.sessionId, path, title, signal);
      return { path: artifact.path, sessionId: owned.sessionId, url: owned.url };
    },

    async close() {
      if (state.kind === "none") return { closed: false };
      const owned = state;
      const result = await client.close(owned.sessionId);
      record({ sessionId: owned.sessionId, ...(owned.url ? { url: owned.url } : {}), status: "closed" });
      state = { kind: "none" };
      return { closed: true, sessionId: owned.sessionId, result };
    },
  };
}
