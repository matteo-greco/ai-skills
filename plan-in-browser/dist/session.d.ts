import { type PlanningRuntime } from "./runtime-process.js";
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
    options?: Array<{
        id: string;
        label: string;
        detail?: string;
    }>;
    recommendedOptionIds?: string[];
    recommendation?: string;
};
type ClientOptions = {
    root?: string;
    cwd?: string;
    openBrowser?: (url: string) => void;
    runtime?: PlanningRuntime;
};
export declare class PlanningSessionClient {
    readonly root: string;
    readonly cwd: string;
    readonly openBrowser: (url: string) => void;
    readonly runtime: PlanningRuntime;
    constructor(options?: ClientOptions);
    private paths;
    private readRegistry;
    private writeRegistry;
    private request;
    private browserUrl;
    private spawnRuntime;
    private readPersistedState;
    private ensureLive;
    start(topic?: string): Promise<{
        type: "started";
        sessionId: string;
        topic: string;
        url: string;
    }>;
    resume(sessionId: string): Promise<{
        type: "resumed";
        sessionId: string;
        topic: string | undefined;
        url: string;
        restarted: boolean;
    }>;
    private waitForEvent;
    ask(sessionId: string, question: Question, signal?: AbortSignal): Promise<CanvasEvent>;
    wait(sessionId: string, signal?: AbortSignal): Promise<CanvasEvent>;
    artifact(sessionId: string, path: string, title?: string, signal?: AbortSignal): Promise<{
        ok: boolean;
        id: string;
        path: string;
    }>;
    close(sessionId: string): Promise<{
        type: "closed";
        sessionId: string;
    }>;
    state(sessionId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
}
export {};
