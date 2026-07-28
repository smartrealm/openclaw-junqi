import type { WorkbenchHost, WorkbenchHostCapabilities, WorkbenchHostKind } from '../domain/types';
import type { WorkspaceFilesAdapter } from '@/workspace-files/adapters/types';
import { localWorkspaceFiles } from '@/workspace-files/adapters/localWorkspaceFiles';

export interface WorkbenchGitAdapter {
  readonly available: boolean;
}

export interface WorkbenchTerminalAdapter {
  readonly available: boolean;
}

export interface WorkbenchBrowserAdapter {
  readonly available: boolean;
}

export interface WorkbenchHostAdapter {
  host: WorkbenchHost;
  files: WorkspaceFilesAdapter | null;
  git: WorkbenchGitAdapter;
  terminal: WorkbenchTerminalAdapter;
  browser: WorkbenchBrowserAdapter;
}

const UNAVAILABLE = Object.freeze({ available: false });
const LOCAL_CAPABILITIES: WorkbenchHostCapabilities = {
  files: true,
  git: true,
  terminal: false,
  browser: false,
  hostedReview: false,
};

export class WorkbenchHostUnavailableError extends Error {
  constructor(readonly hostId: string, readonly capability: keyof WorkbenchHostCapabilities) {
    super(`Workbench host ${hostId} does not provide ${capability}`);
    this.name = 'WorkbenchHostUnavailableError';
  }
}

export function localWorkbenchHost(revision = 0): WorkbenchHostAdapter {
  return {
    host: {
      id: 'local', kind: 'local', revision,
      connectionState: 'connected', capabilities: LOCAL_CAPABILITIES,
    },
    files: localWorkspaceFiles,
    git: { available: true },
    terminal: UNAVAILABLE,
    browser: UNAVAILABLE,
  };
}

export function unavailableWorkbenchHost(
  id: string,
  kind: Exclude<WorkbenchHostKind, 'local'>,
  revision: number,
): WorkbenchHostAdapter {
  return {
    host: {
      id, kind, revision, connectionState: 'offline',
      capabilities: { files: false, git: false, terminal: false, browser: false, hostedReview: false },
    },
    files: null,
    git: UNAVAILABLE,
    terminal: UNAVAILABLE,
    browser: UNAVAILABLE,
  };
}

export class WorkbenchHostRouter {
  private readonly adapters = new Map<string, WorkbenchHostAdapter>();

  constructor(adapters: readonly WorkbenchHostAdapter[] = [localWorkbenchHost()]) {
    adapters.forEach((adapter) => this.register(adapter));
  }

  register(adapter: WorkbenchHostAdapter): void {
    const current = this.adapters.get(adapter.host.id);
    if (current && adapter.host.revision < current.host.revision) return;
    this.adapters.set(adapter.host.id, adapter);
  }

  resolve(hostId: string, expectedRevision: number): WorkbenchHostAdapter {
    const adapter = this.adapters.get(hostId);
    if (!adapter || adapter.host.revision !== expectedRevision) {
      throw new WorkbenchHostUnavailableError(hostId, 'files');
    }
    return adapter;
  }

  requireFiles(hostId: string, expectedRevision: number): WorkspaceFilesAdapter {
    const adapter = this.resolve(hostId, expectedRevision);
    if (!adapter.host.capabilities.files || !adapter.files || adapter.host.connectionState !== 'connected') {
      throw new WorkbenchHostUnavailableError(hostId, 'files');
    }
    return adapter.files;
  }
}

export const workbenchHostRouter = new WorkbenchHostRouter();
