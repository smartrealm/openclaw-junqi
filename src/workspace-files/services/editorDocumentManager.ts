import type { WorkspaceFileScope } from '../domain/types';

export type EditorDocumentStatus =
  | 'idle'
  | 'loading'
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'conflicted'
  | 'deleted'
  | 'error';

export interface EditorDocumentSnapshot {
  key: string;
  scope: WorkspaceFileScope;
  path: string;
  loadGeneration: number;
  writeGeneration: number;
  diskContent: string;
  draftContent: string;
  diskRevision: string | null;
  lastWriteOperationId: string | null;
  status: EditorDocumentStatus;
  error: string | null;
}

export interface EditorDocumentIO {
  read(scope: WorkspaceFileScope, path: string): Promise<{ content: string; revision: string | null }>;
  write(
    scope: WorkspaceFileScope,
    path: string,
    content: string,
    expectedContent: string,
    operationId: string,
  ): Promise<{ revision: string | null; conflictContent?: string }>;
}

export type EditorDocumentListener = (snapshot: EditorDocumentSnapshot) => void;

function documentKey(scope: WorkspaceFileScope, path: string): string {
  return `${scope.hostId}:${scope.hostRevision}:${scope.workspaceId}:${scope.rootRevision}:${path}`;
}

function operationId(key: string, generation: number): string {
  return `${key}:write:${generation}`;
}

export class EditorDocumentController {
  private snapshotValue: EditorDocumentSnapshot;
  private readonly listeners = new Set<EditorDocumentListener>();
  private writeTail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly io: EditorDocumentIO,
    scope: WorkspaceFileScope,
    path: string,
  ) {
    this.snapshotValue = {
      key: documentKey(scope, path), scope, path,
      loadGeneration: 0, writeGeneration: 0,
      diskContent: '', draftContent: '', diskRevision: null,
      lastWriteOperationId: null, status: 'idle', error: null,
    };
  }

  snapshot(): EditorDocumentSnapshot {
    return this.snapshotValue;
  }

  subscribe(listener: EditorDocumentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<EditorDocumentSnapshot>): void {
    if (this.disposed) return;
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshotValue));
  }

  private isDeleted(): boolean {
    return this.snapshotValue.status === 'deleted';
  }

  async load(): Promise<void> {
    if (this.snapshotValue.status === 'deleted') return;
    const generation = this.snapshotValue.loadGeneration + 1;
    this.update({ loadGeneration: generation, status: 'loading', error: null });
    try {
      const result = await this.io.read(this.snapshotValue.scope, this.snapshotValue.path);
      if (this.disposed || generation !== this.snapshotValue.loadGeneration) return;
      this.update({
        diskContent: result.content,
        draftContent: result.content,
        diskRevision: result.revision,
        status: 'clean',
      });
    } catch (error) {
      if (this.disposed || generation !== this.snapshotValue.loadGeneration) return;
      this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  edit(content: string): void {
    if (this.snapshotValue.status === 'deleted') return;
    this.update({
      draftContent: content,
      status: content === this.snapshotValue.diskContent ? 'clean' : 'dirty',
      error: null,
    });
  }

  save(): Promise<void> {
    if (this.snapshotValue.status === 'deleted') return Promise.resolve();
    const content = this.snapshotValue.draftContent;
    const expectedContent = this.snapshotValue.diskContent;
    if (content === expectedContent) {
      this.update({ status: 'clean', error: null });
      return Promise.resolve();
    }
    const generation = this.snapshotValue.writeGeneration + 1;
    const opId = operationId(this.snapshotValue.key, generation);
    this.update({ writeGeneration: generation, lastWriteOperationId: opId, status: 'saving', error: null });
    const write = async () => {
      if (this.disposed || this.isDeleted()) return;
      try {
        const result = await this.io.write(
          this.snapshotValue.scope,
          this.snapshotValue.path,
          content,
          expectedContent,
          opId,
        );
        if (this.disposed || this.isDeleted()) return;
        if (result.conflictContent !== undefined) {
          this.update({
            diskContent: result.conflictContent,
            diskRevision: result.revision,
            status: 'conflicted',
          });
          return;
        }
        const draftChangedDuringWrite = this.snapshotValue.draftContent !== content;
        this.update({
          diskContent: content,
          diskRevision: result.revision,
          status: draftChangedDuringWrite ? 'dirty' : 'saved',
        });
      } catch (error) {
        if (this.disposed || this.isDeleted()) return;
        this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    };
    this.writeTail = this.writeTail.then(write, write);
    return this.writeTail;
  }

  applyExternalChange(content: string, revision: string | null, operation: string | null = null): void {
    if (this.snapshotValue.status === 'deleted') return;
    if (operation && operation === this.snapshotValue.lastWriteOperationId) return;
    if (content === this.snapshotValue.diskContent || content === this.snapshotValue.draftContent) {
      this.update({ diskContent: content, diskRevision: revision, status: 'clean' });
      return;
    }
    const dirty = this.snapshotValue.draftContent !== this.snapshotValue.diskContent;
    if (dirty || this.snapshotValue.status === 'saving') {
      this.update({ diskContent: content, diskRevision: revision, status: 'conflicted' });
      return;
    }
    this.update({ diskContent: content, draftContent: content, diskRevision: revision, status: 'clean' });
  }

  replaceWithDiskContent(content: string, revision: string | null): void {
    if (this.snapshotValue.status === 'deleted') return;
    this.update({
      diskContent: content,
      draftContent: content,
      diskRevision: revision,
      status: 'clean',
      error: null,
    });
  }

  keepLocalEdits(): void {
    if (this.snapshotValue.status !== 'conflicted') return;
    this.update({ status: 'dirty', error: null });
  }

  markDeleted(): void {
    this.update({
      loadGeneration: this.snapshotValue.loadGeneration + 1,
      writeGeneration: this.snapshotValue.writeGeneration + 1,
      status: 'deleted',
      error: null,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

export class EditorDocumentManager {
  private readonly documents = new Map<string, EditorDocumentController>();

  constructor(private readonly io: EditorDocumentIO) {}

  open(scope: WorkspaceFileScope, path: string): EditorDocumentController {
    const key = documentKey(scope, path);
    const existing = this.documents.get(key);
    if (existing) return existing;
    const document = new EditorDocumentController(this.io, scope, path);
    this.documents.set(key, document);
    return document;
  }

  close(scope: WorkspaceFileScope, path: string): void {
    const key = documentKey(scope, path);
    this.documents.get(key)?.dispose();
    this.documents.delete(key);
  }

  dispose(): void {
    this.documents.forEach((document) => document.dispose());
    this.documents.clear();
  }
}
