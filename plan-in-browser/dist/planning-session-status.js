export function planningSessionStatusAfterStop(currentStatus, stopStatus) {
    return currentStatus === "cancelled" ? "cancelled" : stopStatus;
}
