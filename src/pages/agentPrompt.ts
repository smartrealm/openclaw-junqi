const PLAN_MODE_INSTRUCTION = 'Please use plan mode.';

export function applyPlanModePrompt(prompt: string, planMode: boolean): string {
  const normalized = prompt.trim();
  if (!planMode || !normalized || normalized.endsWith(PLAN_MODE_INSTRUCTION)) return normalized;
  return `${normalized}\n\n${PLAN_MODE_INSTRUCTION}`;
}
