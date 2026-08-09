import type { WizardStepRendererProps } from "./WizardStepTypes";

export function WizardConfirmStep({ step, value, setValue, t }: WizardStepRendererProps) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-aegis-border bg-aegis-surface p-4 text-sm text-aegis-text">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => setValue(event.target.checked)}
        className="h-4 w-4 accent-[rgb(var(--aegis-primary))]"
      />
      <span>{step.message || t("setup.wizard.confirm")}</span>
    </label>
  );
}
