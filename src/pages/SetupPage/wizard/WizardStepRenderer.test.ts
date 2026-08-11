import assert from "node:assert/strict";
import test from "node:test";
import type { OpenClawWizardStepType } from "@/services/openclawWizard";
import { isWizardBodyMessageStep, WIZARD_STEP_RENDERERS } from "./WizardStepRenderer";

test("官方向导步骤类型均由集中注册表负责渲染", () => {
  const expected: OpenClawWizardStepType[] = [
    "action",
    "confirm",
    "multiselect",
    "note",
    "progress",
    "select",
    "text",
  ];

  assert.deepEqual(Object.keys(WIZARD_STEP_RENDERERS).sort(), expected.sort());
  assert.equal(isWizardBodyMessageStep("confirm"), true);
  assert.equal(isWizardBodyMessageStep("note"), true);
  assert.equal(isWizardBodyMessageStep("progress"), true);
  assert.equal(isWizardBodyMessageStep("action"), true);
  assert.equal(isWizardBodyMessageStep("text"), false);
});
