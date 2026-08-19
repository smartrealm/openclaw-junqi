class SessionMutationGate {
  private readonly activeCounts = new Map<string, number>();
  private readonly retainedCounts = new Map<string, number>();
  private readonly sendAdmissions = new Map<string, number>();
  private readonly sendAdmissionWaiters = new Map<string, Array<() => void>>();
  private readonly pending = new Map<string, Promise<unknown>>();

  isBlocked(sessionKey: string): boolean {
    return (this.activeCounts.get(sessionKey) ?? 0) > 0
      || (this.retainedCounts.get(sessionKey) ?? 0) > 0;
  }

  retain(sessionKey: string): () => void {
    this.retainedCounts.set(sessionKey, (this.retainedCounts.get(sessionKey) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.retainedCounts.get(sessionKey) ?? 1) - 1;
      if (remaining > 0) this.retainedCounts.set(sessionKey, remaining);
      else this.retainedCounts.delete(sessionKey);
    };
  }

  /**
   * 在同一同步区间内登记一次发送准入。会话变更一旦排队，后续发送立即拒绝；
   * 已登记的发送完成 Gateway 准入后，变更才可以开始，避免检查后到提交前的竞态。
   */
  tryAcquireSend(sessionKey: string): (() => void) | null {
    if (this.isBlocked(sessionKey)) return null;
    this.sendAdmissions.set(sessionKey, (this.sendAdmissions.get(sessionKey) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.sendAdmissions.get(sessionKey) ?? 1) - 1;
      if (remaining > 0) {
        this.sendAdmissions.set(sessionKey, remaining);
        return;
      }
      this.sendAdmissions.delete(sessionKey);
      const waiters = this.sendAdmissionWaiters.get(sessionKey) ?? [];
      this.sendAdmissionWaiters.delete(sessionKey);
      for (const resolve of waiters) resolve();
    };
  }

  private waitForSendAdmissions(sessionKey: string): Promise<void> {
    if ((this.sendAdmissions.get(sessionKey) ?? 0) === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = this.sendAdmissionWaiters.get(sessionKey) ?? [];
      waiters.push(resolve);
      this.sendAdmissionWaiters.set(sessionKey, waiters);
    });
  }

  async run<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
    this.activeCounts.set(sessionKey, (this.activeCounts.get(sessionKey) ?? 0) + 1);
    const previous = this.pending.get(sessionKey);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(async () => {
        await this.waitForSendAdmissions(sessionKey);
        return operation();
      });
    this.pending.set(sessionKey, result);
    try {
      return await result;
    } finally {
      if (this.pending.get(sessionKey) === result) this.pending.delete(sessionKey);
      const remaining = (this.activeCounts.get(sessionKey) ?? 1) - 1;
      if (remaining > 0) this.activeCounts.set(sessionKey, remaining);
      else this.activeCounts.delete(sessionKey);
    }
  }
}

export const sessionMutationGate = new SessionMutationGate();
