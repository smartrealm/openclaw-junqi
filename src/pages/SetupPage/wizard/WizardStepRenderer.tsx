import type { OpenClawWizardStepType } from "@/services/openclawWizard";
import { WizardConfirmStep } from "./WizardConfirmStep";
import { WizardMultiselectStep } from "./WizardMultiselectStep";
import { WizardNoticeStep } from "./WizardNoticeStep";
import { WizardSelectStep } from "./WizardSelectStep";
import { WizardTextStep } from "./WizardTextStep";
import type { WizardStepRendererComponent, WizardStepRendererProps } from "./WizardStepTypes";

// 这里是按官方协议类型选择策略的唯一注册表，不按渠道名称或步骤编号分支。
export const WIZARD_STEP_RENDERERS: Record<OpenClawWizardStepType, WizardStepRendererComponent> = {
  text: WizardTextStep,
  confirm: WizardConfirmStep,
  select: WizardSelectStep,
  multiselect: WizardMultiselectStep,
  note: WizardNoticeStep,
  progress: WizardNoticeStep,
  action: WizardNoticeStep,
};

export function isWizardBodyMessageStep(type: OpenClawWizardStepType): boolean {
  return type === "note" || type === "progress" || type === "action";
}

export function WizardStepRenderer(props: WizardStepRendererProps) {
  const Renderer = WIZARD_STEP_RENDERERS[props.step.type];
  return <Renderer {...props} />;
}
