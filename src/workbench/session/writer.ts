import type { WorkbenchSessionSnapshot } from './schema';

export interface WorkbenchSessionStorage {
  save(partitionId: string, expectedGeneration: number, snapshot: WorkbenchSessionSnapshot): Promise<{
    generation: number;
    payloadHash: string;
    unchanged: boolean;
  }>;
}

export class WorkbenchSessionWriter {
  private ready = false;
  private generation = 0;
  private writeTail: Promise<void> = Promise.resolve();
  private pending: WorkbenchSessionSnapshot | null = null;

  constructor(
    private readonly partitionId: string,
    private readonly storage: WorkbenchSessionStorage,
  ) {}

  enable(initialGeneration: number): void {
    if (this.ready) return;
    this.generation = initialGeneration;
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  schedule(snapshot: WorkbenchSessionSnapshot): Promise<void> {
    if (!this.ready) return Promise.reject(new Error('Workbench session writer is not hydrated'));
    this.pending = snapshot;
    const drain = async () => {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        const result = await this.storage.save(this.partitionId, this.generation, next);
        this.generation = result.generation;
      }
    };
    this.writeTail = this.writeTail.then(drain, drain);
    return this.writeTail;
  }

  async checkpoint(snapshot: WorkbenchSessionSnapshot): Promise<void> {
    if (!this.ready) throw new Error('Workbench session writer is not hydrated');
    this.pending = snapshot;
    await this.schedule(snapshot);
  }
}
