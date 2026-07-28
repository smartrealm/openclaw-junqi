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

export async function releaseLocalEditorDocument(rootPath: string, path: string, ownerId: string): Promise<void> {
  const documentKey = key(rootPath, path);
  const documentOwners = owners.get(documentKey);
  if (!documentOwners?.has(ownerId)) return;
  if (documentOwners.size > 1) {
    documentOwners.delete(ownerId);
    return;
  }
  const scope = localEditorScope(rootPath);
  const document = manager.open(scope, path);
  const status = document.snapshot().status;
  if (status === 'conflicted') {
    throw new Error('Document has an unresolved external-change conflict');
  }
  if (status === 'dirty' || status === 'saving' || status === 'error') {
    await document.save();
    if (document.snapshot().status === 'error') {
      throw new Error(document.snapshot().error ?? 'Document checkpoint failed');
    }
  }
  documentOwners.delete(ownerId);
  owners.delete(documentKey);
  manager.close(scope, path);
}
