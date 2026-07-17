export type PlanningSessionStopStatus = "closed" | "idle";
export type StoppedPlanningSessionStatus = "cancelled" | PlanningSessionStopStatus;

export function planningSessionStatusAfterStop(
  currentStatus: string | undefined,
  stopStatus: PlanningSessionStopStatus,
): StoppedPlanningSessionStatus {
  return currentStatus === "cancelled" ? "cancelled" : stopStatus;
}
