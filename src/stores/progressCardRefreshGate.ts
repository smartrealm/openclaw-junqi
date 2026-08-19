export class ProgressCardRefreshGate {
  private readonly active = new Set<string>();
  private readonly pending = new Set<string>();

  request(key: string): 'start' | 'queued' {
    if (this.active.has(key)) {
      this.pending.add(key);
      return 'queued';
    }
    this.active.add(key);
    return 'start';
  }

  shouldPublish(key: string): boolean {
    return this.active.has(key) && !this.pending.has(key);
  }

  finish(key: string): boolean {
    const repeat = this.pending.delete(key);
    this.active.delete(key);
    return repeat;
  }

  clear(): void {
    this.active.clear();
    this.pending.clear();
  }
}
