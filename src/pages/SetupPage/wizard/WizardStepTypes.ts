import type { Dispatch, ReactElement, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { OpenClawWizardStep } from "@/services/openclawWizard";

export interface WizardStepRendererProps {
  step: OpenClawWizardStep;
  value: unknown;
  setValue: Dispatch<SetStateAction<unknown>>;
  t: TFunction;
}

export type WizardStepRendererComponent = (props: WizardStepRendererProps) => ReactElement | null;
