export class SessionCommandCoordinator {
  private readonly pending = new Map<string, Promise<unknown>>();

  runMutation<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(sessionKey);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(operation);
    this.pending.set(sessionKey, result);
    void result.finally(() => {
      if (this.pending.get(sessionKey) === result) this.pending.delete(sessionKey);
    }).catch(() => undefined);
    return result;
  }

  async waitForPending(sessionKey: string): Promise<void> {
    const operation = this.pending.get(sessionKey);
    if (operation) await operation;
  }

  hasPending(sessionKey: string): boolean {
    return this.pending.has(sessionKey);
  }
}

export const sessionCommandCoordinator = new SessionCommandCoordinator();
