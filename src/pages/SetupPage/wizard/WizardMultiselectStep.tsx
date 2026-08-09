import { wizardValuesEqual } from "./WizardStepValue";
import type { WizardStepRendererProps } from "./WizardStepTypes";

export function WizardMultiselectStep({ step, value, setValue }: WizardStepRendererProps) {
  const options = step.options ?? [];
  const selectedValues = Array.isArray(value) ? value : [];
  const toggleValue = (optionValue: unknown) => {
    setValue((current: unknown) => {
      const values = Array.isArray(current) ? current : [];
      return values.some((item) => wizardValuesEqual(item, optionValue))
        ? values.filter((item) => !wizardValuesEqual(item, optionValue))
        : [...values, optionValue];
    });
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option, index) => {
        const selected = selectedValues.some((item) => wizardValuesEqual(item, option.value));
        return (
          <label
            key={`${step.id}-${index}`}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selected ? "border-aegis-primary bg-aegis-primary/8" : "border-aegis-border bg-aegis-surface"}`}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => toggleValue(option.value)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--aegis-primary))]"
            />
            <span>
              <span className="block text-sm font-semibold text-aegis-text">{option.label}</span>
              {option.hint && <span className="mt-1 block text-xs leading-5 text-aegis-text-muted">{option.hint}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
