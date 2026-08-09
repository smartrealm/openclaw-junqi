import type { WizardStepRendererProps } from "./WizardStepTypes";

export function WizardTextStep({ step, value, setValue, t }: WizardStepRendererProps) {
  return (
    <input
      type={step.sensitive ? "password" : "text"}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => setValue(event.target.value)}
      placeholder={step.placeholder}
      aria-label={step.title || t("setup.wizard.textInput")}
      autoComplete={step.sensitive ? "new-password" : "off"}
      className="w-full rounded-lg border border-aegis-border bg-aegis-surface px-3 py-2.5 text-sm text-aegis-text outline-none focus:border-aegis-primary"
    />
  );
}
