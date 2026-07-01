/**
 * skillsStore — agent-scoped skill enable/disable state for sidebar
 * inline toggles. Backed by the gateway `skills.update` RPC.
 *
 * Lightweight on purpose: only the data the sidebar needs (slug +
 * enabled) is cached. The full skill list still lives in SkillsPage.
 */
import { create } from 'zustand';
import { gateway } from '@/services/gateway';

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
      const result: any = await gateway.call('skills.status', {});
      const list: any[] = result?.skills || result?.entries || [];
      const next: SkillState['skills'] = {};
      for (const s of list) {
        const slug = s.skillKey || s.slug || s.name || '';
        if (!slug) continue;
        next[slug] = { name: s.name || slug, enabled: s.enabled !== false };
      }
      set({ skills: next, loading: false });
    } catch (err: any) {
      set({ error: err?.message || String(err), loading: false });
    }
  },

  async setEnabled(slug, enabled) {
    // Optimistic update.
    set((s) => ({ skills: { ...s.skills, [slug]: { name: s.skills[slug]?.name || slug, enabled } } }));
    try {
      await gateway.call('skills.update', { skillKey: slug, enabled });
    } catch (err: any) {
      // Revert on failure.
      set((s) => ({ skills: { ...s.skills, [slug]: { name: s.skills[slug]?.name || slug, enabled: !enabled } } }));
      set({ error: err?.message || String(err) });
    }
  },
}));