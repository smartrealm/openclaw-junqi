import type { HostId, WorkspaceFileScope } from '../domain/types';

export type WorkspaceFileEventKind = 'created' | 'changed' | 'deleted' | 'renamed' | 'overflow';

export interface WorkspaceFileEvent {
  watchId: string;
  scopeId: string;
  hostId: HostId;
  hostRevision: number;
  sequence: number;
  kind: WorkspaceFileEventKind;
  path: string;
  oldPath?: string;
  operationId?: string;
}

export interface WorkspaceFileWatchSource {
  start(watchId: string, scope: WorkspaceFileScope, path: string): Promise<void>;
  stop(watchId: string): Promise<void>;
}

export type WorkspaceFileWatchListener = (event: WorkspaceFileEvent) => void;

interface WatchRegistration {
  watchId: string;
  scope: WorkspaceFileScope;
  path: string;
  references: number;
  lastSequence: number;
  listeners: Set<WorkspaceFileWatchListener>;
  starting: Promise<void>;
}

function scopeId(scope: WorkspaceFileScope): string {
  return `${scope.hostId}:${scope.hostRevision}:${scope.workspaceId}:${scope.rootRevision}`;
}

function registrationKey(scope: WorkspaceFileScope, path: string): string {
  return `${scopeId(scope)}:${path}`;
}

function watchIdBase(key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `workspace-watch:${(hash >>> 0).toString(16)}`;
}

export class WorkspaceFileWatchCoordinator {
  private readonly registrations = new Map<string, WatchRegistration>();
  private readonly byWatchId = new Map<string, WatchRegistration>();

  constructor(private readonly source: WorkspaceFileWatchSource) {}

  async subscribe(
    scope: WorkspaceFileScope,
    path: string,
    listener: WorkspaceFileWatchListener,
  ): Promise<() => void> {
    const key = registrationKey(scope, path);
    let registration = this.registrations.get(key);
    if (!registration) {
      const base = watchIdBase(key);
      let watchId = base;
      let collision = 1;
      while (this.byWatchId.has(watchId)) {
        watchId = `${base}:${collision}`;
        collision += 1;
      }
      registration = {
        watchId, scope, path, references: 0, lastSequence: 0,
        listeners: new Set(),
        starting: this.source.start(watchId, scope, path),
      };
      this.registrations.set(key, registration);
      this.byWatchId.set(watchId, registration);
    }
    registration.references += 1;
    registration.listeners.add(listener);
    try {
      await registration.starting;
    } catch (error) {
      this.release(key, listener);
      throw error;
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.release(key, listener);
    };
  }

  private release(key: string, listener: WorkspaceFileWatchListener): void {
    const registration = this.registrations.get(key);
    if (!registration) return;
    registration.listeners.delete(listener);
    registration.references = Math.max(0, registration.references - 1);
    if (registration.references > 0) return;
    this.registrations.delete(key);
    this.byWatchId.delete(registration.watchId);
    void registration.starting.then(
      () => this.source.stop(registration.watchId),
      () => undefined,
    );
  }

  dispatch(event: WorkspaceFileEvent): boolean {
    const registration = this.byWatchId.get(event.watchId);
    if (!registration) return false;
    const expectedScopeId = scopeId(registration.scope);
    if (
      event.scopeId !== expectedScopeId
      || event.hostId !== registration.scope.hostId
      || event.hostRevision !== registration.scope.hostRevision
    ) return false;
    if (event.sequence <= registration.lastSequence) return false;
    if (registration.lastSequence > 0 && event.sequence !== registration.lastSequence + 1) {
      const overflow: WorkspaceFileEvent = {
        ...event,
        kind: 'overflow',
        path: registration.path,
      };
      registration.lastSequence = event.sequence;
      registration.listeners.forEach((listener) => listener(overflow));
      return true;
    }
    registration.lastSequence = event.sequence;
    registration.listeners.forEach((listener) => listener(event));
    return true;
  }

  async dispose(): Promise<void> {
    const registrations = [...this.registrations.values()];
    this.registrations.clear();
    this.byWatchId.clear();
    await Promise.allSettled(registrations.map(async (registration) => {
      await registration.starting;
      await this.source.stop(registration.watchId);
    }));
  }
}
