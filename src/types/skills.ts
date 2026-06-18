// Skill persona — optional persona carried by a skill. When present, the
// SkillsPage exposes a "Start chat" action that injects this as the system
// prompt of a new chat session via sessions.patch { systemPrompt }.

export type SkillPersona = {
  /** System prompt body. */
  prompt: string;
  /** Display label for the persona chip. Falls back to skill name. */
  label?: string;
};

/**
 * Optional persona fields shared by MySkill / HubSkill / SkillDetail.
 * Accepts either a bare string (forward-compat with minimal manifests) or a
 * structured object. UI helpers normalize string → { prompt }.
 */
export interface SkillPersonaFields {
  persona?: SkillPersona | string;
}