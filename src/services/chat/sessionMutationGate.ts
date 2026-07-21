class SessionMutationGate {
  private readonly activeCounts = new Map<string, number>();
  private readonly pending = new Map<string, Promise<unknown>>();

  isBlocked(sessionKey: string): boolean {
    return (this.activeCounts.get(sessionKey) ?? 0) > 0;
  }

  async run<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
    this.activeCounts.set(sessionKey, (this.activeCounts.get(sessionKey) ?? 0) + 1);
    const previous = this.pending.get(sessionKey);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(operation);
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
