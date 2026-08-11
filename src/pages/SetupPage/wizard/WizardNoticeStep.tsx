import type { WizardStepRendererProps } from "./WizardStepTypes";

export function WizardNoticeStep({
  step,
  t,
}: WizardStepRendererProps) {
  return (
    <div className="rounded-lg border border-aegis-primary/25 bg-aegis-primary/5 p-4 text-sm leading-6 text-aegis-text-secondary">
      <pre className="whitespace-pre-wrap break-words font-[inherit]">
        {step.message || t("setup.wizard.readyForStep")}
      </pre>
    </div>
  );
}
