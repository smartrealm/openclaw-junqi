import assert from "node:assert/strict";
import test from "node:test";
import {
  isEnvironmentReviewActionInFlight,
  transitionEnvironmentReviewAction,
  type EnvironmentReviewActionState,
} from "./environmentReviewAction";
import {
  backSetupNavigation,
  transitionSetupNavigation,
  type SetupNavigationState,
} from "@/stores/setup-navigation";

test("environment review releases its action lock across a next-back-next round trip", () => {
  let navigation: SetupNavigationState = {
    setupStep: "environment-review",
    setupHistory: ["welcome"],
  };
  let state: EnvironmentReviewActionState = "idle";

  state = transitionEnvironmentReviewAction(state, { type: "begin", action: "navigating" });
  navigation = transitionSetupNavigation(navigation, "storage", "push");
  state = transitionEnvironmentReviewAction(state, { type: "step-entered" });

  navigation = backSetupNavigation(navigation);
  state = transitionEnvironmentReviewAction(state, { type: "step-entered" });

  assert.deepEqual(navigation, {
    setupStep: "environment-review",
    setupHistory: ["welcome"],
  });
  assert.equal(state, "idle");

  state = transitionEnvironmentReviewAction(state, { type: "begin", action: "navigating" });
  navigation = transitionSetupNavigation(navigation, "storage", "push");

  assert.equal(state, "navigating");
  assert.deepEqual(navigation, {
    setupStep: "storage",
    setupHistory: ["welcome", "environment-review"],
  });
});

test("environment review rejects duplicate actions until the current action finishes", () => {
  let state: EnvironmentReviewActionState = "idle";
  state = transitionEnvironmentReviewAction(state, { type: "begin", action: "redetecting" });
  state = transitionEnvironmentReviewAction(state, { type: "begin", action: "navigating" });

  assert.equal(state, "redetecting");
  assert.equal(isEnvironmentReviewActionInFlight(state), true);

  state = transitionEnvironmentReviewAction(state, { type: "finished" });
  assert.equal(isEnvironmentReviewActionInFlight(state), false);
});
