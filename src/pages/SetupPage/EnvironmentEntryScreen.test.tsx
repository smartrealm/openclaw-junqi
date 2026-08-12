import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupFlow } from "@/hooks/useSetupFlow";
import {
  EnvironmentEntryScreen,
  environmentReviewActionsDisabled,
  resetEnvironmentEntryNavigationLock,
} from "./EnvironmentEntryScreen";

test("environment review disables every navigation action while its real action gate is busy", () => {
  assert.equal(environmentReviewActionsDisabled(false, false), false);
  assert.equal(environmentReviewActionsDisabled(true, false), true);
  assert.equal(environmentReviewActionsDisabled(false, true), true);
  assert.equal(environmentReviewActionsDisabled(true, true), true);
});

test("返回欢迎阶段会释放前进操作锁", () => {
  assert.equal(resetEnvironmentEntryNavigationLock("detecting", true), true);
  assert.equal(resetEnvironmentEntryNavigationLock("review", true), true);
  assert.equal(resetEnvironmentEntryNavigationLock("welcome", true), false);
});

function createEnvironmentFlow(): SetupFlow {
  return {
    presentation: { state: "environment-review", stage: 0, kind: "decision" },
    installMode: "native",
    openclawStatus: {
      installed: true,
      version: "test",
      path: "/test/openclaw",
      source: "path",
      relocation_required: false,
      relocation_reason: null,
    },
    dockerStatus: {
      available: true,
      version: "test",
      daemon_running: true,
      unsupported_reason: null,
      image_available: false,
    },
    checkingDocker: false,
    environmentReviewBusy: false,
    goBack: async () => undefined,
    redetectEnvironment: async () => undefined,
    continueAfterEnvironmentReview: () => undefined,
  } as unknown as SetupFlow;
}

test("环境探测与结果复核使用相同的三项固定骨架", () => {
  const flow = createEnvironmentFlow();
  const detecting = renderToStaticMarkup(
    <EnvironmentEntryScreen flow={flow} logs={[]} phase="detecting" />,
  );
  const review = renderToStaticMarkup(
    <EnvironmentEntryScreen flow={flow} logs={[]} phase="review" />,
  );

  assert.equal((detecting.match(/data-environment-item=/g) ?? []).length, 3);
  assert.equal((review.match(/data-environment-item=/g) ?? []).length, 3);
  assert.equal((detecting.match(/data-environment-item-loading=/g) ?? []).length, 3);
  assert.equal((review.match(/data-environment-item-loading=/g) ?? []).length, 0);
});
