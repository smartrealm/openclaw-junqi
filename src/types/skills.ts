// Skill persona — optional visible session instruction carried by a skill.
// OpenClaw does not expose a per-session systemPrompt patch, so JunQi places
// this content in the new session draft for the user to review and send.

export type SkillPersona = {
  /** User-reviewable session instruction. */
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
