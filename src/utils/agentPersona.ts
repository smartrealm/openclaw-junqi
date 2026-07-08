// Per-agent default persona persistence.
// Stored as a single localStorage entry keyed by agentId so the schema can
// grow without spamming keys. Only ChatTabs reads/writes — single source of
// truth for the "default persona for this agent" concept.

import type { SkillPersona } from '@/types/skills';

const STORAGE_KEY = 'aegis:agent-default-persona';
// 16 KB — defends localStorage quota + caps a maliciously long prompt at
// the trust boundary before the gateway sees it.
const MAX_PROMPT_LENGTH = 16_000;
type StoredMap = Record<string, SkillPersona>;

// Strip ASCII control chars (NUL, ESC, RTL override, zero-width) and
// collapse runs of whitespace. Keeps the prompt readable in the chip
// preview while neutralizing the simplest prompt-injection vectors.
function sanitizePrompt(raw: string): string {
  return Array.from(raw)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1F && code !== 0x7F;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROMPT_LENGTH);
}

function readAll(): StoredMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: StoredMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota / disabled — silently drop; persona default just won't persist
  }
}

export function getAgentDefaultPersona(agentId: string): SkillPersona | null {
  const map = readAll();
  return map[agentId] ?? null;
}

export function setAgentDefaultPersona(agentId: string, persona: SkillPersona | null): void {
  const map = readAll();
  if (persona) {
    const cleaned = sanitizePrompt(persona.prompt);
    if (!cleaned) {
      delete map[agentId];
    } else {
      map[agentId] = { ...persona, prompt: cleaned };
    }
  } else {
    delete map[agentId];
  }
  writeAll(map);
}

// Display-only cap for chip previews — kept separate from the persisted cap
// so "show full" can still render the entire 16 KB if needed.
export const PERSONA_DISPLAY_LIMIT = 200;
