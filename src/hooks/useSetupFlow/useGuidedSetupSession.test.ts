import assert from "node:assert/strict";
import test from "node:test";
import { classifyGuidedProviderWizardResult } from "./useGuidedSetupSession";

test("Guided 供应商向导不把携带 done 状态的中间步骤误判为终态", () => {
  const step = {
    id: "provider-confirm",
    type: "confirm" as const,
    title: "Confirm provider",
  };

  assert.deepEqual(classifyGuidedProviderWizardResult({
    done: false,
    status: "done",
    step,
  }), {
    kind: "continue",
    step,
  });
});

test("Guided 供应商向导只在 done=true 时接受完成终态", () => {
  assert.deepEqual(classifyGuidedProviderWizardResult({
    done: true,
    status: "done",
  }), { kind: "complete" });

  assert.deepEqual(classifyGuidedProviderWizardResult({
    done: false,
    status: "running",
  }), { kind: "resume" });
});
