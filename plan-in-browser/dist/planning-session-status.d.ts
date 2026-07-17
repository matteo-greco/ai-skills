export type PlanningSessionStopStatus = "closed" | "idle";
export type StoppedPlanningSessionStatus = "cancelled" | PlanningSessionStopStatus;
export declare function planningSessionStatusAfterStop(currentStatus: string | undefined, stopStatus: PlanningSessionStopStatus): StoppedPlanningSessionStatus;
