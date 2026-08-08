import assert from "node:assert/strict";
import test from "node:test";
import { environmentReviewActionsDisabled } from "./EnvironmentReviewScreen";

test("environment review disables every navigation action while its real action gate is busy", () => {
  assert.equal(environmentReviewActionsDisabled(false, false), false);
  assert.equal(environmentReviewActionsDisabled(true, false), true);
  assert.equal(environmentReviewActionsDisabled(false, true), true);
  assert.equal(environmentReviewActionsDisabled(true, true), true);
});
