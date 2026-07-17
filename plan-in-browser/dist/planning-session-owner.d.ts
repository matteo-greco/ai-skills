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
export type AskResult = {
    event: CanvasEvent;
    sessionId: string;
    url: string;
    attachment?: "started" | "resumed";
};
export type RestoreResult = {
    status: "none" | "closed" | "invalid";
} | {
    status: "attached";
    sessionId: string;
    url: string;
    restarted: boolean;
} | {
    status: "recoverable";
    sessionId: string;
    url?: string;
    error: unknown;
};
export type ResumeResult = {
    type: "resumed";
    sessionId: string;
    topic: string;
    url: string;
    restarted: boolean;
};
export type ArtifactResult = {
    path: string;
    sessionId: string;
    url: string;
};
export type CloseResult = {
    closed: false;
} | {
    closed: true;
    sessionId: string;
    result: {
        type: "closed";
        sessionId: string;
    };
};
export type PlanningSessionOwner = {
    restore(branch: readonly PlanningSessionBranchEntry[]): Promise<RestoreResult>;
    ask(question: Question, signal?: AbortSignal): Promise<AskResult>;
    resume(sessionId?: string): Promise<ResumeResult>;
    artifact(path: string, title?: string, signal?: AbortSignal): Promise<ArtifactResult>;
    close(): Promise<CloseResult>;
};
export declare class NoRecoverablePlanningSessionError extends Error {
    constructor();
}
export declare function createPlanningSessionOwner({ client, record, }: {
    client: PlanningSessionOperations;
    record(entry: PlanningSessionEntry): void;
}): PlanningSessionOwner;
export {};
