import type { SkillPersona } from '@/types/skills';
import { useChatStore } from '@/stores/chatStore';

export function mergePersonaIntoDraft(current: string, persona: SkillPersona): string {
  const prompt = persona.prompt.trim();
  if (!prompt || current.includes(prompt)) return current;
  const label = persona.label?.trim() || 'Persona';
  const instruction = `会话指令（${label}）：\n${prompt}`;
  return current.trim() ? `${instruction}\n\n${current}` : instruction;
}

export function applyPersonaToSessionDraft(sessionKey: string, persona: SkillPersona): void {
  const state = useChatStore.getState();
  state.setDraft(sessionKey, mergePersonaIntoDraft(state.getDraft(sessionKey), persona));
}
