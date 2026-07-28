import { readFileText, writeFileText } from '@/services/workspaceFs';
import type { WorkspaceFileScope } from '../domain/types';
import { EditorDocumentManager } from './editorDocumentManager';

const manager = new EditorDocumentManager({
  read: async (scope, path) => ({
    content: await readFileText(path, scope.rootPath),
    revision: null,
  }),
  write: async (scope, path, content) => {
    await writeFileText(path, content, scope.rootPath);
    return { revision: null };
  },
});
const owners = new Map<string, Set<string>>();

export function localEditorScope(rootPath: string): WorkspaceFileScope {
  return {
    hostId: 'local', hostRevision: 0, workspaceId: rootPath,
    rootPath, rootRevision: 0, policy: 'workspace',
  };
}

function key(rootPath: string, path: string): string {
  return `${rootPath}\u0000${path}`;
}

export function acquireLocalEditorDocument(rootPath: string, path: string, ownerId: string) {
  if (!ownerId) throw new Error('Editor document owner is required');
  const documentKey = key(rootPath, path);
  const documentOwners = owners.get(documentKey) ?? new Set<string>();
  documentOwners.add(ownerId);
  owners.set(documentKey, documentOwners);
  return manager.open(localEditorScope(rootPath), path);
}

export interface LocalEditorDocumentLease {
  rootPath: string;
  path: string;
  ownerId: string;
}

export async function releaseLocalEditorDocuments(leases: LocalEditorDocumentLease[]): Promise<void> {
  const unique = [...new Map(leases.map((lease) => [
    `${key(lease.rootPath, lease.path)}\u0000${lease.ownerId}`,
    lease,
  ])).values()];
  const owned = unique.flatMap((lease) => {
    const documentKey = key(lease.rootPath, lease.path);
    const documentOwners = owners.get(documentKey);
    if (!documentOwners?.has(lease.ownerId)) return [];
    const scope = localEditorScope(lease.rootPath);
    return [{ lease, documentKey, documentOwners, scope, document: manager.open(scope, lease.path) }];
  });
  // Validate every lease before checkpointing or releasing any owner.
  for (const item of owned) {
    if (item.documentOwners.size === 1 && item.document.snapshot().status === 'conflicted') {
      throw new Error('Document has an unresolved external-change conflict');
    }
  }
  for (const item of owned) {
    if (item.documentOwners.size > 1) continue;
    const status = item.document.snapshot().status;
    if (status === 'dirty' || status === 'saving' || status === 'error') {
      await item.document.save();
      if (item.document.snapshot().status === 'error') {
        throw new Error(item.document.snapshot().error ?? 'Document checkpoint failed');
      }
    }
  }
  // Lease mutation is the commit phase and runs only after every checkpoint.
  for (const item of owned) {
    item.documentOwners.delete(item.lease.ownerId);
    if (item.documentOwners.size > 0) continue;
    owners.delete(item.documentKey);
    manager.close(item.scope, item.lease.path);
  }
}

export function releaseLocalEditorDocument(rootPath: string, path: string, ownerId: string): Promise<void> {
  return releaseLocalEditorDocuments([{ rootPath, path, ownerId }]);
}
