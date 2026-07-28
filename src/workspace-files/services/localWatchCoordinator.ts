import { invoke } from '@tauri-apps/api/core';
import { subscribeTauriEvent } from '@/utils/tauriEvents';
import type { WorkspaceFileScope } from '../domain/types';
import {
  WorkspaceFileWatchCoordinator,
  type WorkspaceFileEvent,
  type WorkspaceFileWatchListener,
} from './watchCoordinator';

interface LegacyWatchRegistration {
  watchId: string;
  scope: WorkspaceFileScope;
  path: string;
  sequence: number;
}

function scopeId(scope: WorkspaceFileScope): string {
  return `${scope.hostId}:${scope.hostRevision}:${scope.workspaceId}:${scope.rootRevision}`;
}

const registrations = new Map<string, LegacyWatchRegistration>();
let coordinator: WorkspaceFileWatchCoordinator;

const source = {
  async start(watchId: string, scope: WorkspaceFileScope, path: string): Promise<void> {
    if (scope.hostId !== 'local') throw new Error(`Local watcher cannot serve host ${scope.hostId}`);
    if (scope.policy !== 'workspace') throw new Error(`File policy ${scope.policy} cannot watch`);
    const registration = { watchId, scope, path, sequence: 0 };
    // Route first so a native event emitted during command completion is not lost.
    registrations.set(watchId, registration);
    try {
      const available = await invoke<boolean>('watch_dir', { path, projectPath: scope.rootPath });
      if (!available) throw new Error(`Native file watcher unavailable for ${path}`);
    } catch (error) {
      if (registrations.get(watchId) === registration) registrations.delete(watchId);
      throw error;
    }
  },
  async stop(watchId: string): Promise<void> {
    const registration = registrations.get(watchId);
    if (!registration) return;
    registrations.delete(watchId);
    await invoke('unwatch_dir', { path: registration.path });
  },
};

coordinator = new WorkspaceFileWatchCoordinator(source);

// The legacy native protocol only identifies a directory. Treat every signal
// as overflow so consumers refresh authoritative state rather than inventing a
// precise created/changed/deleted event.
subscribeTauriEvent<{ dir: string }>('fs-changed', (event) => {
  for (const registration of registrations.values()) {
    if (registration.path !== event.payload.dir) continue;
    registration.sequence += 1;
    const overflow: WorkspaceFileEvent = {
      watchId: registration.watchId,
      scopeId: scopeId(registration.scope),
      hostId: registration.scope.hostId,
      hostRevision: registration.scope.hostRevision,
      sequence: registration.sequence,
      kind: 'overflow',
      path: registration.path,
    };
    coordinator.dispatch(overflow);
  }
});

export function localWorkspaceScope(rootPath: string): WorkspaceFileScope {
  return {
    hostId: 'local', hostRevision: 0, workspaceId: rootPath,
    rootPath, rootRevision: 0, policy: 'workspace',
  };
}

export function subscribeLocalWorkspacePath(
  rootPath: string,
  path: string,
  listener: WorkspaceFileWatchListener,
): Promise<() => void> {
  return coordinator.subscribe(localWorkspaceScope(rootPath), path, listener);
}
