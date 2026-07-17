import { type ChildProcess } from "node:child_process";
export type PlanningRuntimeStart = {
    sessionId: string;
    token: string;
    runtimeId: string;
    sessionDir: string;
    topic: string;
    cwd: string;
};
export type PlanningRuntimeConnection = {
    sessionId: string;
    runtimeId: string;
    processStart: string;
    pid: number;
    port: number;
};
export interface PlanningRuntime {
    start(input: PlanningRuntimeStart): Promise<PlanningRuntimeConnection>;
    retire(connection: PlanningRuntimeConnection): Promise<void>;
}
export declare class ChildProcessPlanningRuntime implements PlanningRuntime {
    protected readonly children: Map<string, ChildProcess>;
    protected argumentsFor(input: PlanningRuntimeStart): string[];
    start(input: PlanningRuntimeStart): Promise<PlanningRuntimeConnection>;
    protected owns(connection: PlanningRuntimeConnection): Promise<boolean>;
    protected signal(connection: PlanningRuntimeConnection, signal: NodeJS.Signals): true;
    retire(connection: PlanningRuntimeConnection): Promise<void>;
}
/** Test adapter with deterministic controls for runtime exits and hangs. */
export declare class ControlledPlanningRuntime extends ChildProcessPlanningRuntime {
    private childForSession;
    pid(sessionId: string | undefined): number | undefined;
    idle(sessionId: string | undefined): Promise<void>;
    hang(sessionId: string | undefined): void;
    exit(sessionId: string | undefined): Promise<void>;
}
