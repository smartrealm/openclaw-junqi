/**
 * Invalidates asynchronous work created by an older lifecycle run.
 * A token is valid only while the owner is active and no reset occurred.
 */
export class LifecycleEpoch {
  private value = 0;
  private active = false;

  activate(): number {
    this.active = true;
    return ++this.value;
  }

  invalidate(): number {
    return ++this.value;
  }

  deactivate(): void {
    this.active = false;
    this.value += 1;
  }

  capture(): number {
    return this.value;
  }

  isActive(): boolean {
    return this.active;
  }

  isCurrent(token: number): boolean {
    return this.active && token === this.value;
  }
}
