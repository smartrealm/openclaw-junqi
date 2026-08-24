export type DingTalkToolSchemaRequest = {
  readonly revision: number;
  readonly sessionKey: string;
  readonly toolId: string;
};

export class DingTalkToolSchemaRequestCoordinator {
  private revision = 0;

  begin(sessionKey: string, toolId: string): DingTalkToolSchemaRequest {
    this.revision += 1;
    return { revision: this.revision, sessionKey, toolId };
  }

  invalidate(): void {
    this.revision += 1;
  }

  accepts(
    request: DingTalkToolSchemaRequest,
    sessionKey: string,
    toolId: string,
  ): boolean {
    return request.revision === this.revision
      && request.sessionKey === sessionKey
      && request.toolId === toolId;
  }
}
