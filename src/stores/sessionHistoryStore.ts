// ─────────────────────────────────────────────────────────────────
// sessionHistoryStore — kooky-style conversation persistence.
//
// Each (agent, projectPath, sessionId) tuple is recorded locally so
// the user can resume across app restarts. Indexed by stable hash so
// the same Claude Code session survives being killed/relaunched.
//
// Storage: localStorage (key: `agent-sessions`).
// Shape: { byKey: Record<key, SessionEntry>; recentByProject: Record<cwd, key[]> }
// ─────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionEntry {
  /** Composite key: `${agent}::${projectPath}::${sessionId}`. */
  key: string;
  agent: string;
  projectPath: string;
  sessionId: string;
  /** Absolute path to the .jsonl session file (Claude / Codex). */
  sessionPath: string;
  /** When this session was last seen running. Epoch ms. */
  lastSeen: number;
  /** Optional resume command shown in the UI ("claude --resume abc123"). */
  resumeCommand?: string;
}

interface SessionHistoryState {
  byKey: Record<string, SessionEntry>;
  recentByProject: Record<string, string[]>;
  /** Add or update a session record. */
  record: (entry: Omit<SessionEntry, 'key' | 'lastSeen'>) => void;
  /** Touch lastSeen without changing other fields. */
  touch: (key: string) => void;
  /** Most recent N sessions for a given cwd, newest first. */
  listForProject: (projectPath: string, limit?: number) => SessionEntry[];
  /** Look up by composite key. */
  get: (key: string) => SessionEntry | undefined;
  /** Clear all records for a project (e.g. user nukes project). */
  clearForProject: (projectPath: string) => void;
}

function makeKey(agent: string, projectPath: string, sessionId: string): string {
  return `${agent}::${projectPath}::${sessionId}`;
}

export const useSessionHistoryStore = create<SessionHistoryState>()(
  persist(
    (set, get) => ({
      byKey: {},
      recentByProject: {},

      record: (entry) => {
        const key = makeKey(entry.agent, entry.projectPath, entry.sessionId);
        const now = Date.now();
        set((state) => {
          const next = { ...state.byKey, [key]: { ...entry, key, lastSeen: now } };
          const recent = state.recentByProject[entry.projectPath] ?? [];
          const filtered = recent.filter((k) => k !== key);
          const updatedRecent = [key, ...filtered].slice(0, 20);
          return {
            byKey: next,
            recentByProject: { ...state.recentByProject, [entry.projectPath]: updatedRecent },
          };
        });
      },

      touch: (key) => {
        set((state) => {
          const existing = state.byKey[key];
          if (!existing) return state;
          return {
            byKey: { ...state.byKey, [key]: { ...existing, lastSeen: Date.now() } },
          };
        });
      },

      listForProject: (projectPath, limit = 10) => {
        const state = get();
        const keys = state.recentByProject[projectPath] ?? [];
        const out: SessionEntry[] = [];
        for (const k of keys) {
          const e = state.byKey[k];
          if (e) out.push(e);
          if (out.length >= limit) break;
        }
        return out;
      },

      get: (key) => get().byKey[key],

      clearForProject: (projectPath) => {
        set((state) => {
          const keys = state.recentByProject[projectPath] ?? [];
          const byKeyNext = { ...state.byKey };
          for (const k of keys) delete byKeyNext[k];
          const { [projectPath]: _omit, ...rest } = state.recentByProject;
          return { byKey: byKeyNext, recentByProject: rest };
        });
      },
    }),
    {
      name: 'agent-sessions',
      version: 1,
    },
  ),
);