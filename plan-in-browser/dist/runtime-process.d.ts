import { type ChildProcess } from "node:child_process";
export type PlanningRuntimeStart = {
    sessionId: string;
    token: string;
    dir: string;
    topic: string;
    cwd: string;
};
export type PlanningRuntimeConnection = {
    pid: number;
    port: number;
};
export interface PlanningRuntime {
    start(input: PlanningRuntimeStart): Promise<PlanningRuntimeConnection>;
}
export declare class ChildProcessPlanningRuntime implements PlanningRuntime {
    protected readonly children: Map<string, ChildProcess>;
    protected argumentsFor(input: PlanningRuntimeStart): string[];
    start(input: PlanningRuntimeStart): Promise<PlanningRuntimeConnection>;
}
/** Test adapter that can deterministically put an owned runtime into its idle state. */
export declare class ControlledPlanningRuntime extends ChildProcessPlanningRuntime {
    protected argumentsFor(input: PlanningRuntimeStart): string[];
    idle(sessionId: string | undefined): Promise<void>;
}
