import type { OpenClawWizardStep } from '@/services/openclawWizard';

export function wizardValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function wizardInitialValue(step: OpenClawWizardStep): unknown {
  if (step.type === 'confirm') return Boolean(step.initialValue);
  if (step.type === 'multiselect') return Array.isArray(step.initialValue) ? step.initialValue : [];
  if (step.type === 'select') {
    const options = Array.isArray(step.options) ? step.options : [];
    return options.some((option) => wizardValuesEqual(option.value, step.initialValue))
      ? step.initialValue
      : options[0]?.value;
  }
  if (step.type === 'text') return typeof step.initialValue === 'string' ? step.initialValue : '';
  if (step.type === 'action') return true;
  return undefined;
}
