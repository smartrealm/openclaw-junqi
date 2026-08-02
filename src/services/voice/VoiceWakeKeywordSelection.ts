import { includesVoiceWakeTrigger, normalizeVoiceWakeTrigger } from '@/services/gateway/voiceWakeTypes';

/** Projects Gateway phrases onto the exact labels the local model can recognize. */
export function selectedModelWakeKeywords(
  modelKeywords: readonly string[],
  gatewayTriggers: readonly string[],
): string[] {
  return modelKeywords.filter((keyword) => includesVoiceWakeTrigger(gatewayTriggers, keyword));
}

/** Rejects arbitrary or ambiguous UI values before the Gateway trigger update. */
export function resolveModelWakeKeywordSelection(
  modelKeywords: readonly string[],
  requestedKeywords: readonly string[],
): string[] | null {
  if (requestedKeywords.length === 0) return null;
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const requested of requestedKeywords) {
    const normalized = normalizeVoiceWakeTrigger(requested);
    if (!normalized || seen.has(normalized)) return null;
    const modelKeyword = modelKeywords.find((candidate) => (
      normalizeVoiceWakeTrigger(candidate) === normalized
    ));
    if (!modelKeyword) return null;
    seen.add(normalized);
    resolved.push(modelKeyword);
  }
  return resolved;
}
