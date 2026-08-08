export type EnvironmentReviewActionState = "idle" | "navigating" | "redetecting";

export type EnvironmentReviewActionEvent =
  | { type: "begin"; action: Exclude<EnvironmentReviewActionState, "idle"> }
  | { type: "step-entered" }
  | { type: "finished" };

export function transitionEnvironmentReviewAction(
  state: EnvironmentReviewActionState,
  event: EnvironmentReviewActionEvent,
): EnvironmentReviewActionState {
  if (event.type === "begin") {
    return state === "idle" ? event.action : state;
  }
  return "idle";
}

export function isEnvironmentReviewActionInFlight(
  state: EnvironmentReviewActionState,
): boolean {
  return state !== "idle";
}
