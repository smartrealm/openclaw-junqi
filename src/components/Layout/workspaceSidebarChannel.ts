export type WorkspaceSidebarMode = 'full' | 'compact' | 'hidden';

export interface WorkspaceSidebarChannel {
  toggleEvent: string;
  modeEvent: string;
  storageKey: string;
  read(): WorkspaceSidebarMode;
  requestToggle(): void;
  publish(mode: WorkspaceSidebarMode): void;
}

export function isWorkspaceSidebarMode(value: unknown): value is WorkspaceSidebarMode {
  return value === 'full' || value === 'compact' || value === 'hidden';
}

export function nextWorkspaceSidebarMode(mode: WorkspaceSidebarMode): WorkspaceSidebarMode {
  return mode === 'full' ? 'compact' : mode === 'compact' ? 'hidden' : 'full';
}

export function createWorkspaceSidebarChannel(namespace: string): WorkspaceSidebarChannel {
  const toggleEvent = `junqi:toggle-${namespace}-sidebar`;
  const modeEvent = `junqi:${namespace}-sidebar-mode`;
  const storageKey = `junqi:${namespace}-sidebar-mode`;
  return {
    toggleEvent,
    modeEvent,
    storageKey,
    read: () => {
      try {
        const saved = localStorage.getItem(storageKey);
        return isWorkspaceSidebarMode(saved) ? saved : 'full';
      } catch {
        return 'full';
      }
    },
    requestToggle: () => window.dispatchEvent(new Event(toggleEvent)),
    publish: (mode) => window.dispatchEvent(new CustomEvent<WorkspaceSidebarMode>(modeEvent, { detail: mode })),
  };
}
