/**
 * 使旧生命周期创建的异步任务失效。
 * 只有所有者仍活跃且期间没有重置时，代次令牌才有效。
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
