import { CheckCircle2, Circle } from "lucide-react";
import clsx from "clsx";
import { wizardValuesEqual } from "./WizardStepValue";
import type { WizardStepRendererProps } from "./WizardStepTypes";
import { WizardOptionSearch } from "./WizardOptionSearch";

export function WizardSelectStep({ step, value, setValue, t }: WizardStepRendererProps) {
  const options = step.options ?? [];
  return (
    <WizardOptionSearch
      stepId={step.id}
      options={options}
      t={t}
      renderOptions={(filteredOptions) => (
        <div className="grid gap-2 sm:grid-cols-2">
          {filteredOptions.map(({ option, originalIndex }) => {
            const selected = wizardValuesEqual(value, option.value);
            return (
              <button
                key={`${step.id}-${originalIndex}`}
                type="button"
                onClick={() => setValue(option.value)}
                className={clsx(
                  "flex min-h-[64px] items-start gap-3 rounded-lg border p-3 text-start transition",
                  selected ? "border-aegis-primary bg-aegis-primary/8" : "border-aegis-border bg-aegis-surface hover:border-aegis-primary/40",
                )}
              >
                {selected
                  ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-aegis-primary" />
                  : <Circle size={17} className="mt-0.5 shrink-0 text-aegis-text-dim" />}
                <span>
                  <span className="block text-sm font-semibold text-aegis-text">{option.label}</span>
                  {option.hint && <span className="mt-1 block text-xs leading-5 text-aegis-text-muted">{option.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    />
  );
}
