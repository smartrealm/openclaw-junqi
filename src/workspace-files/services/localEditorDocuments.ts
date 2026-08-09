import { invoke } from '@tauri-apps/api/core';
import { readFileText } from '@/workspace-files/runtime/workspaceFs';
import type { WorkspaceFileScope } from '../domain/types';
import { EditorDocumentManager } from './editorDocumentManager';

const manager = new EditorDocumentManager({
  read: async (scope, path) => ({
    content: await readFileText(path, scope.rootPath),
    revision: null,
  }),
  write: async (scope, path, content, expectedContent) => {
    const written = await invoke<boolean>('write_file_content_if_unchanged', {
      path,
      content,
      expectedContent,
      projectPath: scope.rootPath,
    });
    if (written) return { revision: null };
    return {
      revision: null,
      conflictContent: await readFileText(path, scope.rootPath),
    };
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

function ownedLeases(leases: LocalEditorDocumentLease[]) {
  const unique = [...new Map(leases.map((lease) => [
    `${key(lease.rootPath, lease.path)}\u0000${lease.ownerId}`,
    lease,
  ])).values()];
  return unique.flatMap((lease) => {
    const documentKey = key(lease.rootPath, lease.path);
    const documentOwners = owners.get(documentKey);
    if (!documentOwners?.has(lease.ownerId)) return [];
    const scope = localEditorScope(lease.rootPath);
    return [{ lease, documentKey, documentOwners, scope, document: manager.open(scope, lease.path) }];
  });
}

function allOwnedLeases(): LocalEditorDocumentLease[] {
  return [...owners.entries()].flatMap(([documentKey, documentOwners]) => {
    const separator = documentKey.indexOf('\u0000');
    const rootPath = documentKey.slice(0, separator);
    const path = documentKey.slice(separator + 1);
    return [...documentOwners].map((ownerId) => ({ rootPath, path, ownerId }));
  });
}

export async function checkpointAllLocalEditorDocuments(): Promise<void> {
  await checkpointLocalEditorDocuments(allOwnedLeases());
}

export async function checkpointLocalEditorDocuments(leases: LocalEditorDocumentLease[]): Promise<void> {
  const owned = ownedLeases(leases);
  // Validate every lease before checkpointing any document.
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
}

export function commitLocalEditorDocumentRelease(leases: LocalEditorDocumentLease[]): void {
  const owned = ownedLeases(leases);
  // Lease mutation is the commit phase and runs only after every checkpoint.
  for (const item of owned) {
    item.documentOwners.delete(item.lease.ownerId);
    if (item.documentOwners.size > 0) continue;
    owners.delete(item.documentKey);
    manager.close(item.scope, item.lease.path);
  }
}

export async function releaseLocalEditorDocuments(leases: LocalEditorDocumentLease[]): Promise<void> {
  await checkpointLocalEditorDocuments(leases);
  commitLocalEditorDocumentRelease(leases);
}

export function releaseLocalEditorDocument(rootPath: string, path: string, ownerId: string): Promise<void> {
  return releaseLocalEditorDocuments([{ rootPath, path, ownerId }]);
}

export async function deleteLocalEditorDocument(rootPath: string, path: string, ownerId: string): Promise<void> {
  const documentKey = key(rootPath, path);
  const documentOwners = owners.get(documentKey);
  if (!documentOwners?.has(ownerId)) return;
  const scope = localEditorScope(rootPath);
  manager.open(scope, path).markDeleted();
  documentOwners.delete(ownerId);
  if (documentOwners.size > 0) return;
  owners.delete(documentKey);
  manager.close(scope, path);
}
