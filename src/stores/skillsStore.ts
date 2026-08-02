/**
 * skillsStore — agent-scoped skill enable/disable state for sidebar
 * inline toggles. Backed by the gateway `skills.update` RPC.
 *
 * Lightweight on purpose: only the data the sidebar needs (slug +
 * enabled) is cached. The full skill list still lives in SkillsPage.
 */
import { create } from 'zustand';
import { openClawSkillsRuntime } from '@/services/openclawSkillsRuntime';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SkillState {
  /** Cached skill name + enabled flag. Loaded from gateway on first access. */
  skills: Record<string, { name: string; enabled: boolean }>;
  loading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  setEnabled: (slug: string, enabled: boolean) => Promise<void>;
}

export const useSkillsStore = create<SkillState>((set) => ({
  skills: {},
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const list = await openClawSkillsRuntime.list();
      const next: SkillState['skills'] = {};
      for (const skill of list) {
        next[skill.key] = { name: skill.name, enabled: skill.enabled };
      }
      set({ skills: next, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },

  async setEnabled(slug, enabled) {
    // Optimistic update.
    set((s) => ({ skills: { ...s.skills, [slug]: { name: s.skills[slug]?.name || slug, enabled } } }));
    try {
      await openClawSkillsRuntime.setEnabled(slug, enabled);
    } catch (error) {
      // Revert on failure.
      set((s) => ({ skills: { ...s.skills, [slug]: { name: s.skills[slug]?.name || slug, enabled: !enabled } } }));
      set({ error: errorMessage(error) });
    }
  },
}));
